/**
 * The editor: a 52px header over a progress strip, then three columns —
 * optional left panel, the canvas, optional right rail.
 *
 * The header is a single non-wrapping flex row in which everything is
 * `flex: none` except the identity line, so at narrow widths the window meta
 * truncates first and no control is ever clipped or unreachable. The row is
 * budgeted to fit at 924px with the Review badge present; anything added here
 * has to buy its width from something else.
 */

import { waitingSummary } from '../../shared/dependencies.ts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';

import type { Channel, EchoOption, IssueDoc, LinkedBefore } from '../../shared/types.ts';
import { changeLabel, findProof, proofStillThere, type ProofSpot } from '../../shared/proof.ts';
import { shortKicker, sourcesLabel } from '../../shared/dates.ts';
import { windowOf } from '../../shared/render/plan.ts';
import { api, ApiError, writeBackMessage, type IssueResponse, type Readiness } from '../api.ts';
import { ArrowLeft, Moon } from '../icons.tsx';
import { isFrozen, Page, type Lens, type OrderProposal, type PageActions } from './Page.tsx';
import { Notes, type Note } from './Notes.tsx';
import { CollapseView } from './Collapse.tsx';
import { LeftPanel } from './LeftPanel.tsx';
import { HintsContext, OwedContext, SHORTCUTS } from './Row.tsx';
import { rowHints } from '../../shared/hints.ts';
import { Strip } from './Strip.tsx';
import { Inspector } from './Inspector.tsx';
import { ReviewPanel, type NoteFix, type PanelNote } from './ReviewPanel.tsx';

interface Props {
  doc: IssueDoc;
  readiness: Readiness | null;
  busy: boolean;
  error: string | null;
  /** Resolves to whether the call succeeded. */
  run: (fn: () => Promise<IssueResponse>) => Promise<boolean>;
  onIndex: () => void;
  onSend: () => void;
  onError: (m: string | null) => void;
  /**
   * The Send view is layered over the editor, which stays mounted beneath
   * it. Covered, the editor is inert and its keys are not its own: Escape
   * would close the inspector underneath, ⌘/ open the shortcut card.
   */
  covered?: boolean;
  /** The Send line's jump to a row (2026-10-04): each new `n` goes there once the editor is uncovered. */
  jumpTo?: { anchor: string; n: number } | null;
}

const KICKER: Record<Lens, [string, string]> = {
  source: [
    'SOURCE — CANONICAL ITEMS',
    'Every item as stored, nothing filtered or transformed. The three channels are renderings of this.',
  ],
  website: [
    'WEBSITE — EDITABLE',
    'Click any text to edit it in place. The page is the editor.',
  ],
  email: [
    'EMAIL — BUTTONDOWN',
    'The same issue, minus anything held out of email, plus the subscriber block.',
  ],
  audio: [
    'AUDIO — SPOKEN SCRIPT',
    'A numbered script, not a page. Each block is synthesized on its own; the rules are the pauses.',
  ],
};

const CHANNEL_LENSES: Channel[] = ['website', 'email', 'audio'];

export function Editor({ doc, readiness, busy, error, run, onIndex, onSend, onError, covered = false, jumpTo }: Props) {
  const [lens, setLens] = useState<Lens>('website');
  const [panel, setPanel] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [drafting, setDrafting] = useState<string | null>(null);
  // What the draft in flight says while it waits: Echoes, when the archive
  // is busy and it asks again (WT352). Read from the server while it spins.
  const [draftSays, setDraftSays] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ itemId: string; candidates: string[]; echoes?: EchoOption[]; membership?: { cta: string; thanks: string }[]; photo?: { alt: string }[]; alts?: { src: string; alt: string }[]; linked_before?: LinkedBefore[] } | null>(null);
  const [sweeping, setSweeping] = useState(false);
  // Items whose write-back or conflict choice is out, for the Inspector,
  // which remounts per item and cannot hold it itself.
  const [writesOut, setWritesOut] = useState<ReadonlySet<string>>(new Set());
  const onWriteOut = useCallback((itemId: string, out: boolean) => setWritesOut((current) => {
    const next = new Set(current);
    if (out) next.add(itemId); else next.delete(itemId);
    return next;
  }), []);
  const [ordering, setOrdering] = useState<string | null>(null);
  const [orderProposal, setOrderProposal] = useState<OrderProposal | null>(null);
  // ⌘/ shows the keyboard sugar; Jamie will forget it otherwise (2026-09-20).
  const [hints, setHints] = useState(false);
  // Read at the keypress, not captured by an effect: effects run after
  // paint, and a key pressed as the Send view opens must already miss.
  const coveredRef = useRef(covered);
  coveredRef.current = covered;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (coveredRef.current) return;
      if ((e.metaKey || e.ctrlKey) && e.key === '/') { e.preventDefault(); setHints((h) => !h); }
      else if (e.key === 'Escape') setHints(false);
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, []);
  const [collapsed, setCollapsed] = useState(false);
  const [reading, setReading] = useState(false);
  const [readOpen, setReadOpen] = useState(false);
  const [cleared, setCleared] = useState<Map<string, 'done' | 'ignored'>>(new Map());
  const [showCleared, setShowCleared] = useState(false);
  // The staleness hint: how many edits this session since the read.
  const [editsSince, setEditsSince] = useState(0);
  // Review → Apply (2026-10-04). Notes applied this session, by key, with
  // the spot the server put the fix at (Undo sends it back); notes the
  // server would not apply, with its sentence; the one in flight.
  const [applied, setApplied] = useState<ReadonlyMap<string, ProofSpot>>(new Map());
  const [refused, setRefused] = useState<ReadonlyMap<string, { why: string; say: string }>>(new Map());
  const [applying, setApplying] = useState<string | null>(null);
  const [applyingAll, setApplyingAll] = useState(false);
  // What the last Apply did, with its Undo for a few seconds; or what
  // Apply all did, held until dismissed when something was left.
  const [toast, setToast] = useState<{ text: string; undo?: { k: string; i: number; spot: ProofSpot }; sticky?: boolean } | null>(null);
  const [toastHeld, setToastHeld] = useState(false);
  useEffect(() => {
    // A toast taken away under the pointer or the focus gets no leave event.
    if (!toast) { setToastHeld(false); return; }
    if (toast.sticky || toastHeld) return;
    const t = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(t);
  }, [toast, toastHeld]);
  const canvasRef = useRef<HTMLDivElement>(null);
  const rowsRef = useRef<HTMLDivElement>(null);

  const id = doc.issue.id;
  // The link check and deliverability are about the whole issue: their
  // summary ("1 gift link, 2 moved, 3 the site would not answer") printed
  // under whichever row had the first finding and named none of them
  // (WT352). Each finding is said on its own row instead (Row.tsx), and the
  // summary stays on the strip; the Send view has one line naming the rows.
  const owed = useMemo(() => new Map(
    (readiness?.units ?? [])
      .filter((u) => u.state === 'partial' && u.context && u.kind !== 'links' && u.kind !== 'mail')
      .map((u) => [u.anchor, u.context!]),
  ), [readiness]);
  const w = windowOf(doc);
  const frozen = isFrozen(doc);
  // Frozen, nothing can be acted on, so nothing is hinted.
  const rowHintMap = useMemo(() => (frozen ? new Map() : rowHints(doc)), [doc, frozen]);
  const [kicker, note] = KICKER[lens];
  // Published, the text stays editable until it is put to bed, and an edit
  // reaches readers only by a re-send (Jamie, 2026-09-28). Frozen, nothing
  // is editable, and the kicker says so rather than a 423.
  const lensKicker = !frozen && doc.issue.status === 'published' && lens === 'website'
    ? 'WEBSITE — PUBLISHED · EDITS NEED A RE-SEND'
    : frozen && lens !== 'source'
      ? kicker.replace('EDITABLE', 'PUBLISHED')
      : kicker;
  const lensNote = frozen && lens === 'website'
    ? doc.issue.put_to_bed_at
      ? `Put to bed. Nothing in WT${doc.issue.number} can change until it is woken.`
      : 'A pre-Builder record. Nothing here is editable.'
    : note;

  /** Jump the canvas to an anchor and select it — used by review notes. */
  // A jump from the review panel highlights and scrolls, but
  // keeps the rail as it is: "Show me" used to swap the review out for the
  // inspector, so the note vanished the moment you went to act on it
  // (2026-09-20). Clicking the item on the canvas still opens the inspector.
  const [peeking, setPeeking] = useState(false);
  const jump = useCallback((anchor: string) => {
    setSelected(anchor);
    setPeeking(true);
    const el = canvasRef.current?.querySelector(`[data-anchor="${CSS.escape(anchor)}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);
  /**
   * Scroll only: centre the anchor and tint it briefly, selecting nothing, so
   * the inspector stays as it was. The progress strip and a Notable/Briefly
   * move use this — Jamie wants to be taken to the item to work on it, not
   * handed its detail panel (WT351).
   */
  const goTo = useCallback((anchor: string) => {
    const el = canvasRef.current?.querySelector(`[data-anchor="${CSS.escape(anchor)}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.remove('arrived');
    void (el as HTMLElement).offsetWidth; // restart the tint on a second visit
    el.classList.add('arrived');
    setTimeout(() => el.classList.remove('arrived'), 1800);
  }, []);
  // From the Send line: taken to the row, as a strip tick takes him.
  useEffect(() => {
    if (!jumpTo || covered) return;
    const frame = requestAnimationFrame(() => goTo(jumpTo.anchor));
    return () => cancelAnimationFrame(frame);
  }, [jumpTo?.n, covered]);
  const select = useCallback((anchor: string | null) => {
    setSelected(anchor);
    setPeeking(false);
  }, []);

  /** Every mutation routes through here so the read's staleness hint is honest. */
  const runEdit = (fn: () => Promise<IssueResponse>) => {
    setEditsSince((e) => e + 1);
    return run(fn);
  };

  /** An email finding on a row, kept as it is: it stops being said (deliverability/keep). */
  const keepMail = (key: string) => void runEdit(() => api.keepFinding(id, key));

  /**
   * A wand on a section still waiting on its inputs asks first (warn, don't
   * block): false when nothing waits, true to draft anyway, null if Jamie
   * said no. The server holds the same line and logs the override.
   */
  const waitingOk = (anchor: string): boolean | null => {
    const unit = readiness?.units.find((u) => u.anchor === anchor && u.state === 'waiting');
    if (!unit?.waiting_on) return false;
    const names = unit.waiting_on.map((w) => w.name).join(' and ');
    const verb = unit.waiting_on.length === 1 ? "isn't" : "aren't";
    return confirm(`${names} ${verb} finished yet: ${waitingSummary(unit.waiting_on)}. Draft the ${unit.title} anyway?`) ? true : null;
  };

  /**
   * Asks the server, every second while a draft that reads the archive is
   * out, what it has to say ("The archive is busy; trying again…"). Returns
   * the stop. Only Echoes waits on the archive, so only its wands ask.
   */
  const listenWhileDrafting = (anchor: string) => {
    let stopped = false;
    const tick = () => {
      if (stopped) return;
      api.drafting(id)
        .then((r) => { if (!stopped) setDraftSays(r.drafting?.anchor === anchor ? r.drafting.says : null); })
        .catch(() => { /* a missed poll says nothing */ })
        .finally(() => { if (!stopped) timer = setTimeout(tick, 1000); });
    };
    let timer = setTimeout(tick, 1000);
    return () => { stopped = true; clearTimeout(timer); setDraftSays(null); };
  };

  const act: PageActions = {
    // Returned, not voided: an editable waits on it to know whether its text
    // was saved (review 2026-09-27, §1.4).
    updateItem: (itemId, patch) => runEdit(() => api.updateItem(id, itemId, patch)),
    updateIssue: (patch) => void runEdit(() => api.settings(id, patch)),
    moveItem: (nodeId, itemId, delta) => void runEdit(() => api.moveItem(id, nodeId, itemId, delta)),
    removeItem: (nodeId, itemId) => void runEdit(() => api.removeItem(id, nodeId, itemId)),
    moveNode: (nodeId, delta) => void runEdit(() => api.moveNode(id, nodeId, delta)),
    removeNode: (nodeId) => void runEdit(() => api.removeNode(id, nodeId)),
    renameNode: (nodeId, label) => runEdit(() => api.renameNode(id, nodeId, label)),
    addNode: (spec) => void runEdit(() => api.addNode(id, spec)),
    addItem: (nodeId, type) => void runEdit(() => api.addItem(id, nodeId, type)),
    addEchoes: (nodeId, echoes) => void runEdit(() => api.addEchoes(id, nodeId, echoes)),
    promote: (itemId) => void runEdit(() => api.promote(id, itemId)),
    // The link lands in the other section, often a screen away: the canvas
    // follows it there (scroll only — selecting it opened the inspector).
    moveToSection: (itemId, target) => void runEdit(() => api.moveToSection(id, itemId, target))
      .then(() => requestAnimationFrame(() => goTo(itemId))),
    demote: (nodeId) => void runEdit(() => api.demote(id, nodeId)),
    setChannel: (itemId, channel, on) => void runEdit(() => api.setChannel(id, itemId, channel, on)),
    uploadPhoto: (itemId, file) => {
      const p = api.uploadPhoto(id, itemId, file);
      void run(() => p);
      return p;
    },
    /**
     * The wand offers; it never writes. Candidates land in a picker beside the
     * block and nothing changes until Jamie chooses one — which is what keeps
     * every word in the issue his.
     */
    suggestOrder: (nodeId) => {
      setOrdering(nodeId);
      setOrderProposal(null);
      api.suggestOrder(id, nodeId)
        .then((r) => setOrderProposal({ nodeId, order: r.order, current: r.current, why: r.why, notes: r.notes }))
        .catch((err) => onError((err as Error).message))
        .finally(() => setOrdering(null));
    },
    applyOrder: (nodeId, order, why) => void runEdit(() => api.reorder(id, nodeId, order, why)),
    draft: (itemId) => {
      const force = waitingOk(itemId);
      if (force === null) return;
      setDrafting(itemId);
      setDraft(null);
      const stop = doc.items[itemId]?.type === 'echo' ? listenWhileDrafting(itemId) : () => {};
      api.draftItem(id, itemId, undefined, force)
        .then((r) => setDraft({ itemId, candidates: r.candidates, echoes: r.echoes, membership: r.membership, photo: r.photo, alts: r.alts, linked_before: r.linked_before }))
        .catch((err) => onError((err as Error).message))
        .finally(() => { stop(); setDrafting(null); });
    },
    // The Echoes section wand offers echoes for the node; the picker hangs
    // off the heading, keyed by the node id, and the ticked ones append.
    draftEchoes: (nodeId) => {
      const force = waitingOk(nodeId);
      if (force === null) return;
      setDrafting(nodeId);
      setDraft(null);
      const stop = listenWhileDrafting(nodeId);
      api.draftEchoes(id, nodeId, force)
        .then((r) => setDraft({ itemId: nodeId, candidates: [], echoes: r.echoes ?? [] }))
        .catch((err) => onError((err as Error).message))
        .finally(() => { stop(); setDrafting(null); });
    },
  };

  const sweep = () => {
    setSweeping(true);
    api.sweep(id)
      // Applied as it lands. It used to wait for a focused field to blur,
      // because replacing the doc reset the field being typed in; no field
      // is overwritten while focused now (Field.tsx, Editable,
      // RichEditable), and the wait held a scan invisibly — on a checkbox,
      // or for ever when WebKit removed the field without a blur (Batch 5
      // review, N4).
      .then((resp) => void run(() => Promise.resolve(resp)))
      .catch((err) => onError((err as Error).message))
      .finally(() => setSweeping(false));
  };

  // Opening a draft re-scans on its own: sources fill in all week, and the
  // page should show the week as it stands, not as it stood last session.
  // The doc renders immediately; the sweep lands when it lands.
  //
  // Not when the editor mounts under the Send view (a link straight to
  // /<id>/send), nor when it is uncovered later, and not once any leg has
  // been sent or is out: a scan then spends the posts/all allowance, saves
  // a revision, and can change items between the legs of a run, so the
  // website, email and audio would differ (Batch 6 review, B1). Re-scan
  // stays Jamie's to press.
  useEffect(() => {
    if (doc.issue.status !== 'draft' || covered) return;
    if (Object.values(doc.sends ?? {}).some((s) => s && s.status !== 'none')) return;
    sweep();
  }, [id]); // once per issue open — not on every doc replacement, nor on uncovering

  // Escape closes the right rail before it does anything else. A field in it
  // is blurred first, so its commit runs: closing took the field out from
  // under the caret, and Safari fires no blur for that, so the edit was lost
  // (review 2026-09-27, §1.4).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (coveredRef.current) return;
      const target = e.target as HTMLElement;
      if (e.key === 'Escape' && selected && !target.isContentEditable) {
        if (target.matches?.('input, textarea')) target.blur();
        setSelected(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);

  const inspecting = selected && doc.items[selected] && !(peeking && readOpen) ? selected : null;

  const review = doc.review as { summary?: string; notes?: Note[]; at?: string } | undefined;
  const key = (n: Note, i: number) => `${n.item_id ?? 'issue'}:${i}:${n.text.slice(0, 32)}`;

  /**
   * A PROOF note whose substring is gone is fixed — it drops live, no
   * re-read. An item's note is gone with its item; a note on the issue is
   * gone once no title, dek or item holds its words (src/shared/proof.ts).
   */
  const stillAnchored = (n: Note) => {
    if (n.kind !== 'PROOF' || !n.was) return true;
    if (n.item_id !== null && !doc.items[n.item_id]) return false;
    return proofStillThere(doc, n);
  };

  const allNotes: PanelNote[] = (review?.notes ?? [])
    .map((n, i) => ({ note: n, k: key(n, i), i, cleared: cleared.get(key(n, i)) }))
    // An applied note goes at once, even where its fix still holds its words.
    .filter((pn) => stillAnchored(pn.note) && !applied.has(pn.k));
  const openNotes = allNotes.filter((pn) => !pn.cleared);
  const notes = openNotes.map((pn) => pn.note);
  const noteKeys = openNotes.map((pn) => pn.k);
  const proof = notes.filter((n) => n.kind === 'PROOF').length;

  /**
   * Apply where the server would take it: a PROOF note with a fix whose
   * words sit in one place (the same matcher as the server). Nothing is
   * applied to an issue that cannot change.
   */
  const canApply = (n: Note) =>
    !frozen && Boolean(review?.at) && n.kind === 'PROOF' && Boolean(n.was) && Boolean(n.now) && findProof(doc, n).ok;
  const fixOf = (pn: PanelNote | undefined): NoteFix | null => {
    if (!pn) return null;
    const n = pn.note;
    const said = refused.get(pn.k);
    if (!said && !canApply(n)) return null;
    return {
      label: changeLabel(n.was!, n.now!),
      full: `${n.was} → ${n.now}`,
      busy: applying === pn.k,
      refused: said,
    };
  };
  const applicable = openNotes.filter((pn) => !refused.has(pn.k) && canApply(pn.note));

  /** One fix, applied; resolves to where the fix now sits, or the server's refusal. */
  const applyNote = async (pn: PanelNote): Promise<{ spot: ProofSpot } | { refusal: string }> => {
    if (!review?.at) return { refusal: 'there is no review to apply from' };
    setApplying(pn.k);
    setEditsSince((e) => e + 1);
    try {
      const resp = await api.applyProof(id, review.at, pn.i);
      await run(() => Promise.resolve(resp));
      setApplied((m) => new Map(m).set(pn.k, resp.applied));
      const item = resp.applied.item_id ? resp.issue.items[resp.applied.item_id] : undefined;
      const said = writeBackMessage(item?.source, resp.result);
      if (said) onError(said);
      return { spot: resp.applied };
    } catch (err) {
      const message = (err as Error).message;
      if (err instanceof ApiError && err.status === 409 && err.code?.startsWith('proof_')) {
        setRefused((m) => new Map(m).set(pn.k, { why: err.code!.slice('proof_'.length), say: message }));
        // The words moved under the note: show the issue as it is now.
        void run(() => api.getIssue(id));
      } else {
        onError(message);
      }
      return { refusal: message };
    } finally {
      setApplying(null);
    }
  };

  const apply = (k: string) => {
    const pn = openNotes.find((p) => p.k === k);
    if (!pn || applying || applyingAll) return;
    const label = changeLabel(pn.note.was!, pn.note.now!);
    void applyNote(pn).then((out) => {
      if ('spot' in out) setToast({ text: `Applied ${label}`, undo: { k: pn.k, i: pn.i, spot: out.spot } });
    });
  };

  /** Puts the old words back: a reverse Apply of that one fix, not a general undo. */
  const undo = async (u: { k: string; i: number; spot: ProofSpot }) => {
    if (!review?.at) return;
    setToast(null);
    setEditsSince((e) => e + 1);
    try {
      const resp = await api.applyProof(id, review.at, u.i, u.spot);
      await run(() => Promise.resolve(resp));
      setApplied((m) => { const next = new Map(m); next.delete(u.k); return next; });
    } catch (err) {
      onError(`Undo: ${(err as Error).message}`);
    }
  };

  /** Every applicable PROOF fix, one at a time; says what could not be applied. */
  const applyAll = async () => {
    if (applying || applyingAll) return;
    setApplyingAll(true);
    setToast(null);
    const left: string[] = [];
    let done = 0;
    for (const pn of applicable) {
      const out = await applyNote(pn);
      if ('refusal' in out) left.push(`${anchorName(pn.note.item_id)}: ${out.refusal}`);
      else done++;
    }
    setApplyingAll(false);
    const head = `Applied ${done} fix${done === 1 ? '' : 'es'}.`;
    setToast(left.length
      ? { text: `${head} ${left.length} could not be applied — ${left.join('; ')}.`, sticky: true }
      : { text: head });
  };

  const clear = (k: string, how: 'done' | 'ignored') =>
    setCleared(new Map([...cleared, [k, how]]));
  const reopen = (k: string) => {
    const next = new Map(cleared);
    next.delete(k);
    setCleared(next);
  };

  const anchorName = (itemId: string | null) => {
    if (!itemId) return 'the issue';
    const item = doc.items[itemId];
    if (!item) return itemId;
    const name = item.title || item.label || item.type.replace('_', ' ');
    return name.length > 26 ? `${name.slice(0, 25)}…` : name;
  };

  const read = () => {
    setReading(true);
    setReadOpen(true);
    setCleared(new Map());
    setApplied(new Map());
    setRefused(new Map());
    setToast(null);
    setEditsSince(0);
    void run(() => api.review(id)).finally(() => setReading(false));
  };

  return (
    <div class="app" inert={covered}>
      <header class="header">
        <button class="btn ghost-btn" onClick={onIndex}><ArrowLeft /> Issues</button>
        <span class="mark">W</span>
        <span class="head-divider" />
        <span class="identity">
          <span class="wt">WT{doc.issue.number}</span>
          <span class="win">{shortKicker(doc.issue.publication_date)} · {sourcesLabel(w)}</span>
        </span>

        <span class="head-spacer" />

        {/*
          Source sits outside the segmented group on purpose: the three channels
          are permutations of it, not peers of it.
        */}
        <button
          class={`btn${lens === 'source' ? ' primary' : ''}`}
          onClick={() => setLens('source')}
        >
          Source
        </button>
        <div class="segment">
          {CHANNEL_LENSES.map((c) => (
            <button
              key={c}
              class={`seg${lens === c ? ' on' : ''}`}
              onClick={() => setLens(c)}
            >
              {c[0]!.toUpperCase() + c.slice(1)}
            </button>
          ))}
        </div>

        {/*
          Opens the read that exists; re-running is what "Read again" is for.
          Re-reading on every open would spend a model call to tell Jamie
          something he has already seen.
        */}
        <button class={`btn${collapsed ? ' primary' : ''}`} onClick={() => setCollapsed(!collapsed)}>
          Collapse
        </button>
        <button
          class={`btn${readOpen ? ' reading' : ''}`}
          // Asleep, a read that exists opens; a new one would be refused.
          disabled={Boolean(doc.issue.put_to_bed_at) && !review && !readOpen}
          onClick={() => {
            if (readOpen) setReadOpen(false);
            else if (review) setReadOpen(true);
            else read();
          }}
        >
          {reading ? 'Reading…' : 'Review'}
          {!reading && notes.length > 0 && <span class="count-badge">{notes.length}</span>}
        </button>
        <button class={`btn${panel ? ' primary' : ''}`} onClick={() => setPanel(!panel)}>
          Issue
        </button>
        <button class="btn primary" onClick={onSend}>Publish</button>
      </header>

      <Strip number={doc.issue.number} readiness={readiness} onJump={goTo} doc={doc} />
      {doc.issue.put_to_bed_at && (
        <div class="bed-bar" role="status">
          <Moon size={14} />
          <span>
            <strong>Put to bed</strong> {new Date(doc.issue.put_to_bed_at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}.
            {' '}Nothing in WT{doc.issue.number} can change until it is woken.
          </span>
          <button class="btn small" onClick={() => {
            if (confirm(`Wake WT${doc.issue.number}? It becomes editable and re-sendable again.`)) void run(() => api.bed(id, false));
          }}>Wake it</button>
        </div>
      )}

      {hints && (
        <div class="scrim" onClick={() => setHints(false)}>
          <div class="hint-card" role="dialog" aria-label="Keyboard shortcuts" onClick={(e) => e.stopPropagation()}>
            <div class="cl-head">WHILE EDITING</div>
            {SHORTCUTS.map((sc) => (
              <div class="hint-row" key={sc.keys}>
                <kbd>{sc.keys}</kbd>
                <span>{sc.does}</span>
              </div>
            ))}
            <p class="hint-foot">Fields hold Markdown while you edit and render it when you click away.</p>
          </div>
        </div>
      )}

      {error && (
        <div class="error-bar" role="alert">
          {error}
          <button class="btn tiny" onClick={() => onError(null)}>Dismiss</button>
        </div>
      )}

      <div class="columns">
        {panel && (
          <LeftPanel
            doc={doc}
            selected={selected}
            onSelect={jump}
            onSettings={(patch) => run(() => api.settings(id, patch))}
            onMove={(nodeId, delta) => void run(() => api.moveNode(id, nodeId, delta))}
            onRemove={(nodeId) => void run(() => api.removeNode(id, nodeId))}
            onAdd={(spec) => void run(() => api.addNode(id, spec))}
            onReorder={(nodeId, before) => void run(() => api.addNode(id, { id: nodeId, before: before ?? undefined }))}
            onSweep={sweep}
            sweeping={sweeping}
            onShare={(note) => run(() => api.shareDraft(id, note))}
            onUnshare={() => run(() => api.unshareDraft(id))}
          />
        )}

        <div class="canvas" ref={canvasRef}>
          <div class="canvas-inner">
            <div class="lens-kicker">
              <span class="kicker">
                {collapsed ? 'COLLAPSED — SECTIONS' : lensKicker}
              </span>
              <span class="note">
                {collapsed
                  ? frozen
                    ? 'Click a section to open it. Nothing is editable here.'
                    : 'Drag to reorder. Click a section to open it. Nothing is editable here.'
                  : lensNote}
              </span>
            </div>

            {readOpen && (
              <div class="read-bar">
                <div class="kicker">EDITORIAL<br />READ</div>
                <div class="read-card">
                  {reading ? (
                    <>
                      <p class="working">Reading the issue…</p>
                      <div class="read-checks">
                        {['Balance and rhythm', 'Against the archive', 'Length', 'Proofing'].map((c) => (
                          <span class="read-check on" key={c}><span class="dot" />{c}</span>
                        ))}
                      </div>
                    </>
                  ) : notes.length === 0 ? (
                    <>
                      <p class="working">
                        {review ? 'That is everything cleared.' : 'Nothing worth raising.'}
                      </p>
                      <p class="counts">Read it again after you change something.</p>
                      <div class="acts">
                        {!doc.issue.put_to_bed_at && <button class="btn small" onClick={read}>Read again</button>}
                        <button class="btn small" onClick={() => setReadOpen(false)}>Done</button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p class="working">{review?.summary}</p>
                      <p class="counts">
                        {notes.length} note{notes.length === 1 ? '' : 's'} in the margin
                        {proof > 0 && ` · ${proof} proof`} · read from this draft
                      </p>
                      <div class="acts">
                        {!doc.issue.put_to_bed_at && <button class="btn small" onClick={read}>Read again</button>}
                        <button class="btn small" onClick={() => setReadOpen(false)}>Done</button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {collapsed ? (
              <CollapseView
                doc={doc}
                frozen={frozen}
                selected={selected}
                onOpen={(nodeId) => { setCollapsed(false); jump(nodeId); }}
                onMove={(nodeId, delta) => void run(() => api.moveNode(id, nodeId, delta))}
                onRemove={(nodeId) => void run(() => api.removeNode(id, nodeId))}
                onReorder={(nodeId, before) => void run(() => api.addNode(id, { id: nodeId, before }))}
              />
            ) : (
            <OwedContext.Provider value={owed}>
            <HintsContext.Provider value={{ hints: rowHintMap, open: select, keep: keepMail }}>
            <Page
              doc={doc}
              lens={lens}
              hostRef={rowsRef}
              withNotes={readOpen && notes.length > 0}
              selected={selected}
              onSelect={select}
              act={act}
              drafting={drafting}
              draftSays={draftSays}
              draft={draft}
              onPickDraft={(itemId, text, refs, extraPatch) => {
                setDraft(null);
                // The head wand drafts the title theme and dek as two lines.
                if (itemId === 'issue') {
                  const [title, ...rest] = text.split('\n');
                  void run(() => api.settings(id, {
                    title: (title ?? '').trim(),
                    dek: rest.join(' ').trim(),
                  }));
                  return;
                }
                const item = doc.items[itemId];
                const field = item?.type === 'pinboard_link' ? 'commentary' : 'body';
                const patch: Record<string, unknown> = { [field]: text, ...(extraPatch ?? {}) };
                // An echo carries the citations it was drafted from, so the
                // inspector can show what it stands on. A redraft replaces them.
                if ((item?.type === 'echoes' || item?.type === 'echo') && refs?.length) patch.archive_references = refs;
                void run(() => api.updateItem(id, itemId, patch));
              }}
              onDismissDraft={() => setDraft(null)}
              ordering={ordering}
              orderProposal={orderProposal}
              onDismissOrder={() => setOrderProposal(null)}
            >
              {readOpen && notes.length > 0 && (
                <Notes
                  notes={notes}
                  host={rowsRef}
                  selected={selected}
                  onShowMe={jump}
                  onDone={(i) => clear(noteKeys[i]!, 'done')}
                  onIgnore={(i) => clear(noteKeys[i]!, 'ignored')}
                  fixAt={(i) => fixOf(openNotes[i])}
                  onApply={(i) => apply(noteKeys[i]!)}
                />
              )}
            </Page>
            </HintsContext.Provider>
            </OwedContext.Provider>
            )}
          </div>
        </div>

        {inspecting ? (
          <Inspector
            // One instance per item: reused, a field whose next item had the
            // same saved text (two empty commentaries) kept the first item's
            // typing and a blur saved it onto the second (Batch 5 review, B1).
            key={inspecting}
            doc={doc}
            itemId={inspecting}
            run={runEdit}
            writeOut={writesOut.has(inspecting)}
            onWriteOut={onWriteOut}
            onClose={() => setSelected(null)}
            onError={onError}
            onBackToReview={readOpen ? () => setSelected(null) : undefined}
          />
        ) : readOpen ? (
          <ReviewPanel
            reading={reading}
            summary={review?.summary}
            notes={allNotes}
            editsSince={editsSince}
            selected={selected}
            anchorName={anchorName}
            onShowMe={jump}
            onDone={(k) => clear(k, 'done')}
            onIgnore={(k) => clear(k, 'ignored')}
            onReopen={reopen}
            onReadAgain={doc.issue.put_to_bed_at ? undefined : read}
            onClose={() => setReadOpen(false)}
            showCleared={showCleared}
            onToggleCleared={() => setShowCleared(!showCleared)}
            fixOf={(k) => fixOf(allNotes.find((pn) => pn.k === k))}
            onApply={apply}
            onApplyAll={applicable.length >= 2 ? () => void applyAll() : undefined}
            applyingAll={applyingAll}
          />
        ) : null}
      </div>

      {toast && (
        <div
          class={`proof-toast${toast.sticky ? ' sticky' : ''}`}
          role="status"
          onMouseEnter={() => setToastHeld(true)}
          onMouseLeave={() => setToastHeld(false)}
          onFocusIn={() => setToastHeld(true)}
          onFocusOut={() => setToastHeld(false)}
        >
          <span>{toast.text}</span>
          {toast.undo && (
            <button class="btn tiny" onClick={() => void undo(toast.undo!)}>Undo</button>
          )}
          <button class="proof-toast-x" aria-label="Dismiss" onClick={() => { setToast(null); setToastHeld(false); }}>✕</button>
        </div>
      )}

      {busy && <div class="busy-hint">Saving…</div>}
    </div>
  );
}
