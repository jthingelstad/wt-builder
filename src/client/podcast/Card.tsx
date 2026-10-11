/**
 * The card — the recording surface for Another Thing. One beat per screen,
 * never a scroll mid-thought. A performance artifact, not the outline: it
 * carries different information density, typography and controls on
 * purpose, and it is dark where the rest of WT Builder is light.
 *
 * Ported from AT Builder (retired 2026-10-11) with its palette, serif,
 * chrome, dots and tap zones; the pace model is src/shared/podcast/pace.ts.
 *
 * The card contract (docs/decisions.md — fixed, do not let it drift):
 *   dark, high contrast, serif body at reading distance;
 *   gold     = trigger word, glance only
 *   orange i = say close to verbatim
 *   teal ⋯   = bridge / transition
 *   grey pill= cuttable for time
 *   step nav: ← → and J/K; swipe or tap an edge on touch;
 *   font scaling always reachable (+ − keys, buttons);
 *   timer: space starts/pauses, R resets; per-beat ahead/behind against the
 *   cumulative target; pace follows the beat on screen, not the clock alone;
 *   S = sync to here, when the card and the speech have drifted apart.
 * Visual only — nothing here makes a sound that could reach the recording.
 *
 * Underneath, the timing engine is unchanged: entering a new segment records
 * a split, splits become "where the time went" afterward, and N files a
 * take note against the clock and the card on screen.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';

import type { EpisodeDoc, Split } from '../../shared/podcast/types.ts';
import { beatPace, beats as planBeats, fmt, plannedTotal } from '../../shared/podcast/pace.ts';
import { inlineRuns } from '../../shared/podcast/cards.ts';
import { podcastApi, type EpisodeView } from './api.ts';
import { useWakeLock } from './wakelock.ts';

/** A block's text with its *glance words* gold. */
function Runs({ text }: { text: string }) {
  return <>{inlineRuns(text).map((r, i) => (r.glance ? <span key={i} class="glance">{r.text}</span> : r.text))}</>;
}

const SCALE_KEY = 'wt-builder:card-scale';

export function Card({
  doc, run, onExit,
}: {
  doc: EpisodeDoc;
  run: (fn: () => Promise<EpisodeView>) => Promise<boolean>;
  onExit: () => void;
}) {
  const beats = useMemo(() => planBeats(doc.segments), [doc.segments]);
  // `?beat=N` opens on a beat — resuming after a break, or checking one card.
  const [at, setAt] = useState(() => {
    const n = Number(new URLSearchParams(location.search).get('beat'));
    return Number.isInteger(n) && n > 0 && n <= beats.length ? n - 1 : 0;
  });

  // The clock: accumulated seconds plus the current run, so pause is honest.
  const [runningSince, setRunningSince] = useState<number | null>(null);
  const [banked, setBanked] = useState(0);
  const [tick, setTick] = useState(0);
  const [started, setStarted] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  const elapsed = banked + (runningSince !== null ? Math.floor((Date.now() - runningSince) / 1000) : 0);
  const running = runningSince !== null;
  const live = started !== null;

  const [shift, setShift] = useState(0);
  const [splits, setSplits] = useState<Split[]>([]);
  const [note, setNote] = useState('');
  const noteRef = useRef<HTMLInputElement>(null);
  const [scale, setScale] = useState(() => {
    try { return Number(localStorage.getItem(SCALE_KEY)) || 1; } catch { return 1; }
  });
  const touch = useRef<{ x: number; t: number } | null>(null);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, [running]);
  void tick;

  useEffect(() => {
    try { localStorage.setItem(SCALE_KEY, String(scale)); } catch { /* private window: the size is for this visit */ }
  }, [scale]);

  // An iPad on a stand sleeps mid-beat otherwise. Held is silent; anything
  // else is one orange line in the foot, the chrome's warning tone
  // (src/client/wakelock.ts).
  const awake = useWakeLock(true);

  const beat = beats[at];
  const nextBeat = beats[at + 1];

  const persistSession = (nextSplits: Split[], endedAt?: number) => {
    if (!started) return;
    void podcastApi.session(doc.episode.id, { started_at: started, splits: nextSplits, ended: endedAt })
      .catch(() => { /* telemetry, not editorial — never interrupt a take */ });
  };

  // ── the clock ───────────────────────────────────────────────────────────

  const startOrPause = () => {
    if (ended) return;
    if (running) {
      setBanked(elapsed);
      setRunningSince(null);
      return;
    }
    if (!live) {
      const first: Split[] = beat ? [{ segmentId: beat.seg.id, entered: 0 }] : [];
      const iso = new Date().toISOString();
      setStarted(iso);
      setSplits(first);
      void podcastApi.session(doc.episode.id, { started_at: iso, splits: first }).catch(() => {});
    }
    setRunningSince(Date.now());
  };

  const reset = () => {
    if (live && !confirm('Reset the clock? This session’s splits are dropped.')) return;
    setRunningSince(null);
    setBanked(0);
    setStarted(null);
    setEnded(false);
    setShift(0);
    setSplits([]);
    setAt(0);
    void podcastApi.session(doc.episode.id, null).catch(() => {});
  };

  const finish = () => {
    if (live && !ended) {
      setBanked(elapsed);
      setRunningSince(null);
      setEnded(true);
      persistSession(splits, elapsed);
    }
  };

  /** The plan re-anchored: this beat begins now. */
  const sync = () => {
    if (!beat || beat.start === null) return;
    setShift(elapsed - beat.start);
  };

  // ── moving ──────────────────────────────────────────────────────────────

  const move = (delta: number) => {
    const next = Math.min(Math.max(at + delta, 0), beats.length - 1);
    if (next === at || !beats[next]) return;
    setAt(next);
    const target = beats[next]!;
    // A forward move into a new segment is a split — going back is glancing, not time.
    if (live && delta > 0 && target.seg.id !== beat?.seg.id && !splits.some((s) => s.segmentId === target.seg.id)) {
      const nextSplits = [...splits, { segmentId: target.seg.id, entered: elapsed }];
      setSplits(nextSplits);
      persistSession(nextSplits);
    }
  };

  /** Done: a take in progress is finished as it stands, and the page reads the episode after that save. */
  const leave = () => {
    const id = doc.episode.id;
    const closing = live && !ended && started ? { started_at: started, splits, ended: elapsed } : null;
    void run(async () => {
      if (closing) await podcastApi.session(id, closing).catch(() => {});
      return podcastApi.get(id);
    });
    onExit();
  };

  // The keys read this render's state through a ref set during render: an
  // effect re-registering after each render left a gap in which a quick
  // second press still saw the beat before the first, and was lost. The
  // listener goes on with the card's first paint (a layout effect), not a
  // frame later, so the first keys are not lost either.
  const onKeyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  onKeyRef.current = (e: KeyboardEvent) => {
    if (e.target === noteRef.current) {
      if (e.key === 'Escape') noteRef.current?.blur();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    switch (e.key) {
      case 'ArrowRight': case 'ArrowDown': case 'j': case 'J': case 'PageDown': e.preventDefault(); move(1); break;
      case 'ArrowLeft': case 'ArrowUp': case 'k': case 'K': case 'PageUp': e.preventDefault(); move(-1); break;
      case ' ': e.preventDefault(); startOrPause(); break;
      case 'r': case 'R': reset(); break;
      case 's': case 'S': sync(); break;
      case 'f': case 'F': finish(); break;
      case '+': case '=': setScale((s) => Math.min(2.4, +(s + 0.12).toFixed(2))); break;
      case '-': case '_': setScale((s) => Math.max(0.7, +(s - 0.12).toFixed(2))); break;
      case 'n': case 'N': e.preventDefault(); noteRef.current?.focus(); break;
      case 'Escape': leave(); break;
      default: break;
    }
  };
  useLayoutEffect(() => {
    const onKey = (e: KeyboardEvent) => onKeyRef.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const fileNote = () => {
    const text = note.trim();
    if (!text) return;
    setNote('');
    void run(() => podcastApi.addNote(doc.episode.id, {
      text,
      elapsed: live ? elapsed : undefined,
      segmentId: beat?.seg.id,
    }));
    noteRef.current?.blur();
  };

  // ── touch: swipe, or tap an edge ────────────────────────────────────────

  const onTouchStart = (e: TouchEvent) => {
    const t = e.touches[0];
    if (t) touch.current = { x: t.clientX, t: Date.now() };
  };
  const onTouchEnd = (e: TouchEvent) => {
    const start = touch.current;
    touch.current = null;
    const t = e.changedTouches[0];
    if (!start || !t) return;
    const dx = t.clientX - start.x;
    if (Math.abs(dx) > 60) move(dx < 0 ? 1 : -1);
  };

  // ── signals ─────────────────────────────────────────────────────────────

  const pace = beat && live ? beatPace(beat, elapsed, shift) : null;
  const total = plannedTotal(doc.segments);
  const target = doc.episode.target_minutes ? doc.episode.target_minutes * 60 : total;
  const remaining = target !== null && live ? target - elapsed : null;
  const beatBudget = beat && beat.start !== null && beat.end !== null ? beat.end - beat.start : null;
  const beatStartedAt = beat && beat.start !== null ? beat.start + shift : null;
  const inBeat = live && beatStartedAt !== null ? Math.max(0, elapsed - beatStartedAt) : null;
  const drifted = pace !== null && pace.tone !== 'ok';
  // The section's cumulative target — "Point 1 by 7:00" under the pace.
  const sectionEnd = beat ? beats.filter((x) => x.segIndex === beat.segIndex).at(-1)?.end ?? null : null;

  return (
    <div class="card-surface" style={{ '--scale': scale } as never} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <header class="card-top">
        <button class="cbtn" onClick={leave} title="Esc">Done</button>
        <span class="card-pos mono">{at + 1} / {beats.length}</span>
        <span class={`card-pace ${pace?.tone ?? 'idle'}`}>
          <b>{pace ? pace.label : '—'}</b>
          <span class="pace-sub">{beat && sectionEnd !== null ? `${beat.seg.title} by ${fmt(sectionEnd + shift)}` : live ? '' : 'space = start'}</span>
        </span>
        {drifted && <button class="cbtn quiet-btn" onClick={sync} title="S — the plan re-anchors: this beat begins now">sync to here</button>}
        <span class="spacer" />
        {remaining !== null && (
          <span class={`card-remaining mono${remaining < 0 ? ' over' : ''}`}>
            {remaining < 0 ? `${fmt(-remaining)} OVER` : `${fmt(remaining)} LEFT`}
          </span>
        )}
        <span class={`card-clock mono${running ? ' running' : ''}${ended ? ' ended' : ''}`}>{fmt(elapsed)}</span>
        <button class="cbtn" onClick={startOrPause} title="space">{ended ? 'Finished' : running ? 'Pause' : live ? 'Resume' : 'Start'}</button>
        {live && !ended && <button class="cbtn quiet-btn" onClick={finish} title="F — stop the clock for good; the splits report closes">Finish</button>}
        <button class="cbtn quiet-btn" onClick={reset} title="R">Reset</button>
        <span class="card-scale">
          <button class="cbtn" onClick={() => setScale((s) => Math.max(0.7, +(s - 0.12).toFixed(2)))} title="−">A−</button>
          <button class="cbtn" onClick={() => setScale((s) => Math.min(2.4, +(s + 0.12).toFixed(2)))} title="+">A+</button>
        </span>
      </header>

      {total !== null && (
        <div class="card-rail" aria-hidden>
          {doc.segments.map((s, i) => (
            <span
              key={s.id}
              class={`rail-seg${i === beat?.segIndex ? ' current' : ''}${beat && i < beat.segIndex ? ' past' : ''}${s.role === 'bridge' ? ' bridge' : ''}`}
              style={{ flexGrow: s.minutes ?? 0.25 }}
              title={`${s.title}${s.minutes ? ` · ${s.minutes}m` : ''}`}
            />
          ))}
          {live && target !== null && (
            <span class="rail-dot" style={{ left: `${Math.min(100, (elapsed / target) * 100)}%` }} />
          )}
        </div>
      )}

      {beat ? (
        <main class="card-stage">
          <span class="tap prev" onClick={() => move(-1)} />
          <span class="tap next" onClick={() => move(1)} />
          <div class="card-meta">
            {/* The kicker is the label; the section shows only when a card has none. */}
            <span class="stage-kicker">{beat.card?.kicker ?? `${beat.seg.role ? `${beat.seg.role} · ` : ''}${beat.seg.title}`}</span>
            {inBeat !== null && (
              <span class={`card-beat-clock mono${beatBudget !== null && inBeat > beatBudget ? ' over' : ''}`}>
                {fmt(inBeat)}{beatBudget !== null && <span class="of"> / {fmt(beatBudget)}</span>}
              </span>
            )}
          </div>
          <h1 class="stage-claim">{beat.card?.claim ?? (beat.card ? '' : beat.seg.title)}</h1>
          <div class="stage-blocks">
            {beat.card?.blocks.map((b, i) => (
              <div key={i} class={`cblk cblk-${b.t}`}>
                {b.t === 'bridge' && <span class="cblk-tag">Bridge</span>}
                {b.t === 'cuttable' && <span class="cblk-tag cut">Cuttable</span>}
                {b.t === 'verbatim' ? <>“<Runs text={b.text} />”</> : <Runs text={b.text} />}
              </div>
            ))}
            {beat.card && !beat.card.blocks.length && !beat.card.claim && <div class="cblk cblk-line quiet">An empty card.</div>}
          </div>
          {beat.seg.links.length > 0 && beat.cardIndex === beat.seg.cards.length - 1 && (
            <div class="card-links">
              {beat.seg.links.map((l) => <span key={l.url} class="card-link mono">{l.text || l.url}</span>)}
            </div>
          )}
        </main>
      ) : (
        <main class="card-stage"><h1 class="stage-claim">No outline yet.</h1></main>
      )}

      <footer class="card-foot">
        <span class="card-next">
          {nextBeat
            ? <>NEXT — {nextBeat.seg.id !== beat?.seg.id ? <b>{nextBeat.seg.title}</b> : null} {nextBeat.card?.claim ?? nextBeat.card?.kicker ?? ''}{nextBeat.end !== null && nextBeat.start !== null ? <span class="mono quiet"> · {fmt(nextBeat.end - nextBeat.start)}</span> : null}</>
            : <>LAST CARD</>}
        </span>
        <span class="card-dots" aria-hidden>
          {beats.map((b, i) => <span key={i} class={`dot${i < at ? ' done' : ''}${i === at ? ' here' : ''}${b.seg.role === 'bridge' ? ' bridge' : ''}`} />)}
        </span>
        <span class="card-hints">← → or J/K · space = timer · S sync · N note · Esc</span>
        {awake !== 'held' && (
          <span class="card-awake" title="The screen wake lock is not held">
            {awake === 'refused' ? 'screen may sleep — tap to keep it awake' : 'screen may sleep'}
          </span>
        )}
        <input
          ref={noteRef}
          class="card-note"
          placeholder="N — mark a moment, Enter files it"
          value={note}
          onInput={(e) => setNote((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => { if (e.key === 'Enter') fileNote(); }}
        />
      </footer>
    </div>
  );
}
