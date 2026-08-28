import { useEffect, useMemo, useState } from 'preact/hooks';

import type { Channel, IssueDoc, Item } from '../../shared/types.ts';
import { CHANNELS } from '../../shared/types.ts';
import { clockTime, shortDate, wallClock, weekday, issueWindow } from '../../shared/dates.ts';
import { bodyLines, planEdition, type PlannedNode } from '../../shared/render/plan.ts';
import { api, type IssueResponse, type Readiness } from '../api.ts';
import { ChevronDown, ChevronUp, Check, Circle, Star, Trash, ArrowLeft } from '../icons.tsx';
import { Inspector } from './Inspector.tsx';

export type Lens = Channel | 'source';

interface Props {
  doc: IssueDoc;
  readiness: Readiness | null;
  busy: boolean;
  error: string | null;
  run: (fn: () => Promise<IssueResponse>) => Promise<void>;
  onIndex: () => void;
  onSend: () => void;
  onError: (m: string | null) => void;
}

export function Canvas({ doc, readiness, busy, error, run, onIndex, onSend, onError }: Props) {
  const [lens, setLens] = useState<Lens>('website');
  const [selected, setSelected] = useState<string | null>(null);
  const [panel, setPanel] = useState<'none' | 'checklist' | 'meta'>('none');
  const [plain, setPlain] = useState<string>('');
  const [sweepNote, setSweepNote] = useState<string | null>(null);

  const id = doc.issue.id;
  const isPage = lens === 'website' || lens === 'email';

  // Source and audio come from the service so the client and the send agree.
  useEffect(() => {
    if (isPage) return;
    let live = true;
    api
      .renderLens(id, lens)
      .then((r) => { if (live) setPlain(r.rendered); })
      .catch((e) => onError((e as Error).message));
    return () => { live = false; };
  }, [id, lens, isPage, doc]);

  const planned = useMemo(
    () => (isPage ? planEdition(doc, lens as Channel) : []),
    [doc, lens, isPage],
  );

  const window = issueWindow(doc.issue.publication_date, doc.issue.window_days);

  const sweep = async () => {
    setSweepNote(null);
    try {
      const res = await api.sweep(id);
      setSweepNote(
        `Swept ${window.from} to ${window.to}: ${res.report.added} new, ${res.report.skipped} already here.`,
      );
      await run(async () => res);
    } catch (err) {
      onError((err as Error).message);
    }
  };

  return (
    <>
      <header class="header">
        <button class="btn" onClick={onIndex} title="Back to all issues">
          <ArrowLeft /> Issues
        </button>
        <span class="num">WT{doc.issue.number}</span>
        <span class="title">{doc.issue.title}</span>
        <span class="spacer" />

        <div class="lenses" role="group" aria-label="Lens">
          {(['source', 'website', 'email', 'audio'] as Lens[]).map((l) => (
            <button
              key={l}
              class="lens"
              aria-pressed={lens === l}
              onClick={() => setLens(l)}
              title={LENS_HINT[l]}
            >
              {LENS_LABEL[l]}
            </button>
          ))}
        </div>

        {readiness && (
          <button
            class="progress"
            style="border:0;background:none;padding:0"
            onClick={() => setPanel(panel === 'checklist' ? 'none' : 'checklist')}
            title="What is left before this issue is ready"
          >
            <span class="bar"><span class="fill" style={`width:${readiness.pct}%`} /></span>
            <span class="label">{readiness.done}/{readiness.total}</span>
          </button>
        )}

        <button class="btn" onClick={sweep} disabled={busy}>
          {busy ? 'Working…' : 'Sweep'}
        </button>
        <button class="btn" onClick={() => setPanel(panel === 'meta' ? 'none' : 'meta')}>Issue</button>
        <button class="btn primary" onClick={onSend}>Send</button>
      </header>

      <div class="canvas" style={panel !== 'none' || selected ? 'padding-right:384px' : ''}>
        {error && <div class="banner error" style="max-width:820px;margin:0 auto 14px">{error}</div>}
        {sweepNote && <div class="banner info" style="max-width:820px;margin:0 auto 14px">{sweepNote}</div>}

        {isPage ? (
          <div class="track">
            <div class="node">
              <div class="node-gutter" />
              <div class="node-body">
                <div class="page"><h1>{doc.issue.title}</h1></div>
              </div>
            </div>
            {planned.map((p) => (
              <NodeBlock
                key={p.node.id}
                planned={p}
                doc={doc}
                lens={lens as Channel}
                selected={selected}
                onSelect={setSelected}
                run={run}
              />
            ))}
            {!planned.length && (
              <div class="node">
                <div class="node-gutter" />
                <div class="node-body">
                  <div class="empty">Nothing in this edition yet. Sweep the window to bring items in.</div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div class={lens === 'audio' ? 'plain script' : 'plain'}>{plain || 'Rendering…'}</div>
        )}
      </div>

      {panel === 'checklist' && readiness && (
        <ChecklistPanel readiness={readiness} onClose={() => setPanel('none')} onJump={setSelected} />
      )}
      {panel === 'meta' && (
        <MetaPanel doc={doc} run={run} onClose={() => setPanel('none')} />
      )}
      {selected && panel === 'none' && (
        <Inspector
          doc={doc}
          itemId={selected}
          run={run}
          onClose={() => setSelected(null)}
          onError={onError}
        />
      )}
    </>
  );
}

const LENS_LABEL: Record<Lens, string> = {
  source: 'Source',
  website: 'Website',
  email: 'Email',
  audio: 'Audio',
};

const LENS_HINT: Record<Lens, string> = {
  source: 'Every item, its provenance, and which editions carry it',
  website: 'The archive edition',
  email: 'The Buttondown edition, with subscriber branching',
  audio: 'The spoken script — every line here is read aloud',
};

// ── nodes ─────────────────────────────────────────────────────────────────

function NodeBlock({
  planned, doc, lens, selected, onSelect, run,
}: {
  planned: PlannedNode;
  doc: IssueDoc;
  lens: Channel;
  selected: string | null;
  onSelect: (id: string | null) => void;
  run: Props['run'];
}) {
  const { node } = planned;
  const id = doc.issue.id;
  const heading = node.publishes_heading
    ? node.kind === 'promoted_item'
      ? planned.items[0]?.item.title ?? node.label
      : node.label
    : null;

  return (
    <div class="node">
      <div class="node-gutter">
        {/* The section's name is structure: shown here even when it does not print. */}
        <span class="node-label" title={node.publishes_heading ? 'Prints as a heading' : 'Shown here only — not printed'}>
          {node.label}
          {!node.publishes_heading && <span style="opacity:0.55"> ·</span>}
        </span>
        <div class="node-controls">
          {node.movable && (
            <>
              <button class="icon-btn" title="Move up" onClick={() => run(() => api.moveNode(id, node.id, -1))}>
                <ChevronUp />
              </button>
              <button class="icon-btn" title="Move down" onClick={() => run(() => api.moveNode(id, node.id, 1))}>
                <ChevronDown />
              </button>
            </>
          )}
          {node.kind === 'promoted_item' && (
            <button class="icon-btn" title="Return to Journal" onClick={() => run(() => api.demote(id, node.id))}>
              <Star />
            </button>
          )}
          <button
            class="icon-btn"
            title="Remove this section. Its items are held out, not deleted."
            onClick={() => run(() => api.removeNode(id, node.id))}
          >
            <Trash />
          </button>
        </div>
      </div>

      <div class="node-body">
        <div class="page">
          {heading && <h2>{heading}</h2>}
          {planned.groups
            ? planned.groups.map((g) => (
                <div key={g.key}>
                  {g.weekday && <h3>{g.weekday}</h3>}
                  {g.items.map((e) => (
                    <ItemBlock
                      key={e.id} itemId={e.id} item={e.item} doc={doc} lens={lens}
                      nodeId={node.id} nodeLabel={node.label} selected={selected} onSelect={onSelect} run={run}
                    />
                  ))}
                </div>
              ))
            : planned.items.map((e) => (
                <ItemBlock
                  key={e.id} itemId={e.id} item={e.item} doc={doc} lens={lens}
                  nodeId={node.id} nodeLabel={node.label} selected={selected} onSelect={onSelect} run={run}
                />
              ))}
        </div>
      </div>
    </div>
  );
}

// ── items ─────────────────────────────────────────────────────────────────

function ItemBlock({
  itemId, item, doc, nodeId, nodeLabel, selected, onSelect, run,
}: {
  itemId: string;
  item: Item;
  doc: IssueDoc;
  lens: Channel;
  nodeId: string;
  nodeLabel?: string;
  selected: string | null;
  onSelect: (id: string | null) => void;
  run: Props['run'];
}) {
  const id = doc.issue.id;
  const commit = (patch: Record<string, unknown>) => run(() => api.updateItem(id, itemId, patch));

  const editable = (value: string, field: string, placeholder: string) => (
    <span
      contentEditable
      data-ph={placeholder}
      onBlur={(e) => {
        const next = (e.currentTarget as HTMLElement).innerText.trim();
        if (next !== value) void commit({ [field]: next });
      }}
      dangerouslySetInnerHTML={{ __html: escapeHtml(value) }}
    />
  );

  return (
    <div
      class={`item${selected === itemId ? ' selected' : ''}`}
      onClick={(e) => {
        if ((e.target as HTMLElement).isContentEditable) return;
        onSelect(selected === itemId ? null : itemId);
      }}
    >
      <ItemContent item={item} editable={editable} nodeLabel={nodeLabel} />
      <ItemAffordances itemId={itemId} item={item} doc={doc} nodeId={nodeId} run={run} />
    </div>
  );
}

function ItemContent({
  item, editable, nodeLabel,
}: {
  item: Item;
  editable: (v: string, f: string, p: string) => preact.JSX.Element;
  nodeLabel?: string;
}) {
  const body = String(item.body ?? '');

  switch (item.type) {
    case 'currently':
      return (
        <p>
          <strong>{item.label}:</strong> {editable(body, 'body', 'What are you doing?')}
        </p>
      );

    case 'photo': {
      const w = wallClock(item.media?.timestamp);
      return (
        <>
          {item.media?.url
            ? <img src={item.media.url} alt={item.media.alt ?? ''} />
            : <div class="empty" style="border:1px dashed var(--border);border-radius:6px">Drop a photo here</div>}
          {item.media?.caption && <p>{item.media.caption}</p>}
          {(w || item.media?.location) && (
            <p class="meta">
              {[w && shortDate(w), w && clockTime(w), item.media?.location].filter(Boolean).join(' · ')}
            </p>
          )}
        </>
      );
    }

    case 'pinboard_link': {
      // Placement wins over the tag the link was captured with, matching the
      // renderer — otherwise the canvas and the edition disagree.
      const briefly = (nodeLabel ?? item.section ?? '').toLowerCase() === 'briefly';
      if (briefly) {
        return (
          <p>
            {editable(String(item.commentary ?? ''), 'commentary', 'Say something about this link')} →{' '}
            <strong><a href={item.source_url} target="_blank" rel="noreferrer">{item.title}</a></strong>
          </p>
        );
      }
      return (
        <>
          <h3><a href={item.source_url} target="_blank" rel="noreferrer">{item.title}</a></h3>
          <p>{editable(String(item.commentary ?? ''), 'commentary', 'Say something about this link')}</p>
        </>
      );
    }

    case 'journal_post': {
      const w = wallClock(item.published_at);
      if (item.presentation === 'promoted') {
        return (
          <>
            {w && <p class="meta">{weekday(w)} · {clockTime(w)}</p>}
            <p>{editable(body, 'body', '')}</p>
          </>
        );
      }
      return (
        <p>
          {w && <a href={item.source_url} target="_blank" rel="noreferrer">{clockTime(w)}</a>}
          {w ? ' — ' : ''}
          {editable(body, 'body', '')}
        </p>
      );
    }

    case 'haiku':
      return <p class="haiku">{editable(bodyLines(body).join('\n'), 'body', 'Three lines')}</p>;

    case 'membership':
    case 'echoes':
      return (
        <>
          <p class="byline">By {item.attribution ?? 'Thingy'}</p>
          <p>{editable(body, 'body', `${item.type === 'echoes' ? 'Echoes' : 'Membership'} — not written yet`)}</p>
        </>
      );

    case 'quote':
      return <blockquote>{editable(body, 'body', 'A quote')}</blockquote>;

    default:
      return <p>{editable(body, 'body', 'Write here')}</p>;
  }
}

/** Channel chips and the controls that only make sense per item. */
function ItemAffordances({
  itemId, item, doc, nodeId, run,
}: {
  itemId: string;
  item: Item;
  doc: IssueDoc;
  nodeId: string;
  run: Props['run'];
}) {
  const id = doc.issue.id;
  return (
    <span class="chips" style="margin-left:8px">
      {CHANNELS.map((c) => {
        const locked = item.channel_locks?.[c];
        const on = item.channels[c];
        return (
          <button
            key={c}
            class={`chip${on ? ' on' : ''}${locked ? ' locked' : ''}`}
            title={locked ?? `${on ? 'In' : 'Not in'} the ${c} edition`}
            disabled={Boolean(locked)}
            onClick={(e) => {
              e.stopPropagation();
              if (locked) return;
              void run(() => api.setChannel(id, itemId, c, !on));
            }}
          >
            {c[0]!.toUpperCase()}
          </button>
        );
      })}
      {item.type === 'journal_post' && item.presentation !== 'promoted' && item.title && (
        <button
          class="chip"
          title="Promote to its own section"
          onClick={(e) => { e.stopPropagation(); void run(() => api.promote(id, itemId)); }}
        >
          ★
        </button>
      )}
      <button
        class="chip"
        title="Move up"
        onClick={(e) => { e.stopPropagation(); void run(() => api.moveItem(id, nodeId, itemId, -1)); }}
      >
        ↑
      </button>
      <button
        class="chip"
        title="Move down"
        onClick={(e) => { e.stopPropagation(); void run(() => api.moveItem(id, nodeId, itemId, 1)); }}
      >
        ↓
      </button>
    </span>
  );
}

// ── panels ────────────────────────────────────────────────────────────────

function ChecklistPanel({
  readiness, onClose, onJump,
}: {
  readiness: Readiness;
  onClose: () => void;
  onJump: (id: string) => void;
}) {
  return (
    <aside class="panel">
      <h3>Ready — {readiness.done} of {readiness.total}</h3>
      {readiness.units.map((u, i) => (
        <div
          key={i}
          class={`check-row${u.done ? ' done' : ''}`}
          onClick={() => u.anchor !== 'issue' && onJump(u.anchor)}
          style={u.anchor !== 'issue' ? 'cursor:pointer' : ''}
        >
          <span class="mark">{u.done ? <Check size={13} /> : <Circle size={13} />}</span>
          <span>{u.title}</span>
        </div>
      ))}
      <button class="btn" style="margin-top:16px" onClick={onClose}>Close</button>
    </aside>
  );
}

function MetaPanel({
  doc, run, onClose,
}: {
  doc: IssueDoc;
  run: Props['run'];
  onClose: () => void;
}) {
  const id = doc.issue.id;
  const w = issueWindow(doc.issue.publication_date, doc.issue.window_days);
  return (
    <aside class="panel">
      <h3>Issue</h3>
      <div class="field">
        <label>Title</label>
        <input
          value={doc.issue.title}
          onBlur={(e) => void run(() => api.settings(id, { title: (e.target as HTMLInputElement).value }))}
        />
      </div>
      <div class="field">
        <label>Dek</label>
        <textarea
          style="min-height:60px"
          value={doc.issue.dek ?? ''}
          onBlur={(e) => void run(() => api.settings(id, { dek: (e.target as HTMLTextAreaElement).value }))}
        />
      </div>
      <div class="field">
        <label>Publication date — snapped to Saturday</label>
        <input
          type="date"
          value={doc.issue.publication_date}
          onChange={(e) => void run(() => api.settings(id, { publication_date: (e.target as HTMLInputElement).value }))}
        />
      </div>
      <div class="field">
        <label>Window — days back from Thursday</label>
        <input
          type="number" min="1" max="60"
          value={doc.issue.window_days}
          onChange={(e) => void run(() => api.settings(id, { window_days: Number((e.target as HTMLInputElement).value) }))}
        />
      </div>
      <div class="kv"><span>Sweeps</span><span>{w.from} → {w.to}</span></div>
      <div class="kv"><span>Items</span><span>{Object.keys(doc.items).length}</span></div>
      <div class="kv"><span>Status</span><span>{doc.issue.status}</span></div>
      <AddSection doc={doc} run={run} />
      <button class="btn" style="margin-top:16px" onClick={onClose}>Close</button>
    </aside>
  );
}

/** Missing standard sections are offered back, so removal is never one-way. */
function AddSection({ doc, run }: { doc: IssueDoc; run: Props['run'] }) {
  const [available, setAvailable] = useState<{ id: string; type: string; label: string }[]>([]);
  const id = doc.issue.id;

  useEffect(() => {
    api.availableSections(id).then((r) => setAvailable(r.sections)).catch(() => setAvailable([]));
  }, [id, doc]);

  return (
    <div style="margin-top:18px">
      <h3>Add</h3>
      <div style="display:flex;flex-wrap:wrap;gap:6px">
        {available.map((s) => (
          <button
            key={s.id}
            class="btn small"
            title={`Bring ${s.label} back into this issue`}
            onClick={() => void run(() => api.addNode(id, { id: s.id, type: s.type, label: s.label }))}
          >
            + {s.label}
          </button>
        ))}
        <button
          class="btn small"
          onClick={() => void run(() => api.addNode(id, { type: 'ad_hoc', label: 'New section' }))}
        >
          + Ad hoc section
        </button>
        <button
          class="btn small"
          onClick={() => void run(() => api.addNode(id, { kind: 'markdown' }))}
        >
          + Markdown block
        </button>
      </div>
    </div>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
}
