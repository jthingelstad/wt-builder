/**
 * The Send view — its own full-screen layer.
 *
 * Four destinations in run order: Podcast, Website, Buttondown, Archive. The order is
 * the point. The website handoff publishes an audio reference, so the podcast
 * has to have produced a file for that reference to resolve. The server
 * enforces it: a website send is refused until an audio reference is recorded
 * (the podcast's last good send), and the Website card's blocker says so.
 * Every gate here can be overridden (Jamie, 2026-09-29): the card's action
 * becomes the override, and it asks first.
 *
 * Every state here is real. Nothing is drawn: a step shows done only when the
 * send came back with the evidence that step produces.
 */

import { useEffect, useRef, useState } from 'preact/hooks';

import type { Destination, IssueDoc, ScriptReview, SendState, SentRecord, Verification } from '../../shared/types.ts';
import { isOut, lastSent, recordedAudioUrl } from '../../shared/sends.ts';
import { audioScript } from '../../shared/render/audio.ts';
import { findingsSummary, linkFindings } from '../../shared/link-findings.ts';
import { deliverabilityFindings, deliverabilitySummary } from '../../shared/deliverability.ts';
import { duration, type IssueTiming } from '../../shared/timing.ts';
import { ApiError, api, type PodcastAudio, type Readiness, type SendResult } from '../api.ts';
import {
  Archive, ArrowLeft, Check, Circle, CircleAlert, Globe, Mail, Moon, Podcast, Spinner, X,
} from '../icons.tsx';

interface Props {
  doc: IssueDoc;
  readiness: Readiness | null;
  busy: boolean;
  error: string | null;
  onBack: () => void;
  onSent: (doc: IssueDoc) => void;
  onError: (m: string | null) => void;
}

/**
 * What a sent leg has to show: its record as the issue keeps it, so the
 * evidence survives a reload and a trip away (it was read off the send's
 * answer only, and vanished — review 2026-09-27 §2.4), plus the counts
 * only this session's answer carried.
 */
interface Evidence {
  send: SentRecord;
  audio?: PodcastAudio;
  pieces?: number;
  synthesized?: number;
}

interface Step {
  label: string;
  /** The evidence this step produced. */
  evidence?: (r: Evidence) => { text?: string; href?: string; label?: string } | undefined;
}

interface Card {
  key: Destination;
  name: string;
  dest: string;
  icon: preact.JSX.Element;
  /** What finishing actually means. Sending is not the same as authoritative. */
  ends: string;
  verb: string;
  again: string;
  steps: Step[];
  /** A dependency on another leg, shown until it is met. */
  blocker?: (sent: Partial<Record<Destination, boolean>>, doc: IssueDoc) => string | null;
}

const bytes = (n?: number) => (n ? `${(n / 1_048_576).toFixed(1)} MB` : undefined);
const clock = (s?: number) =>
  s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : undefined;

const CARDS: Card[] = [
  {
    key: 'podcast',
    name: 'Podcast',
    dest: 'files.thingelstad.com',
    icon: <Podcast />,
    ends: 'Ends at an mp3 on the CDN. The website publishes the reference to it; the file itself lives only here.',
    verb: 'Synthesize and upload',
    again: 'Synthesize again',
    steps: [
      { label: 'Read the script' },
      { label: 'Render the spoken script' },
      {
        label: 'Synthesize the voice',
        evidence: (r) => (r.audio?.audio_voice
          ? { text: [r.audio.audio_voice, r.pieces && `${r.pieces} blocks${r.synthesized !== undefined ? `, ${r.synthesized} new` : ''}`].filter(Boolean).join(' · ') }
          : undefined),
      },
      {
        label: 'Chapter and transcribe',
        evidence: (r) => (r.audio?.audio_chapters_url
          ? { href: r.audio.audio_chapters_url, label: 'Chapters', text: r.audio.audio_transcript_url ? 'and the WebVTT transcript' : undefined }
          : undefined),
      },
      {
        label: 'Master and tag',
        evidence: (r) => (r.audio?.audio_duration_seconds
          ? { text: [clock(r.audio.audio_duration_seconds), bytes(r.audio.audio_byte_size)].filter(Boolean).join(' · ') }
          : undefined),
      },
      {
        label: 'Upload to the CDN',
        evidence: (r) => (r.audio?.audio_url ? { href: r.audio.audio_url, label: 'File' } : undefined),
      },
    ],
  },
  {
    key: 'website',
    name: 'Website',
    dest: 'weekly.thingelstad.com',
    icon: <Globe />,
    ends: 'Commits the generated inputs to the render surface, which builds and deploys them.',
    verb: 'Commit',
    again: 'Re-commit',
    // An audio reference recorded, not a podcast status: a failed re-render
    // leaves the last episode in place, and the page keeps embedding it.
    blocker: (_sent, doc) => (recordedAudioUrl(doc.sends)
      ? null
      : 'The page embeds the podcast’s audio reference, so the podcast runs first. Committing without it asks first, and the page has no episode until the website is re-committed after the podcast.'),
    steps: [
      { label: 'Render the website edition' },
      {
        label: 'Commit to the repo',
        evidence: (r) => (r.send.external_id
          ? { text: String(r.send.external_id).slice(0, 7), href: r.send.url, label: 'Commit' }
          : undefined),
      },
    ],
  },
  {
    key: 'buttondown',
    name: 'Buttondown',
    dest: 'Buttondown',
    icon: <Mail />,
    ends: 'Ends at a draft: WT Builder never schedules or sends, so a wrong draft reaches no reader. You send it from Buttondown, and Verify follows it until it has gone.',
    verb: 'Create draft',
    again: 'Update draft',
    steps: [
      { label: 'Render the email edition' },
      {
        label: 'Create the draft',
        // The editor, not the public archive: the draft is opened to be scheduled.
        evidence: (r) => (r.send.edit_url ?? r.send.url ? { href: r.send.edit_url ?? r.send.url!, label: 'Draft' } : undefined),
      },
    ],
  },
  {
    // A leg like the others (Jamie, WT351): the archive is where Thingy
    // answers from, and it is how the issue lasts. It runs last because it
    // holds published issues only — a draft committed here would put
    // unpublished text in front of readers asking Thingy.
    key: 'archive',
    name: 'Archive',
    dest: 'librarian-thing',
    icon: <Archive />,
    ends: 'Commits the canonical text to the corpus repository, where the Librarian indexes it and Thingy retrieves from it.',
    verb: 'Commit to archive',
    again: 'Re-commit',
    blocker: (sent) => (sent.website && sent.buttondown
      ? null
      : 'The archive holds published issues, so it goes after the website and Buttondown legs.'),
    steps: [
      { label: 'Render the archive files' },
      {
        label: 'Commit to the corpus',
        evidence: (r) => (r.send.external_id
          ? { text: String(r.send.external_id).slice(0, 7), href: r.send.url, label: 'Commit' }
          : undefined),
      },
    ],
  },
];

/** "Website, Buttondown and Archive": the legs a bulk run asks about, by card name. */
function legNames(keys: Destination[]): string {
  const names = keys.map((k) => CARDS.find((c) => c.key === k)!.name);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names.join('');
}

const PILL: Record<string, string> = {
  none: 'NOT SENT', gate: 'NEEDS YOU', sending: 'SENDING', sent: 'SENT', failed: 'DID NOT SEND',
};

export function Send({ doc, readiness, error, onBack, onSent, onError }: Props) {
  const [running, setRunning] = useState<Destination | null>(null);
  const [results, setResults] = useState<Partial<Record<Destination, SendResult>>>({});
  // Leaving the view stops a bulk run between legs: the leg that is out
  // finishes, and nothing after it starts (review 2026-09-27 §2.4).
  const cancelled = useRef(false);
  useEffect(() => () => { cancelled.current = true; }, []);
  const back = () => {
    cancelled.current = true;
    onBack();
  };

  const id = doc.issue.id;
  const stateOf = (key: Destination) => doc.sends?.[key]?.status ?? 'none';
  // What the blockers ask: has the leg gone out? Once it has ever sent it
  // has, and a failed re-send since does not undo that — the server derives
  // published the same way (recordSend).
  const sentMap = Object.fromEntries(CARDS.map((c) => [c.key, Boolean(lastSent(doc.sends?.[c.key]))]));
  const sentCount = CARDS.filter((c) => stateOf(c.key) === 'sent').length;

  // The gate is persisted and tied to the script that was read: approval
  // survives a reload (it did not — WT351) and lapses if the script changes.
  // A podcast that has ever gone out needs no gate, even after a failed
  // re-send: the server exempts the same (Jamie, 2026-09-29).
  const scriptHash = useScriptHash(doc);
  const review = doc.script_review;
  const reviewCurrent = Boolean(review && scriptHash && review.script_hash === scriptHash);
  const approved = sentMap.podcast || (reviewCurrent && Boolean(review?.approved_at));
  const [reading, setReading] = useState(false);
  const readScript = () => {
    setReading(true);
    onError(null);
    api.scriptReview(id).then((r) => onSent(r.issue)).catch((err: Error) => onError(`script: ${err.message}`)).finally(() => setReading(false));
  };
  const approveScript = () => {
    api.scriptApprove(id).then((r) => onSent(r.issue)).catch((err: Error) => onError(`script: ${err.message}`));
  };
  // Verification runs on the server after each leg — a couple of minutes for
  // the podcast's listening, the site's deploy for the website — so while any
  // is running the view re-reads the issue until the results land.
  const verifying = CARDS.some((c) => doc.verify?.[c.key]?.status === 'running');
  const waiting = CARDS.some((c) => doc.verify?.[c.key]?.status === 'waiting');
  useEffect(() => {
    if (!verifying && !waiting) return;
    const t = setInterval(() => {
      api.getIssue(id).then((r) => onSent(r.issue)).catch(() => { /* next tick */ });
    }, verifying ? 5000 : 60_000);
    return () => clearInterval(t);
  }, [verifying, waiting, id]);

  // Opened, the view reads the issue again rather than trusting the copy
  // the editor held: a leg may have moved since (review 2026-09-27 §2.4).
  useEffect(() => {
    api.getIssue(id).then((r) => onSent(r.issue)).catch(() => { /* the copy on screen stands */ });
  }, [id]);

  // A leg is out whenever the server says so, not only while this view's
  // own request is: after leaving and coming back, or a reload, a sending
  // leg looked unsent and could be pressed again (review 2026-09-27 §2.4).
  // While one is out, nothing else starts, as for a leg sent from here, and
  // the view re-reads the issue until it lands: at three seconds, then less
  // often the longer it stays out, to every thirty. A `sending` older than
  // the server's in-flight window is stranded (a crash, a restart): the
  // server lets a retry through, so it blocks nothing here and is not
  // polled; the server's 409 stays the backstop (Batch 6 review).
  const outOnServer = CARDS.some((c) => isOut(doc.sends?.[c.key]));
  const stranded = (key: Destination) => stateOf(key) === 'sending' && !isOut(doc.sends?.[key]);
  const sending = Boolean(running) || outOnServer;
  useEffect(() => {
    if (!outOnServer) return;
    let live = true;
    let delay = 3000;
    let timer: ReturnType<typeof setTimeout>;
    const next = () => {
      timer = setTimeout(() => {
        api.getIssue(id)
          .then((r) => { if (live) onSent(r.issue); })
          .catch(() => { /* next tick */ })
          .finally(() => {
            if (!live) return;
            delay = Math.min(delay * 2, 30_000);
            next();
          });
      }, delay);
    };
    next();
    return () => { live = false; clearTimeout(timer); };
  }, [outOnServer, id]);

  const verify = (key: Destination) => {
    api.verify(id, key).then((r) => onSent(r.issue)).catch((err: Error) => onError(`${key}: ${err.message}`));
  };

  // A draft is edited as it stands. Once the Buttondown check last read the
  // email as anything else — scheduled, going out, sent — the server refuses
  // a plain re-send, so the card says what an update would do and offers
  // "Update anyway…", and the bulk runs leave it out.
  const remoteStatus = doc.verify?.buttondown?.remote_status;
  const links = linkFindings(doc);
  const deadLinks = links.unaccepted;
  const [checkingLinks, setCheckingLinks] = useState(false);
  const checkLinks = async () => {
    setCheckingLinks(true);
    onError(null);
    try {
      onSent((await api.checkLinks(id)).issue);
    } catch (err) {
      onError(`links: ${(err as Error).message}`);
    } finally {
      setCheckingLinks(false);
    }
  };
  const emailLocked = remoteStatus && remoteStatus !== 'draft' ? remoteStatus : undefined;
  // Will the email reach the inbox (2026-10-01): a listed domain asks before
  // the email goes, as a dead link does; the rest are warnings with "Keep".
  const mail = deliverabilityFindings(doc);
  const listedDomains = mail.unaccepted;
  const [keeping, setKeeping] = useState<string | null>(null);
  const keepFinding = async (key: string) => {
    setKeeping(key);
    onError(null);
    try {
      onSent((await api.keepFinding(id, key)).issue);
    } catch (err) {
      onError(`deliverability: ${(err as Error).message}`);
    } finally {
      setKeeping(null);
    }
  };

  /**
   * A card's override, while its gate holds: the podcast's approval, the
   * website's audio, Buttondown's draft. Nothing in Jamie's own tool is
   * beyond overriding (2026-09-29), so the card keeps its action — named
   * for what it skips, plain rather than primary — and it asks first with
   * what going past the gate means. The bulk runs never override: each is
   * a decision on its own card.
   */
  const overrideOf = (key: Destination): { label: string; warning: string } | undefined => {
    const gate = gateOf(key);
    // Dead links stop the website and the email (plan 2026-10-01 §3). The
    // server checked them on the first click and refused with dead_links;
    // the re-read put them here, so this click asks. Sending anyway keeps
    // them, and later sends do not ask about them again.
    const n = doc.issue.number;
    // A domain on a spam blocklist stops the email alone (listed_domains):
    // one ?force=1 passes every gate, so whichever card asks names it too.
    const listed = key === 'buttondown' && listedDomains.length
      ? `${listedDomains.length} domain${listedDomains.length === 1 ? '' : 's'} on a spam blocklist: ${listedDomains.slice(0, 3).map((d) => `${d.domain} (${(d.result?.lists ?? []).join('; ')})`).join(', ')}${listedDomains.length > 3 ? ', …' : ''}. Filters may send the whole issue to spam.`
      : '';
    if ((key === 'website' || key === 'buttondown') && deadLinks.length) {
      const list = `${deadLinks.length} dead link${deadLinks.length === 1 ? '' : 's'}: ${deadLinks.slice(0, 3).map((l) => l.url).join(', ')}${deadLinks.length > 3 ? ', …' : ''}.`;
      const also = listed ? `\n\nThe email also links ${listed}` : '';
      if (gate) return { label: gate.label, warning: `${gate.warning}\n\nWT${n} also has ${list} They are kept as they are.${also}` };
      return {
        label: key === 'website' ? (stateOf('website') === 'sent' ? 'Re-commit with dead links…' : 'Commit with dead links…') : 'Send with dead links…',
        warning: `WT${n} has ${list} Send anyway? They are kept as they are, and later sends will not ask about them again.${also}`,
      };
    }
    if (listed) {
      if (gate) return { label: gate.label, warning: `${gate.warning}\n\nWT${n}'s email also links ${listed}` };
      return {
        label: 'Send with a blocklisted domain…',
        warning: `WT${n}'s email links ${listed} Send anyway? Later sends will not ask about ${listedDomains.length === 1 ? 'it' : 'them'} again while ${listedDomains.length === 1 ? 'it stays' : 'they stay'} listed.`,
      };
    }
    return gate;
  };

  const gateOf = (key: Destination): { label: string; warning: string } | undefined => {
    const n = doc.issue.number;
    if (key === 'podcast' && !approved) {
      return {
        label: 'Send without approval…',
        warning: !review
          ? `WT${n}'s podcast script has not been read or approved. Synthesize it unread and upload the mp3 to the CDN?`
          : !reviewCurrent
            ? `WT${n}'s podcast script has changed since it was read. Synthesize it as it stands, unread, and upload the mp3 to the CDN?`
            : `WT${n}'s podcast script has been read but not approved. Synthesize it as it stands and upload the mp3 to the CDN?`,
      };
    }
    if (key === 'website' && !recordedAudioUrl(doc.sends)) {
      return {
        label: stateOf('website') === 'sent' ? 'Re-commit without audio…' : 'Commit without audio…',
        warning: `WT${n} has no podcast audio recorded. Commit the page without an episode? It has none until the website is re-committed after the podcast.`,
      };
    }
    if (key === 'buttondown' && emailLocked) {
      return {
        label: 'Update anyway…',
        warning: `Buttondown says WT${n}'s email is "${emailLocked}", not a draft. ${notDraftRisk(emailLocked)} Update it anyway?`,
      };
    }
    return undefined;
  };

  /**
   * One leg. `sent` when it went; a failure is shown and stops any run it is
   * part of. Any failure reads the issue again, so the card says what the
   * server recorded. `locked` is Buttondown refusing because the email is no
   * longer a draft: the server has recorded that, so the card drops its
   * action at once, and a run carries on past it — the legs after it do not
   * depend on it.
   */
  const send = async (key: Destination, force = false): Promise<'sent' | 'failed' | 'locked'> => {
    setRunning(key);
    onError(null);
    try {
      const res = await api.send(id, key, force);
      setResults((r) => ({ ...r, [key]: res }));
      onSent(res.issue);
      return 'sent';
    } catch (err) {
      onError(`${key}: ${(err as Error).message}`);
      // The card shows what the server recorded, not what it held before the
      // send: a failure kept the pre-send state, so a failed re-send stayed a
      // green SENT with the old VERIFIED panel (review 2026-09-27 §2.4).
      await api.getIssue(id).then((r) => onSent(r.issue)).catch(() => { /* the next poll */ });
      if (err instanceof ApiError && err.code === 'not_draft') return 'locked';
      return 'failed';
    } finally {
      setRunning(null);
    }
  };

  /**
   * The legs "Send all four" / "Send the rest" would run, in run order. An
   * unapproved podcast stops the run before it starts: later legs assume it.
   */
  const emailLeftOut = ` Buttondown is left out: the email is "${emailLocked}", and its own card updates it anyway if you ask.`;
  const rest: Destination[] = [];
  for (const card of CARDS) {
    if (card.key === 'podcast' && !approved) break;
    if (stateOf(card.key) === 'sent') continue;
    if (card.key === 'buttondown' && emailLocked) continue;
    rest.push(card.key);
  }

  /**
   * Run order, stopping at the first failure — later legs assume earlier ones.
   * Asked first, naming the legs: the editor's Publish button sits where this
   * one does, so a double-click on it used to land here and send three legs
   * in one gesture (review 2026-09-27 §2.4).
   */
  const sendAll = async () => {
    if (!rest.length) return;
    const leftOut = emailLocked && stateOf('buttondown') !== 'sent' ? emailLeftOut : '';
    if (!confirm(`Send ${legNames(rest)} for WT${doc.issue.number}, in that order?${leftOut}`)) return;
    cancelled.current = false;
    for (const key of rest) {
      if (cancelled.current || (await send(key)) === 'failed') return;
    }
  };

  /**
   * After a fix, every text leg that has already gone out goes out again, in
   * run order: website, Buttondown, archive. WT350's send day ended with an
   * hour of re-sending those three by hand, twice (Jamie, 2026-09-20). The
   * podcast is not among them — re-sending it re-synthesizes and replaces
   * the mp3, which a text fix never wants; its own card does that on purpose.
   */
  const RESEND: Destination[] = ['website', 'buttondown', 'archive'];
  const resendable = RESEND.filter((key) => stateOf(key) === 'sent' && !(key === 'buttondown' && emailLocked));
  const resendAll = async () => {
    const leftOut = emailLocked && stateOf('buttondown') === 'sent' ? emailLeftOut : '';
    if (!confirm(`Re-send ${legNames(resendable)} for WT${doc.issue.number}, in that order? The podcast is left as it is.${leftOut}`)) return;
    cancelled.current = false;
    for (const key of resendable) {
      if (cancelled.current || (await send(key)) === 'failed') return;
    }
  };

  return (
    <div class="send-layer">
      <header class="header">
        <button class="btn ghost-btn" onClick={back}><ArrowLeft /> Issue</button>
        <span class="mark">W</span>
        <span class="head-divider" />
        <span class="identity">
          <span class="wt">WT{doc.issue.number}</span>
          <span class="win">{doc.issue.title}</span>
        </span>
        <span class="head-spacer" />
        {resendable.length > 0 && (
          <button
            class="btn" disabled={sending} onClick={resendAll}
            title={`Re-send ${resendable.join(', ')} in order. The podcast is left as it is — its card re-synthesizes on purpose.`}
          >
            Re-send all sent
          </button>
        )}
        {sentCount < CARDS.length && (
          <button class="btn primary" disabled={sending} onClick={sendAll}>
            {sentCount > 0 ? 'Send the rest' : 'Send all four'}
          </button>
        )}
      </header>

      <div class="send-body">
        <h1>Send</h1>
        <p class="lede">
          Each destination is its own leg, and none of them makes the issue
          authoritative — the archive does that, afterwards. A leg that fails
          leaves the others untouched.
        </p>

        {readiness && readiness.done < readiness.total && (
          <div class="send-warn">
            <CircleAlert />
            <span>
              {readiness.total - readiness.done} of {readiness.total} things on the
              checklist are still open. Nothing here is blocked by that.
            </span>
          </div>
        )}

        {links.links.length > 0 && (
          <div class="send-warn">
            <CircleAlert />
            <span>
              {!doc.link_check
                ? `${links.links.length} links, not checked yet. The website and the email check them before they go.`
                : findingsSummary(links)
                  ? `Links: ${findingsSummary(links)}. The inspector has each one.${deadLinks.length ? ' The website and the email ask before sending with a dead link.' : ''}`
                  : `All ${links.links.length} links answered.`}
            </span>
            <button class="btn" disabled={checkingLinks} onClick={() => void checkLinks()}>
              {checkingLinks ? 'Checking…' : doc.link_check ? 'Check again' : 'Check links'}
            </button>
          </div>
        )}

        {mail.domains.length > 0 && (
          <div class="send-warn send-mail">
            <CircleAlert />
            <div class="send-mail-body">
              <span>
                {!doc.domain_check && !mail.open.length
                  ? `Deliverability: ${mail.domains.length} domains, not looked up yet. The email checks them against the spam blocklists before it goes.`
                  : deliverabilitySummary(mail)
                    ? `Deliverability: ${deliverabilitySummary(mail)}.${listedDomains.length ? ' The email asks before sending with a blocklisted domain.' : ''}`
                    : `Deliverability: ${mail.domains.length} domains on no blocklist${doc.domain_check ? ` (${[...new Set(mail.domains.flatMap((d) => d.result?.asked ?? []))].join(', ') || 'no list answered'})` : ''}, and nothing in the email a filter holds against it.`}
              </span>
              {(listedDomains.length > 0 || mail.open.length > 0 || mail.unchecked.length > 0) && (
                <ul class="send-mail-list">
                  {listedDomains.map((d) => (
                    <li key={`listed:${d.domain}`}>
                      <strong>{d.domain}</strong> — {(d.result?.lists ?? []).join('; ')}. Linked as {d.urls.slice(0, 2).join(', ')}{d.urls.length > 2 ? ', …' : ''}.
                    </li>
                  ))}
                  {mail.open.map((f) => (
                    <li key={f.key}>
                      {f.message}
                      <button class="btn small" disabled={keeping === f.key} onClick={() => void keepFinding(f.key)}>
                        {keeping === f.key ? 'Keeping…' : 'Keep'}
                      </button>
                    </li>
                  ))}
                  {mail.unchecked.length > 0 && (
                    <li key="unchecked">
                      No blocklist answered for {mail.unchecked.map((d) => d.domain).slice(0, 4).join(', ')}{mail.unchecked.length > 4 ? ', …' : ''}: {mail.unchecked[0]?.result?.note}
                    </li>
                  )}
                </ul>
              )}
            </div>
          </div>
        )}

        {error && <div class="error-bar" role="alert">{error}</div>}

        {CARDS.map((card) => (
          <SendCard
            key={card.key}
            card={card}
            state={running === card.key ? 'sending' : stateOf(card.key)}
            stranded={running !== card.key && stranded(card.key)}
            send={doc.sends?.[card.key]}
            result={results[card.key]}
            blocker={card.blocker?.(sentMap, doc) ?? null}
            gated={card.key === 'podcast' && !approved}
            busy={sending || Boolean(doc.issue.put_to_bed_at)}
            onApprove={approveScript}
            gate={card.key === 'podcast' ? { review: reviewCurrent ? review : undefined, stale: Boolean(review) && !reviewCurrent, reading, onRead: readScript, approved } : undefined}
            locked={card.key === 'buttondown' ? emailLocked : undefined}
            override={overrideOf(card.key)?.label}
            onRun={() => {
              const override = overrideOf(card.key);
              if (override && !confirm(override.warning)) return;
              void send(card.key, Boolean(override));
            }}
            issueId={id}
            verification={doc.verify?.[card.key]}
            onVerify={() => verify(card.key)}
          />
        ))}

        <Timing doc={doc} />

        <Bed doc={doc} onChanged={onSent} onError={onError} />

      </div>
    </div>
  );
}

/**
 * What the archive commit would change in the corpus repository, changing
 * nothing — a draft must never be committed there, and this is how to look
 * before committing (or before re-committing after a fix).
 */
function ArchivePreview({ issueId }: { issueId: string }) {
  const [preview, setPreview] = useState<{ repo: string; changed: string[]; unchanged: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const load = () => {
    setLoading(true);
    setErr(null);
    api.sendPreview(issueId, 'archive')
      .then(setPreview)
      .catch((e: Error) => setErr(e.message))
      .finally(() => setLoading(false));
  };
  return (
    <div class="sc-preview">
      <div class="sv-head">
        <span class="mono-label">PREVIEW</span>
        <span class="head-spacer" />
        <button class="btn small" disabled={loading} onClick={load}>{loading ? 'Diffing…' : 'What would change'}</button>
      </div>
      {err && <div class="sc-evidence error">{err}</div>}
      {preview && (
        <div class="after-preview">
          <span class="mono-label">WOULD COMMIT TO {preview.repo.toUpperCase()}</span>
          {preview.changed.length === 0
            ? <span class="quiet">Nothing — the corpus already matches this issue.</span>
            : preview.changed.map((f) => <code key={f}>~ {f}</code>)}
        </div>
      )}
    </div>
  );
}

function SendCard({
  card, state, stranded, send, result, blocker, gated, busy, onApprove, onRun, verification, onVerify, issueId, gate, locked, override,
}: {
  /** `sending` past the in-flight window: out no longer, and retried like a failure. */
  stranded?: boolean;
  /** Buttondown's status for an email that is no longer a draft: why, and what an update would do. */
  locked?: string;
  /** While a gate holds, the action's label: it goes past the gate, and asks first. */
  override?: string;
  gate?: { review?: ScriptReview; stale: boolean; reading: boolean; onRead: () => void; approved: boolean };
  issueId: string;
  verification?: Verification;
  onVerify: () => void;
  card: Card;
  state: string;
  send?: SendState;
  result?: SendResult;
  blocker: string | null;
  gated: boolean;
  busy: boolean;
  onApprove: () => void;
  onRun: () => void;
}) {
  const pillState = gated && state === 'none' ? 'gate' : state;
  const done = state === 'sent';
  const failed = state === 'failed';
  const last = failed ? lastSent(send) : undefined;
  const lastLink = last && lastGoodLink(card.key, last);
  const sentRecord = done ? lastSent(send) : undefined;
  const shown: Evidence | undefined = sentRecord && {
    send: sentRecord,
    audio: sentRecord.audio as PodcastAudio | undefined,
    pieces: result?.pieces,
    synthesized: result?.synthesized,
  };

  return (
    <section class={`send-card ${state}${failed ? ' failed' : ''}`}>
      <div class="sc-head">
        <span class={`sc-tile${done ? ' done' : ''}`}>{card.icon}</span>
        <div class="sc-name">
          <div class="sc-title">
            {card.name}
            <span class={`sc-pill ${pillState}`}>{PILL[pillState]}</span>
          </div>
          <div class="sc-dest">{card.dest}</div>
          <p class="sc-ends">{card.ends}</p>
        </div>
        {/*
          While a gate holds, the action is its override — named for what it
          skips, plain rather than primary, and it asks first. Reading and
          approving the script stay in the step row. Never a label that only
          repeats the pill beside it.
        */}
        <button class={override ? 'btn' : 'btn primary'} disabled={busy} onClick={onRun}>
          {state === 'sending' && !stranded ? 'Sending…' : override ?? (failed || stranded ? 'Try again' : done ? card.again : card.verb)}
        </button>
      </div>

      {locked && (
        <div class="sc-blocker sc-locked">
          <CircleAlert />
          <span>
            Buttondown says this email is "{locked}", no longer a draft.{' '}
            {notDraftRisk(locked)} "Update anyway…" asks first.
          </span>
        </div>
      )}

      {blocker && !done && (
        <div class="sc-blocker"><CircleAlert /><span>{blocker}</span></div>
      )}

      {failed && (
        <div class="sc-failed">
          <div>
            <span>
              This leg did not send. The others are unaffected, and trying again
              resumes from the step that failed.
            </span>
            {/* What the destination still holds from the last send that worked. */}
            {last && (
              <div class="sc-last-good">
                Last good: {last.at ? new Date(last.at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : 'earlier'}
                {lastLink?.href && (
                  <> · <a href={lastLink.href} target="_blank" rel="noreferrer">{lastLink.label} ↗</a></>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <div class="sc-steps">
        {card.steps.map((step, i) => {
          const isGate = card.key === 'podcast' && i === 0;
          const stepDone = isGate ? !gated : done;
          const stepFailed = failed && i === card.steps.length - 1;
          const evidence = shown ? step.evidence?.(shown) : undefined;

          return (
            <div class="sc-step" key={step.label}>
              <span class="sc-glyph">
                {stepFailed ? <X size={13} class="failed" />
                  : stepDone ? <Check size={13} class="ok" />
                  : state === 'sending' && !stranded ? <Spinner size={13} />
                  : <Circle size={13} class="idle" />}
              </span>
              <div class="sc-step-main">
                <div class="sc-step-label">{step.label}</div>
                {stepFailed && send?.error && <div class="sc-evidence error">{send.error}</div>}
                {isGate && gate && <ScriptReviewNote gate={gate} />}
                {evidence?.text && <div class="sc-evidence">{evidence.text}</div>}
                {evidence?.href && (
                  <a class="sc-evidence link" href={evidence.href} target="_blank" rel="noreferrer">
                    {evidence.label ?? 'Open'} ↗
                  </a>
                )}
              </div>
              {isGate && gated && (
                <span class="sc-gate">
                  <button class="btn small" disabled={gate?.reading} onClick={gate?.onRead}>
                    {gate?.reading ? 'Reading…' : gate?.review ? 'Read again' : 'Have it read'}
                  </button>
                  <button class="btn small primary" disabled={!gate?.review} onClick={onApprove}
                    title={gate?.review ? 'Approve this script for synthesis' : 'Have it read first'}>
                    Approve
                  </button>
                </span>
              )}
            </div>
          );
        })}
      </div>

      {card.key === 'archive' && <ArchivePreview issueId={issueId} />}
      {done && <VerifyPanel v={verification} busy={busy} onVerify={onVerify} />}
    </section>
  );
}

/**
 * What updating an email Buttondown no longer holds as a draft would do.
 * The update carries subject and body only, never a status, so it never
 * schedules or sends anything.
 */
function notDraftRisk(status: string): string {
  if (status === 'sent') return 'Readers already have it: an update changes only Buttondown’s copy, and nothing is sent again.';
  if (status === 'scheduled') return 'An update changes what goes out, and it stays scheduled.';
  if (status === 'about_to_send' || status === 'in_flight') {
    return 'It is going out right now: an update races the delivery, so some readers may get the old version and some the new.';
  }
  return 'An update changes its subject and body only, never its status.';
}

/** Where the last good send can be opened: the draft, the mp3, the commit. */
function lastGoodLink(key: Destination, s: SentRecord): { href?: string; label: string } {
  if (key === 'buttondown') return { href: s.edit_url ?? s.url, label: 'Draft' };
  if (key === 'podcast') return { href: s.url, label: 'File' };
  return { href: s.url, label: s.external_id ? String(s.external_id).slice(0, 7) : 'Commit' };
}

const VERDICT: Record<Verification['status'], string> = {
  running: 'CHECKING', passed: 'VERIFIED', waiting: 'WAITING', warnings: 'LOOK AT THIS', problems: 'NOT RIGHT', error: 'COULD NOT CHECK',
};

/**
 * What the destination says now, read back after the leg went out: the files
 * on the CDN, the live page and feed, the draft in Buttondown, the audio as
 * whisper hears it. Sent is not the same as right; this is the second half.
 */
function VerifyPanel({ v, busy, onVerify }: { v?: Verification; busy: boolean; onVerify: () => void }) {
  const running = v?.status === 'running';
  return (
    <div class={`sc-verify ${v?.status ?? 'none'}`}>
      <div class="sv-head">
        <span class="mono-label">VERIFY</span>
        {v && <span class={`sc-pill ${v.status}`}>{VERDICT[v.status]}</span>}
        {running && <Spinner size={12} />}
        {v && !running && <span class="sv-at">{new Date(v.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>}
        <span class="head-spacer" />
        <button class="btn small" disabled={busy || running} onClick={onVerify}>
          {v ? 'Check again' : 'Check it'}
        </button>
      </div>
      {!v && <div class="sv-none">Not checked yet.</div>}
      {running && v.checks.length === 0 && <div class="sv-none">Reading it back from the destination…</div>}
      {v?.error && <div class="sc-evidence error">{v.error}</div>}
      {v?.status === 'waiting' && v.recheck_at && (
        <div class="sv-none">Looking again on its own at {new Date(v.recheck_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.</div>
      )}
      {v?.checks.map((c) => (
        <div class="sc-step" key={c.label}>
          <span class="sc-glyph">
            {c.ok === true ? <Check size={13} class="ok" /> : c.ok === false ? <X size={13} class="failed" /> : <CircleAlert size={13} class="warn" />}
          </span>
          <div class="sc-step-main">
            <div class="sc-step-label">{c.label}</div>
            <div class="sc-evidence">{c.detail}</div>
            {c.items?.map((it) => <div class="sc-evidence item" key={it}>{it}</div>)}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * What the model heard in the script: a summary, and each place a listener
 * would stumble with the block it is in. The words are quoted, not rewritten.
 */
function ScriptReviewNote({ gate }: { gate: { review?: ScriptReview; stale: boolean; approved: boolean } }) {
  const r = gate.review;
  if (gate.stale && !r) return <div class="sc-evidence">The script changed after it was read — have it read again.</div>;
  if (!r) return <div class="sc-evidence">A model reads the script for the ear — markup, symbols, cut-off text — before the voice does.</div>;
  return (
    <div class="script-review">
      <div class={`sc-evidence ${r.verdict === 'ready' ? '' : 'warn'}`}>
        {r.verdict === 'ready' ? 'Ready to speak' : `${r.findings.length} to look at`}
        {' · '}{r.summary}
        {r.approved_at && ` · approved ${new Date(r.approved_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`}
      </div>
      {r.findings.map((f, i) => (
        <div class="sc-evidence item" key={i}>
          [{f.block}] “{f.quote}” — {f.problem}{f.suggestion ? ` Say: “${f.suggestion}”` : ''}
        </div>
      ))}
    </div>
  );
}

/** The spoken script's sha256, as the server hashes it — async, so a hook. */
function useScriptHash(doc: IssueDoc): string | null {
  const [hash, setHash] = useState<string | null>(null);
  const text = audioScript(doc).map((b) => b.text).join('\n');
  useEffect(() => {
    let live = true;
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then((buf) => {
      if (live) setHash([...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join(''));
    });
    return () => { live = false; };
  }, [text]);
  return hash;
}

/**
 * The last thing on the page, and Jamie's own act: put the issue to bed
 * once it is out. Never automatic — WT350 needed fixes and re-sends after
 * publishing. Asleep, the server refuses every change until it is woken.
 */
function Bed({ doc, onChanged, onError }: { doc: IssueDoc; onChanged: (d: IssueDoc) => void; onError: (m: string | null) => void }) {
  const [busy, setBusy] = useState(false);
  const asleep = doc.issue.put_to_bed_at;
  const published = doc.issue.status === 'published';
  const unverified = CARDS.filter((c) => doc.sends?.[c.key]?.status === 'sent' && doc.verify?.[c.key]?.status !== 'passed');
  // Not sent means never gone out: a failed re-send still went once. That
  // failure is said on its own line, so it shows in some list — a warning,
  // like the others, and never a gate.
  const unsent = CARDS.filter((c) => !lastSent(doc.sends?.[c.key]));
  const failedSince = CARDS.filter((c) => doc.sends?.[c.key]?.status === 'failed' && lastSent(doc.sends?.[c.key]));
  const act = (sleep: boolean) => {
    if (!sleep && !confirm(`Wake WT${doc.issue.number}? It becomes editable and re-sendable again.`)) return;
    setBusy(true);
    api.bed(doc.issue.id, sleep).then((r) => onChanged(r.issue)).catch((e: Error) => onError(e.message)).finally(() => setBusy(false));
  };
  return (
    <section class={`send-card bed${asleep ? ' sent' : ''}`}>
      <div class="sc-head">
        <span class={`sc-tile${asleep ? ' done' : ''}`}><Moon /></span>
        <div class="sc-name">
          <div class="sc-title">
            Put to bed
            <span class={`sc-pill ${asleep ? 'sent' : 'none'}`}>{asleep ? 'ASLEEP' : 'AWAKE'}</span>
          </div>
          <p class="sc-ends">
            {asleep
              ? `Put to bed ${new Date(asleep).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}. Nothing can change — no edits, no sends — until it is woken.`
              : 'The last thing: the issue is finished, and nothing in it can change by accident. Waking it is always one deliberate click away.'}
          </p>
        </div>
        {asleep
          ? <button class="btn" disabled={busy} onClick={() => act(false)}>Wake it</button>
          : <button class="btn primary" disabled={busy || !published} onClick={() => act(true)}>Put to bed</button>}
      </div>
      {!asleep && !published && (
        <div class="sc-blocker"><CircleAlert /><span>Only a published issue goes to bed — the website and Buttondown legs send it.</span></div>
      )}
      {!asleep && published && (unsent.length > 0 || unverified.length > 0 || failedSince.length > 0) && (
        <div class="sc-blocker"><CircleAlert /><span>
          {[unsent.length ? `Not sent: ${unsent.map((c) => c.name).join(', ')}.` : '',
            unverified.length ? `Not verified yet: ${unverified.map((c) => c.name).join(', ')}.` : '',
            failedSince.length ? `Last attempt failed: ${failedSince.map((c) => c.name).join(', ')}.` : ''].filter(Boolean).join(' ')}
          {' '}It can still go to bed.
        </span></div>
      )}
    </section>
  );
}

/**
 * How long the issue took, from its event log — beside the Builder issue
 * before it, with what shipped in WT Builder between the two, so a feature's
 * effect on the time can be seen (Jamie, WT351: "did it save me time!").
 * Jamie's own acts only; sittings split at 30 minutes apart.
 */
function Timing({ doc }: { doc: IssueDoc }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.timing>> | null>(null);
  const [showShipped, setShowShipped] = useState(false);
  const sentKey = CARDS.map((c) => doc.sends?.[c.key]?.status ?? '').join('|');
  useEffect(() => {
    api.timing(doc.issue.id).then(setData).catch(() => setData(null));
  }, [doc.issue.id, sentKey]);
  if (!data || !data.timing.actions) return null;
  const t = data.timing;
  const p = data.previous?.timing;
  const total = t.activeMs + t.after.ms;
  const prevTotal = p ? p.activeMs + p.after.ms : 0;
  const delta = p && p.actions ? total - prevTotal : null;
  const max = Math.max(...t.bySection.map((s) => s.ms), 1);
  const dayMax = Math.max(...t.byDay.map((d) => d.ms), 1);
  // A sitting of one act has no length; "0 m" reads as nothing happened.
  const time = (ms: number) => (ms < 60_000 ? '<1 m' : duration(ms));
  const days = t.byDay.filter((d) => d.sittings).length;
  const after = !t.publishedAt ? ''
    : t.after.ms >= 60_000 ? `${duration(t.after.ms)} fixing after it went`
      : t.after.sends ? `${t.after.sends} re-send after it went`
        : 'nothing to fix after it went';
  return (
    <section class="send-card timing">
      <div class="sc-head">
        <div class="sc-name">
          <div class="sc-title">
            {t.publishedAt ? 'Made in' : 'So far'} {duration(total)}
            {delta !== null && (
              <span class={`sc-pill ${delta <= 0 ? 'sent' : 'sending'}`}>
                {delta <= 0 ? `${duration(-delta)} less than WT${data.previous!.number}` : `${duration(delta)} more than WT${data.previous!.number}`}
              </span>
            )}
          </div>
          <p class="sc-ends">
            {[
              `${t.sessions.length} sitting${t.sessions.length === 1 ? '' : 's'} on ${days} day${days === 1 ? '' : 's'}`,
              `${t.actions} actions, ${t.edits} edits`,
              t.sendMs !== undefined ? `sent in ${time(t.sendMs)}` : '',
              after,
            ].filter(Boolean).join(' · ')}
          </p>
        </div>
      </div>
      <div class="tm-body">
        <div class="tm-sections">
          <span class="mono-label">WHERE THE TIME WENT</span>
          {t.bySection.map((s) => (
            <div class="tm-row" key={s.label}>
              <span class="tm-label">{s.label}</span>
              <span class="tm-bar"><span style={{ width: `${(s.ms / max) * 100}%` }} /></span>
              <span class="tm-ms">{time(s.ms)}</span>
            </div>
          ))}
        </div>
        <div class="tm-sections tm-days">
          <div class="tm-days-head">
            <span class="mono-label">BY DAY</span>
            <span class="mono-label tm-legend"><span class="tm-dot" /> a sitting · <b>+n</b> pills added</span>
          </div>
          {t.byDay.map((d) => (
            <div class="tm-row" key={d.day}>
              <span class="tm-label">{d.label}</span>
              <span class="tm-bar">{d.sittings > 0 && <span style={{ width: `${(d.ms / dayMax) * 100}%` }} />}</span>
              <span class="tm-ms">{d.sittings ? time(d.ms) : ''}</span>
              <span class="tm-dots" title={`${d.sittings} sitting${d.sittings === 1 ? '' : 's'}`}>
                {d.sittings > 4 ? <>{d.sittings}<span class="tm-dot" /></> : Array.from({ length: d.sittings }, (_, i) => <span class="tm-dot" key={i} />)}
              </span>
              <span class="tm-added">{d.added ? `+${d.added}` : ''}</span>
            </div>
          ))}
        </div>
      </div>
      {data.shipped.length > 0 && (
        <div class="tm-shipped">
          <button class="tm-shipped-toggle" onClick={() => setShowShipped(!showShipped)}>
            {showShipped ? 'Hide' : 'What changed in'} WT Builder since WT{data.previous!.number} ({data.shipped.length})
          </button>
          {showShipped && (
            <ul>{data.shipped.map((c) => <li key={c.sha}><code>{c.sha}</code> {c.subject}</li>)}</ul>
          )}
        </div>
      )}
    </section>
  );
}
