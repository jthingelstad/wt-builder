/**
 * One Another Thing episode: the outline as the canvas, the episode's
 * fields, audio and send in the rail beside it. One episode, one screen.
 *
 * The outline saves whole (PUT /outline) with the version it was edited
 * from; fields save on blur and never overwrite typing in progress
 * (Field.tsx). An outline edit is a change to apply, not a copy of the
 * outline: the page's saves go one at a time, each applied to the outline
 * the last one answered with, so tabbing through fields faster than the
 * server answers loses nothing, and `outline-moved` is left meaning what it
 * says, another tab: then the edit is applied to that tab's outline. Three texts live here on purpose and stay apart: the OUTLINE
 * (what Jamie records from, never published), the SHOW NOTES (what a
 * listener reads) and the TRANSCRIPT (what was said).
 */

import { useRef, useState } from 'preact/hooks';

import { cardSeconds, inlineRuns, newId, parseBlocks, serializeBlocks } from '../../shared/podcast/cards.ts';
import { fmt, plannedTotal, splitReport } from '../../shared/podcast/pace.ts';
import { SEGMENT_ROLES, type Card as CardT, type EpisodeDoc, type Segment } from '../../shared/podcast/types.ts';
import { lastSent } from '../../shared/sends.ts';
import { duration } from '../../shared/timing.ts';
import { ApiError } from '../api.ts';
import { EventLog } from '../components/EventLog.tsx';
import { Input, TextArea } from '../components/Field.tsx';
import { ArrowDown, ArrowLeft, ArrowUp, Mic, Plus, Spinner, X } from '../icons.tsx';
import { podcastApi, type EpisodePackage, type EpisodeView } from './api.ts';

interface Props {
  view: EpisodeView;
  error: string | null;
  run: (fn: () => Promise<EpisodeView>) => Promise<boolean>;
  onError: (m: string | null) => void;
  onIndex: () => void;
  onRecord: () => void;
  /** After a refusal that means the page is behind: read the episode again. */
  onReload: () => void;
}

const STAGE_LABEL = { outline: 'Outline', record: 'Record', publish: 'Publish' } as const;

export function Episode({ view, error, run, onError, onIndex, onRecord, onReload }: Props) {
  const doc = view.episode;
  const e = doc.episode;
  const id = e.id;
  const sent = Boolean(lastSent(doc.sends?.another));
  const [logOpen, setLogOpen] = useState(false);
  // Drafting a transcript takes minutes; the box is locked meanwhile, so the
  // draft never lands over what was typed (the server refuses that too).
  const [drafting, setDrafting] = useState(false);
  const listening = drafting || view.busy.transcribing;

  const patch = (body: Record<string, unknown>) => run(() => podcastApi.patch(id, body));
  // The outline this page's next save starts from. While none is waiting it
  // follows what is on screen; while one is, it is what the last answered.
  const outline = useRef({ segments: doc.segments, version: view.outline_version });
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const waiting = useRef(0);
  if (waiting.current === 0) outline.current = { segments: doc.segments, version: view.outline_version };
  const saveOutline = (change: Edit<Segment[]>, target?: Target): Promise<boolean> => {
    waiting.current += 1;
    let movedUnder = false;
    const saving = queue.current.then(() => run(async () => {
      const put = async (from: { segments: Segment[]; version: string }) => {
        const v = await podcastApi.outline(id, change(from.segments), from.version);
        outline.current = { segments: v.episode.segments, version: v.outline_version };
        return v;
      };
      try {
        return await put(outline.current);
      } catch (err) {
        if (!(err instanceof ApiError && err.code === 'outline-moved')) throw err;
      }
      // Another tab saved first. The edit is a change by id, so it goes onto
      // the newer outline, as a field edit would (the later save stands,
      // the outline it replaced is kept in the revisions); it is never dropped.
      // Refused again, the page re-reads and says so.
      const latest = await podcastApi.get(id);
      // An edit to a segment or card the other tab removed changes nothing
      // there: said, not saved as if it had been made.
      const there = !target || latest.episode.segments.some((s) => s.id === target.seg && (!target.card || s.cards.some((c) => c.id === target.card)));
      if (!there) {
        onReload();
        throw new Error('The outline changed in another tab, and what you edited is no longer in it: your edit was not made.');
      }
      try {
        const v = await put({ segments: latest.episode.segments, version: latest.outline_version });
        movedUnder = true;
        return v;
      } catch (err) {
        if (err instanceof ApiError && err.code === 'outline-moved') onReload();
        throw err;
      }
    })).then((ok) => {
      if (ok && movedUnder) onError('The outline had changed in another tab; your edit was made to the newer outline.');
      return ok;
    }).catch(() => false).finally(() => { waiting.current -= 1; });
    queue.current = saving;
    return saving;
  };

  const planned = plannedTotal(doc.segments);
  const readiness = view.readiness;

  return (
    <div class="app pc">
      <header class="header">
        <button class="btn small" onClick={onIndex}><ArrowLeft /> Episodes</button>
        <span class="mark pc-mark">A</span>
        <span class="identity">
          <span class="wt">AT{e.number}</span>
          <span class="pc-ident-title">{e.title || 'Untitled'}</span>
        </span>
        <span class={`ir-chip ${e.status === 'published' ? 'sent' : ''}`}>{e.status.toUpperCase()}</span>
        <button class="btn small" onClick={() => setLogOpen(true)}>Log</button>
        <button class="btn primary" onClick={onRecord}><Mic size={13} /> Record</button>
      </header>

      {logOpen && (
        <EventLog title={`AT${e.number} — the log`} load={() => podcastApi.events(id)} onClose={() => setLogOpen(false)} />
      )}

      <div class={`strip${readiness.done === readiness.total ? ' complete' : ''}`}>
        <div class="ticks">
          {readiness.units.map((u) => (
            <span key={u.key} class="tick-wrap">
              <span class={`tick${u.done ? ' done' : ''}`} title={`${STAGE_LABEL[u.stage]} · ${u.title}${u.done ? '' : ` — ${u.hint ?? ''}`}`} />
            </span>
          ))}
        </div>
        <span class="strip-label">
          {readiness.done === readiness.total ? 'READY' : `${readiness.total - readiness.done} LEFT`}
        </span>
      </div>

      {error && (
        <div class="error-bar" role="alert">{error} <button class="btn small" onClick={() => onError(null)}>Dismiss</button></div>
      )}

      <div class="pc-body">
        <main class="pc-main">
          <section class="pc-section">
            <h2>
              Outline <span class="pc-sub">what you record from; never published</span>
              {planned !== null && <span class="pc-sub mono"> · plan {fmt(planned)}</span>}
            </h2>
            <Outline doc={doc} save={saveOutline} />
          </section>

          {doc.session && doc.session.splits.length > 0 && (
            <section class="pc-section">
              <h2>Where the time went <span class="pc-sub">the last take's splits, beside the plan</span></h2>
              <div class="pc-splits">
                {splitReport(doc.segments, doc.session.splits, doc.session.ended).map((r) => (
                  <div key={r.segment.id} class="pc-split">
                    <span class="pc-split-title">{r.segment.title || '(untitled)'}</span>
                    <span class="mono">
                      {r.actual !== null ? fmt(r.actual) : '—'}
                      {r.budget !== null && <span class="pc-sub"> / {fmt(r.budget)}</span>}
                    </span>
                    {r.actual !== null && r.budget !== null && (
                      <span class={`mono pc-delta ${r.actual > r.budget + 30 ? 'over' : r.actual < r.budget - 30 ? 'under' : 'on'}`}>
                        {r.actual > r.budget ? '+' : '−'}{fmt(Math.abs(r.actual - r.budget))}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {doc.notes.length > 0 && (
            <section class="pc-section">
              <h2>Take notes <span class="pc-sub">marked while recording; never published</span></h2>
              <div class="pc-notes">
                {doc.notes.map((n, i) => (
                  <div key={`${n.at}-${i}`} class="pc-note">
                    <span class="mono pc-sub">{n.elapsed !== undefined ? fmt(n.elapsed) : n.at.slice(11, 16)}</span>
                    <span class="pc-note-text">{n.text}</span>
                    <button class="btn tiny" title="Remove this note" onClick={() => void run(() => podcastApi.removeNote(id, i))}><X size={11} /></button>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section class="pc-section">
            <h2>Show notes <span class="pc-sub">what a listener reads; the outline's links follow under "Mentioned in this episode"</span></h2>
            <TextArea
              class="pc-text" rows={8} value={doc.show_notes ?? ''} placeholder="The episode, for its page. Markdown."
              onCommit={(t) => (t !== (doc.show_notes ?? '') ? patch({ show_notes: t }) : undefined)}
            />
          </section>

          <section class="pc-section">
            <h2>
              Transcript <span class="pc-sub">drafted from the mastered audio, yours after a read-through</span>
              <Transcribe view={view} run={run} busy={drafting} setBusy={setDrafting} />
            </h2>
            <TextArea
              class="pc-text pc-transcript" rows={12} value={doc.transcript ?? ''} readOnly={listening}
              placeholder={doc.audio ? 'Transcribe the mastered audio, or paste a transcript. Paragraphs on blank lines.' : 'Drop the recording first.'}
              onCommit={(t) => (t !== (doc.transcript ?? '') ? patch({ transcript: t }) : undefined)}
            />
          </section>
        </main>

        <aside class="pc-rail">
          <section class="pc-panel">
            <h3>Episode</h3>
            <label class="pc-field">Title
              <Input value={e.title} placeholder="Episode title" onCommit={(t) => (t !== e.title ? patch({ title: t }) : undefined)} />
            </label>
            <label class="pc-field">Summary
              <TextArea rows={2} value={e.summary} placeholder="One line for the feed and the page" onCommit={(t) => (t !== e.summary ? patch({ summary: t }) : undefined)} />
            </label>
            <div class="pc-pair">
              <label class="pc-field">Number
                <Input type="number" min="1" value={e.number} readOnly={sent} onCommit={(t) => (Number(t) !== e.number && t ? patch({ number: Number(t) }) : undefined)} />
              </label>
              <label class="pc-field">Target, min
                <Input type="number" min="1" value={e.target_minutes ?? ''} placeholder="—" onCommit={(t) => (Number(t || 0) !== (e.target_minutes ?? 0) ? patch({ target_minutes: t ? Number(t) : null }) : undefined)} />
              </label>
            </div>
            <label class="pc-field">Slug
              <Input value={e.slug} readOnly={sent} onCommit={(t) => (t !== e.slug ? patch({ slug: t }) : undefined)} />
              <span class="pc-hint">{sent ? 'Sent: the URL and GUID are made from it, so it stays.' : 'Follows the title until you change it. Subscriber-facing once sent.'}</span>
            </label>
            <label class="pc-field">Date
              <Input value={e.date ?? ''} readOnly={sent} placeholder="Stamped when the recording is mastered" onCommit={(t) => (t && t !== e.date ? patch({ date: t }) : undefined)} />
              <span class="pc-hint">With its offset. The GUID is made from its UTC day.</span>
            </label>
            <label class="pc-check">
              <input type="checkbox" checked={Boolean(e.explicit)} onChange={(ev) => void patch({ explicit: (ev.currentTarget as HTMLInputElement).checked })} />
              Explicit
            </label>
          </section>

          <Audio view={view} run={run} onError={onError} />
          <Publish view={view} run={run} onError={onError} />

          <section class="pc-panel">
            <h3>Made in</h3>
            <MadeIn view={view} />
          </section>

          {!sent && (
            <button
              class="btn small pc-delete"
              onClick={() => {
                if (!confirm(`Delete AT${e.number}${e.title ? ` "${e.title}"` : ''}? Its outline and notes go; its revisions are kept.`)) return;
                podcastApi.remove(id).then(onIndex).catch((err: Error) => onError(err.message));
              }}
            >Delete this draft</button>
          )}
        </aside>
      </div>
    </div>
  );
}

// ── the outline ───────────────────────────────────────────────────────────

function move<T>(list: T[], i: number, d: number): T[] {
  const to = i + d;
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [x] = next.splice(i, 1);
  next.splice(to, 0, x!);
  return next;
}

/** An outline edit: what to do to the newest copy, by id, never a copy of it. */
type Edit<T> = (current: T) => T;
/** What an edit is to: the segment, and the card in it. */
interface Target { seg: string; card?: string }

/** Move the entry with this id by d places, wherever it is now; gone, nothing moves. */
function moveId<T extends { id: string }>(list: T[], id: string, d: number): T[] {
  const i = list.findIndex((x) => x.id === id);
  return i < 0 ? list : move(list, i, d);
}

function Outline({ doc, save }: { doc: EpisodeDoc; save: (change: Edit<Segment[]>, target?: Target) => Promise<boolean> }) {
  const segs = doc.segments;
  const setSeg = (id: string, change: Edit<Segment>, card?: string) =>
    save((all) => all.map((s) => (s.id === id ? change(s) : s)), { seg: id, card });
  return (
    <div class="pc-outline">
      {!segs.length && <p class="quiet">No segments yet. A segment is one part of the episode; its cards are the beats you record from, one screen each.</p>}
      {segs.map((seg, i) => (
        <SegmentEditor
          key={seg.id} seg={seg} first={i === 0} last={i === segs.length - 1}
          onChange={(change, card) => setSeg(seg.id, change, card)}
          onMove={(d) => void save((all) => moveId(all, seg.id, d), { seg: seg.id })}
          onRemove={() => {
            if (seg.cards.some((c) => c.claim || c.blocks.length) && !confirm(`Remove the segment "${seg.title || 'untitled'}" and its cards?`)) return;
            void save((all) => all.filter((s) => s.id !== seg.id), { seg: seg.id });
          }}
        />
      ))}
      <button
        class="btn small pc-add"
        onClick={() => void save((all) => [...all, { id: newId('seg'), title: '', cards: [{ id: newId('card'), blocks: [] }], links: [] }])}
      ><Plus /> Segment</button>
    </div>
  );
}

function SegmentEditor({ seg, first, last, onChange, onMove, onRemove }: {
  seg: Segment;
  first: boolean;
  last: boolean;
  onChange: (change: Edit<Segment>, card?: string) => Promise<boolean>;
  onMove: (d: number) => void;
  onRemove: () => void;
}) {
  const setCard = (id: string, change: Edit<CardT>) => onChange((s) => ({ ...s, cards: s.cards.map((c) => (c.id === id ? change(c) : c)) }), id);
  const links = seg.links.map((l) => (l.text ? `${l.text} | ${l.url}` : l.url)).join('\n');
  return (
    <div class={`pc-seg role-${seg.role ?? 'none'}`}>
      <div class="pc-seg-head">
        <select
          class="pc-role" value={seg.role ?? ''} title="What this segment is for in the arc (advisory)"
          onChange={(ev) => {
            const role = (ev.currentTarget as HTMLSelectElement).value;
            void onChange((s) => {
              const { role: _drop, ...rest } = s;
              return role ? { ...rest, role: role as Segment['role'] } : rest;
            });
          }}
        >
          <option value="">—</option>
          {SEGMENT_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <Input class="pc-seg-title" value={seg.title} placeholder="Segment title" onCommit={(t) => (t !== seg.title ? onChange((s) => ({ ...s, title: t })) : undefined)} />
        <span class="pc-num" title="Planned minutes: the card's pace is made from these">
          <Input
            type="number" min="0" step="0.5" value={seg.minutes ?? ''} placeholder="min"
            onCommit={(t) => {
              const minutes = t === '' ? undefined : Number(t);
              if (minutes === seg.minutes) return undefined;
              return onChange((s) => {
                const { minutes: _drop, ...rest } = s;
                return minutes === undefined ? rest : { ...rest, minutes };
              });
            }}
          />
          <span class="pc-sub">m</span>
        </span>
        <span class="pc-acts">
          {!first && <button class="btn tiny" title="Move up" onClick={() => onMove(-1)}><ArrowUp size={11} /></button>}
          {!last && <button class="btn tiny" title="Move down" onClick={() => onMove(1)}><ArrowDown size={11} /></button>}
          <button class="btn tiny" title="Remove the segment" onClick={onRemove}><X size={11} /></button>
        </span>
      </div>

      {seg.cards.map((card, i) => (
        <CardEditor
          key={card.id} card={card} seg={seg} first={i === 0} last={i === seg.cards.length - 1}
          onChange={(change) => setCard(card.id, change)}
          onMove={(d) => void onChange((s) => ({ ...s, cards: moveId(s.cards, card.id, d) }), card.id)}
          onRemove={() => void onChange((s) => ({ ...s, cards: s.cards.filter((c) => c.id !== card.id) }), card.id)}
        />
      ))}
      <button class="btn tiny pc-add" onClick={() => void onChange((s) => ({ ...s, cards: [...s.cards, { id: newId('card'), blocks: [] }] }))}>
        <Plus size={11} /> Card
      </button>

      <TextArea
        class="pc-links" rows={Math.max(1, seg.links.length)} value={links}
        placeholder={'Links, one a line: text | https://… (they publish under "Mentioned in this episode")'}
        onCommit={(t) => {
          if (t === links) return undefined;
          const next = t.split('\n').map((line) => {
            const bar = line.lastIndexOf('|');
            const text = bar >= 0 ? line.slice(0, bar).trim() : '';
            const url = (bar >= 0 ? line.slice(bar + 1) : line).trim();
            return /^https?:\/\//.test(url) ? { text, url } : null;
          }).filter((l): l is { text: string; url: string } => Boolean(l));
          return onChange((s) => ({ ...s, links: next }));
        }}
      />
    </div>
  );
}

/**
 * One card: kicker and claim as fields, blocks as text, one per line, typed
 * by a leading mark (`!` trigger, `"` verbatim, `>` bridge, `?` cuttable;
 * `*glance*` inside a line). The chips beneath are what the card will show.
 */
function CardEditor({ card, seg, first, last, onChange, onMove, onRemove }: {
  card: CardT;
  seg: Segment;
  first: boolean;
  last: boolean;
  onChange: (change: Edit<CardT>) => Promise<boolean>;
  onMove: (d: number) => void;
  onRemove: () => void;
}) {
  const text = serializeBlocks(card.blocks);
  const share = cardSeconds(seg, card);
  const set = (key: 'kicker' | 'claim', value: string) => {
    if (value === (card[key] ?? '')) return undefined;
    return onChange((c) => {
      const { [key]: _drop, ...rest } = c;
      return value.trim() ? { ...rest, [key]: value.trim() } : rest;
    });
  };
  return (
    <div class="pc-card">
      <div class="pc-card-head">
        <Input class="pc-kicker" value={card.kicker ?? ''} placeholder="KICKER" onCommit={(t) => set('kicker', t)} />
        <Input class="pc-claim" value={card.claim ?? ''} placeholder="The one thing this beat says" onCommit={(t) => set('claim', t)} />
        <span class="pc-num" title="Planned seconds for this beat; empty shares the segment's minutes evenly">
          <Input
            type="number" min="0" value={card.seconds ?? ''} placeholder={share !== null ? String(Math.round(share)) : 'sec'}
            onCommit={(t) => {
              const seconds = t === '' ? undefined : Number(t);
              if (seconds === card.seconds) return undefined;
              return onChange((c) => {
                const { seconds: _drop, ...rest } = c;
                return seconds === undefined ? rest : { ...rest, seconds };
              });
            }}
          />
          <span class="pc-sub">s</span>
        </span>
        <span class="pc-acts">
          {!first && <button class="btn tiny" title="Move up" onClick={() => onMove(-1)}><ArrowUp size={11} /></button>}
          {!last && <button class="btn tiny" title="Move down" onClick={() => onMove(1)}><ArrowDown size={11} /></button>}
          <button class="btn tiny" title="Remove the card" onClick={onRemove}><X size={11} /></button>
        </span>
      </div>
      <TextArea
        class="pc-blocks" rows={Math.max(2, card.blocks.length + 1)} value={text}
        placeholder={'One block a line.   ! glance word   " say it word for word   > bridge   ? cuttable   *gold* inside a line'}
        onCommit={(t) => {
          const blocks = parseBlocks(t);
          return serializeBlocks(blocks) !== text ? onChange((c) => ({ ...c, blocks })) : undefined;
        }}
      />
      {card.blocks.length > 0 && (
        <div class="pc-chips">
          {card.blocks.map((b, i) => (
            <span key={i} class={`pc-blk pc-blk-${b.t}`} title={b.t}>
              {inlineRuns(b.text).map((r, j) => (r.glance ? <b key={j} class="pc-glance">{r.text}</b> : r.text))}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── audio, transcript, publish ────────────────────────────────────────────

function Audio({ view, run, onError }: { view: EpisodeView; run: Props['run']; onError: Props['onError'] }) {
  const doc = view.episode;
  const id = doc.episode.id;
  const [uploading, setUploading] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const working = uploading !== null || view.busy.mastering;

  const drop = async (file: File | undefined) => {
    if (!file || working) return;
    if (doc.audio && !confirm(`Replace the mastered audio with ${file.name}?`)) return;
    setUploading(file.name);
    try {
      await run(() => podcastApi.upload(id, file));
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setUploading(null);
    }
  };

  return (
    <section class="pc-panel">
      <h3>Audio</h3>
      {doc.audio && (
        <div class="pc-audio">
          <div class="mono">{fmt(doc.audio.duration_seconds)} · {(doc.audio.bytes / 1e6).toFixed(1)} MB</div>
          <div class="pc-sub">from {doc.audio.source_filename}</div>
          {view.audio_on_disk
            ? <audio controls preload="none" src={podcastApi.audioUrl(id, doc.audio.mastered_at)} />
            : <div class="pc-sub">The mastered file is not on this machine; drop the recording again before sending.</div>}
        </div>
      )}
      <label
        class={`pc-drop${over ? ' over' : ''}${working ? ' busy' : ''}`}
        onDragOver={(ev) => { ev.preventDefault(); ev.stopPropagation(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(ev) => { ev.preventDefault(); ev.stopPropagation(); setOver(false); void drop(ev.dataTransfer?.files[0]); }}
      >
        {working
          ? <><Spinner size={12} /> {uploading ? `Mastering ${uploading}…` : 'Mastering…'}</>
          : doc.audio ? 'Drop a new edit to replace it' : 'Drop the edited recording, or choose it'}
        <input
          type="file" accept="audio/*,.wav,.aif,.aiff,.m4a,.mp3,.flac" hidden disabled={working}
          onChange={(ev) => { const f = (ev.currentTarget as HTMLInputElement).files?.[0]; (ev.currentTarget as HTMLInputElement).value = ''; void drop(f); }}
        />
      </label>
      <p class="pc-hint">Mastered on arrival: −16 LUFS, mono, 128k, tagged. The first master stamps the date.</p>
    </section>
  );
}

function Transcribe({ view, run, busy, setBusy }: { view: EpisodeView; run: Props['run']; busy: boolean; setBusy: (b: boolean) => void }) {
  const doc = view.episode;
  if (!doc.audio) return null;
  const working = busy || view.busy.transcribing;
  return (
    <button
      class="btn tiny pc-h-btn" disabled={working || !view.audio_on_disk}
      onClick={async () => {
        const replace = Boolean(doc.transcript?.trim());
        if (replace && !confirm('Replace the transcript with a new draft? Your edits to it are lost.')) return;
        setBusy(true);
        try {
          await run(() => podcastApi.transcribe(doc.episode.id, replace));
        } finally {
          setBusy(false);
        }
      }}
    >
      {working ? <><Spinner size={11} /> Listening…</> : doc.transcript?.trim() ? 'Transcribe again' : 'Transcribe'}
    </button>
  );
}

function Publish({ view, run, onError }: { view: EpisodeView; run: Props['run']; onError: Props['onError'] }) {
  const doc = view.episode;
  const e = doc.episode;
  const send = doc.sends?.another;
  const verify = doc.verify?.another;
  const blocking = view.problems.filter((p) => p.severity === 'blocks');
  const warnings = view.problems.filter((p) => p.severity === 'warns');
  const [pkg, setPkg] = useState<EpisodePackage | null>(null);
  const [sending, setSending] = useState(false);
  const inFlight = sending || view.busy.sending;
  const ever = lastSent(send);

  const go = async () => {
    const again = ever ? ' again (the files it changes are replaced)' : '';
    if (!confirm(`Send Another Thing ${e.number} to another.thingelstad.com${again}? One commit: the page, the transcript and the mp3. The site's build puts it in the feed.`)) return;
    setSending(true);
    try {
      try {
        await run(async () => {
          try {
            return await podcastApi.send(e.id);
          } catch (err) {
            if (err instanceof ApiError && err.code === 'warnings' && confirm(`${err.message}\n\nSend anyway?`)) return podcastApi.send(e.id, true);
            throw err;
          }
        });
      } catch (err) {
        onError((err as Error).message);
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <section class="pc-panel">
      <h3>Send</h3>
      {view.problems.length > 0 && (
        <ul class="pc-problems">
          {blocking.map((p) => <li key={p.text} class="blocks">{p.text}</li>)}
          {warnings.map((p) => <li key={p.text} class="warns">{p.text}</li>)}
        </ul>
      )}
      <div class="pc-row">
        <button class="btn primary small" disabled={blocking.length > 0 || inFlight || view.busy.mastering} onClick={() => void go()}>
          {inFlight ? <><Spinner size={11} /> Sending…</> : ever ? 'Send again' : 'Send to Another'}
        </button>
        <button class="btn small" onClick={() => podcastApi.package(e.id).then(setPkg).catch((err: Error) => onError(err.message))}>
          {pkg ? 'Refresh files' : 'See the files'}
        </button>
      </div>
      {send && send.status !== 'none' && (
        <div class={`pc-state ${send.status}`}>
          <span class="mono">{send.status.toUpperCase()}</span>
          {send.at && <span class="pc-sub"> {new Date(send.at).toLocaleString()}</span>}
          {send.error && <div class="err-note">{send.error}</div>}
          {ever?.url && <div><a href={ever.url} target="_blank" rel="noreferrer">{ever.url.replace('https://', '')}</a></div>}
        </div>
      )}
      {ever && (
        <div class={`pc-verify ${verify?.status ?? 'none'}`}>
          <div class="pc-row">
            <span class="mono">{verify ? `CHECK: ${verify.status.toUpperCase()}` : 'NOT CHECKED'}</span>
            <button class="btn tiny" onClick={() => void run(() => podcastApi.verify(e.id))}>Check again</button>
          </div>
          {verify?.checks.map((c) => (
            <div key={c.label} class={`pc-check-row ${c.ok === true ? 'ok' : c.ok === false ? 'bad' : 'warn'}`}>
              <b>{c.label}</b> {c.detail}
            </div>
          ))}
          {verify?.error && <div class="err-note">{verify.error}</div>}
        </div>
      )}
      {pkg && (
        <div class="pc-package">
          {pkg.error && <div class="err-note">{pkg.error}</div>}
          {pkg.files.map((f) => (
            <details key={f.path}>
              <summary class="mono">{f.path}</summary>
              <pre>{f.content}</pre>
            </details>
          ))}
          {pkg.audio && <div class="mono pc-sub">{pkg.audio.path} · {(pkg.audio.bytes / 1e6).toFixed(1)} MB</div>}
          <div class="pc-sub">to {pkg.repo}</div>
        </div>
      )}
    </section>
  );
}

function MadeIn({ view }: { view: EpisodeView }) {
  const t = view.timing;
  if (!t.actions) return <p class="quiet">Nothing yet. Your time is counted from what you do here.</p>;
  const stages = (['outline', 'record', 'publish'] as const).filter((s) => t.byStage[s] > 0);
  return (
    <div class="pc-made">
      <div><b>{duration(t.activeMs)}</b> <span class="pc-sub">in {t.sittings} sitting{t.sittings === 1 ? '' : 's'}</span></div>
      {stages.map((s) => (
        <div key={s} class="pc-made-row"><span>{STAGE_LABEL[s]}</span><span class="mono">{duration(t.byStage[s])}</span></div>
      ))}
      {t.takes > 0 && <div class="pc-sub">{t.takes} take{t.takes === 1 ? '' : 's'} at the card, {fmt(t.recordedSeconds)} in all</div>}
    </div>
  );
}
