/**
 * The Stats view: a layer over the editor, as Send and Share are, and the
 * issue's infographic (Jamie, 2026-10-11: "Think of it like building an
 * infographic about each issue… start with the what it took and then we'll
 * extend from there"). Made in moved here from the Send view, which is now
 * only about sending.
 *
 * Open from the editor's header at any point in an issue's life: before it
 * goes, the card says what it has taken so far.
 */

import { useEffect, useState } from 'preact/hooks';

import type { IssueDoc } from '../../shared/types.ts';
import { lastSent } from '../../shared/sends.ts';
import { madeIn } from '../made-in.ts';
import { acrossIssues, whatsInIt, type Count, type Strip } from '../issue-stats.ts';
import { api, type Readiness } from '../api.ts';
import { ArrowLeft } from '../icons.tsx';
import { LEGS } from './Send.tsx';

interface Props {
  doc: IssueDoc;
  readiness: Readiness | null;
  onBack: () => void;
}

export function Stats({ doc, readiness, onBack }: Props) {
  const n = doc.issue.number;

  // Escape goes back, as it does from Send and Share.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onBack(); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [onBack]);

  return (
    <div class="send-layer stats-layer">
      <header class="header">
        <button class="btn ghost-btn" onClick={onBack}><ArrowLeft /> Issue</button>
        <span class="mark">W</span>
        <span class="head-divider" />
        <span class="identity">
          <span class="wt">WT{n}</span>
          <span class="win">{doc.issue.title}</span>
        </span>
        <span class="head-spacer" />
      </header>

      <div class="send-body">
        <h1>Stats</h1>
        <p class="lede">What went into WT{n}, read from its record.</p>
        <MadeIn doc={doc} readiness={readiness} />
        <Holds doc={doc} />
      </div>
    </div>
  );
}

/**
 * How long the issue took, from its event log — beside the Builder issue
 * before it, with what shipped in WT Builder between the two, so a feature's
 * effect on the time can be seen (Jamie, WT351: "did it save me time!").
 * Jamie's own acts only; sittings split at 30 minutes apart.
 *
 * Design D (Jamie, 2026-10-04), with no sentence on top: an eyebrow and the
 * comparison, four stats, one stacked bar, a tile per day. It is meant to be
 * shared, so it shows each day's total and never when a sitting happened.
 * The numbers are worked out in made-in.ts.
 */
function MadeIn({ doc, readiness }: { doc: IssueDoc; readiness: Readiness | null }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.timing>> | null | undefined>(undefined);
  const [showShipped, setShowShipped] = useState(false);
  const sentKey = LEGS.map((k) => doc.sends?.[k]?.status ?? '').join('|');
  useEffect(() => {
    api.timing(doc.issue.id).then(setData).catch(() => setData(null));
  }, [doc.issue.id, sentKey]);

  if (data === undefined) return <p class="quiet">Loading…</p>;
  if (!data || !data.timing.actions) {
    return (
      <p class="quiet stats-empty">
        {doc.issue.imported
          ? `WT${doc.issue.number} was made before WT Builder, so there is no record of how it was made.`
          : 'Nothing to count yet: the card fills in as the issue is worked on.'}
      </p>
    );
  }
  const m = madeIn({
    number: doc.issue.number,
    timing: data.timing,
    previous: data.previous,
    pills: readiness ? { done: readiness.done, total: readiness.total } : null,
    legs: { sent: LEGS.filter((k) => lastSent(doc.sends?.[k])).length, total: LEGS.length },
  });
  return (
    <section class="send-card timing">
      <div class="mi-card">
        <div class="mi-head">
          <h2 class="mi-eyebrow">{m.eyebrow}</h2>
          {m.comparison && <span class={`mi-pill${m.comparison.less ? '' : ' more'}`}>{m.comparison.text}</span>}
        </div>

        <div class="mi-stats" style={{ gridTemplateColumns: `repeat(${m.stats.length}, minmax(0, 1fr))` }}>
          {m.stats.map((s) => (
            <div class="mi-stat" key={s.label}>
              <span class="mi-value">{s.value}</span>
              <span class="mi-label">{s.label}</span>
            </div>
          ))}
        </div>

        {m.segments.length > 0 && (
          <div class="mi-block">
            <span class="mi-kicker">WHERE IT WENT</span>
            <div class="mi-bar" role="img" aria-label={m.segments.map((s) => `${s.label} ${s.time}`).join(', ')}>
              {m.segments.map((s) => <span key={s.label} style={{ flexGrow: s.ms, background: s.color }} />)}
            </div>
            <div class="mi-legend">
              {m.segments.map((s) => (
                <span class="mi-key" key={s.label}>
                  <span class="mi-swatch" style={{ background: s.color }} />{s.label} <span class="mi-time">{s.time}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        <div class="mi-block">
          <span class="mi-kicker">WHEN · DARKER IS LONGER</span>
          <div class="mi-days" style={{ gridTemplateColumns: `repeat(${m.tiles.length}, minmax(0, var(--mi-tile)))` }}>
            {m.tiles.map((d) => (
              <div class="mi-day" key={d.day} title={d.title}>
                <div class={`mi-tile${d.dark ? ' dark' : ''}`} style={{ background: d.shade }}>{d.time}</div>
                <span class="mi-dow">{d.dow}</span>
                <span class="mi-added">{d.added}</span>
              </div>
            ))}
          </div>
          <p class="mi-foot">{m.footnote}</p>
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

/**
 * What's in it and Across issues (Jamie, 2026-10-11), from one answer:
 * GET /api/issues/:id/stats (src/server/issue-stats.ts). Both read the
 * website edition, so a pre-Builder issue and this one are counted alike.
 */
function Holds({ doc }: { doc: IssueDoc }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.stats>> | null | undefined>(undefined);
  const sentKey = LEGS.map((k) => doc.sends?.[k]?.status ?? '').join('|');
  useEffect(() => {
    api.stats(doc.issue.id).then(setData).catch(() => setData(null));
  }, [doc.issue.id, sentKey]);
  if (!data) return null;
  const n = doc.issue.number;
  const it = whatsInIt(n, data.content);
  const across = acrossIssues(n, data.across);

  return (
    <>
      <section class="send-card stats-card in-it">
        <div class="mi-card">
          <div class="mi-head"><h2 class="mi-eyebrow">{it.eyebrow}</h2></div>

          <div class="mi-stats" style={{ gridTemplateColumns: `repeat(${it.stats.length}, minmax(0, 1fr))` }}>
            {it.stats.map((s) => (
              <div class="mi-stat" key={s.label}>
                <span class="mi-value">{s.value}</span>
                <span class="mi-label">{s.label}</span>
              </div>
            ))}
          </div>

          {it.words.length > 0 && (
            <div class="mi-block">
              <span class="mi-kicker">WHERE THE WORDS ARE</span>
              <div class="mi-bar" role="img" aria-label={it.words.map((w) => `${w.label} ${w.text} words`).join(', ')}>
                {it.words.map((w) => <span key={w.label} style={{ flexGrow: w.value, background: w.color }} />)}
              </div>
              <div class="mi-legend">
                {it.words.map((w) => (
                  <span class="mi-key" key={w.label}>
                    <span class="mi-swatch" style={{ background: w.color }} />{w.label} <span class="mi-time">{w.text}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {(it.domains.length > 0 || it.sources.length > 0) && (
            <div class="st-pair">
              {it.domains.length > 0 && <Counts kicker="WHERE THE LINKS GO" rows={it.domains} />}
              {it.sources.length > 0 && <Counts kicker="WHERE IT CAME FROM" rows={it.sources} />}
            </div>
          )}
        </div>
      </section>

      <section class="send-card stats-card across">
        <div class="mi-card">
          <div class="mi-head"><h2 class="mi-eyebrow">{across.eyebrow}</h2></div>

          {across.strips.map((st) => <Column key={st.key} strip={st} years={across.years} />)}

          <div class="st-legend">
            <span class="mi-key"><span class="mi-swatch st-before" />Before WT Builder</span>
            <span class="mi-key"><span class="mi-swatch st-builder" />In WT Builder</span>
            <span class="mi-key"><span class="mi-swatch st-this" />WT{n}</span>
          </div>

          {across.builder.length > 0 && (
            <div class="mi-block">
              <span class="mi-kicker">SINCE WT BUILDER</span>
              <table class="st-table">
                <thead>
                  <tr><th>Issue</th><th>Made in</th><th>Words</th><th>Links</th><th>Listen</th></tr>
                </thead>
                <tbody>
                  {across.builder.map((r) => (
                    <tr key={r.number} class={r.current ? 'current' : undefined}>
                      <td>WT{r.number}</td><td>{r.made}</td><td>{r.words}</td><td>{r.links}</td><td>{r.listen}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </>
  );
}

/** A short ranked list, each row with a bar against the largest. */
function Counts({ kicker, rows }: { kicker: string; rows: Count[] }) {
  return (
    <div class="mi-block">
      <span class="mi-kicker">{kicker}</span>
      <div class="st-counts">
        {rows.map((r) => (
          <div class="st-count" key={r.label}>
            <span class="st-count-label">{r.label}</span>
            <span class="st-count-bar"><span style={{ width: `${Math.max(4, r.share * 100)}%` }} /></span>
            <span class="mi-time">{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Every issue as a column, oldest at the left. This issue is drawn over the
 * strip at a width that stays visible, since one column of three hundred is
 * thinner than a pixel on a phone.
 */
function Column({ strip, years }: { strip: Strip; years: { label: string; at: number }[] }) {
  const n = strip.bars.length;
  return (
    <div class="mi-block st-strip">
      <div class="st-strip-head">
        <span class="mi-kicker">{strip.kicker}</span>
        {strip.says && <span class="st-says">{strip.says}</span>}
      </div>
      <div class="st-plot">
        <svg viewBox={`0 0 ${n} 100`} preserveAspectRatio="none" role="img" aria-label={strip.says ?? strip.kicker}>
          {strip.bars.map((b, i) => {
            const h = (b.value / strip.max) * 100;
            return (
              <rect key={b.number} x={i + 0.12} y={100 - h} width={0.76} height={h} class={`st-${b.tone}`}>
                <title>{b.title}</title>
              </rect>
            );
          })}
        </svg>
        {strip.here && (
          <span class="st-here" style={{ left: `${strip.here.at * 100}%`, height: `${strip.here.height * 100}%` }} />
        )}
      </div>
      <div class="st-years">
        {years.map((y) => <span key={y.label} style={{ left: `${y.at * 100}%` }}>{y.label}</span>)}
      </div>
    </div>
  );
}
