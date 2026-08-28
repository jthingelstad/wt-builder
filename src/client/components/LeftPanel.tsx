/**
 * The left panel: what this issue *is*, and what is in it.
 *
 * Two states. At rest it is three lines of fact. Open for editing it is the
 * only place the issue's identity can be changed, which keeps the canvas about
 * the material and nothing else.
 */

import { useEffect, useState } from 'preact/hooks';

import type { IssueDoc, IssueNode } from '../../shared/types.ts';
import { isSaturday, shortKicker, spanLabel } from '../../shared/dates.ts';
import { orderedNodes, windowOf } from '../../shared/render/plan.ts';
import { api } from '../api.ts';
import { ArrowDown, ArrowUp, EyeOff, GripVertical, X } from '../icons.tsx';

interface Props {
  doc: IssueDoc;
  selected: string | null;
  onSelect: (anchor: string) => void;
  onSettings: (patch: Record<string, unknown>) => void;
  onMove: (nodeId: string, delta: number) => void;
  onRemove: (nodeId: string) => void;
  onAdd: (spec: { type: string; label: string; id?: string }) => void;
  onReorder: (nodeId: string, beforeId: string | null) => void;
  onSweep: () => void;
  sweeping: boolean;
}

const SPANS = [7, 14, 21];

export function LeftPanel(props: Props) {
  const { doc } = props;
  const [editing, setEditing] = useState(false);
  const w = windowOf(doc);
  const nodes = orderedNodes(doc);
  const swept = Object.keys(doc.items).length;

  return (
    <aside class="left-panel">
      <div class="panel-head">
        <span class="mono-label">WT{doc.issue.number}</span>
        <span class="spacer" />
        <button
          class={`btn tiny${editing ? ' primary' : ''}`}
          onClick={() => setEditing(!editing)}
        >
          {editing ? 'Done' : 'Edit'}
        </button>
      </div>

      {editing
        ? <MetaEditor doc={doc} onSettings={props.onSettings} onSweep={props.onSweep} sweeping={props.sweeping} />
        : (
          <div class="meta-card">
            <div><span class="k">Publishes</span> {shortKicker(doc.issue.publication_date)}</div>
            <div><span class="k">Sources</span> {spanLabel(w)}</div>
            <div class="quiet">{swept} items swept in from that span.</div>
          </div>
        )}

      <Outline {...props} nodes={nodes} />
    </aside>
  );
}

// ── issue metadata ────────────────────────────────────────────────────────

function MetaEditor({
  doc, onSettings, onSweep, sweeping,
}: {
  doc: IssueDoc;
  onSettings: (p: Record<string, unknown>) => void;
  onSweep: () => void;
  sweeping: boolean;
}) {
  const w = windowOf(doc);
  const [snapped, setSnapped] = useState(false);

  return (
    <div class="meta-card edit">
      <label class="field-row">
        <span class="mono-label">ISSUE NUMBER</span>
        <input
          type="number" class="num" value={doc.issue.number}
          onBlur={(e) => {
            const n = Number((e.target as HTMLInputElement).value);
            if (n && n !== doc.issue.number) onSettings({ number: n });
          }}
        />
      </label>

      <label class="field-row">
        <span class="mono-label">PUBLISHES</span>
        <input
          type="date" value={doc.issue.publication_date}
          onChange={(e) => {
            const date = (e.target as HTMLInputElement).value;
            if (!date) return;
            setSnapped(!isSaturday(date));
            onSettings({ publication_date: date });
          }}
        />
      </label>
      {snapped && (
        <p class="amber-note">
          Moved to Saturday — the Weekly Thing always publishes Saturday.
        </p>
      )}

      <div class="field-row col">
        <span class="mono-label">SOURCE MATERIAL</span>
        <div class="chips">
          {SPANS.map((d) => (
            <button
              key={d}
              class={`chip${doc.issue.window_days === d ? ' on' : ''}`}
              onClick={() => onSettings({ window_days: d })}
            >
              {d}
            </button>
          ))}
          <input
            type="number" class="num small" value={doc.issue.window_days}
            aria-label="Days back from Friday"
            onBlur={(e) => {
              const d = Number((e.target as HTMLInputElement).value);
              if (d && d !== doc.issue.window_days) onSettings({ window_days: d });
            }}
          />
        </div>
        <div class="window-line">{spanLabel(w)}</div>
        <p class="quiet">
          Days back from the Friday the window closes. Everything bookmarked or
          posted inside it is on the page.
        </p>
        <button class="btn small" disabled={sweeping} onClick={onSweep}>
          {sweeping ? 'Re-scanning…' : 'Re-scan'}
        </button>
      </div>
    </div>
  );
}

// ── outline ───────────────────────────────────────────────────────────────

const BADGE: Record<string, string> = {
  ad_hoc: 'AD HOC',
  mdblock: 'MARKDOWN',
  promoted_item: 'PROMOTED',
};

function Outline({
  doc, nodes, selected, onSelect, onMove, onRemove, onAdd, onReorder,
}: Props & { nodes: IssueNode[] }) {
  const [drag, setDrag] = useState<string | null>(null);
  const [absent, setAbsent] = useState<{ id: string; type: string; label: string }[]>([]);

  useEffect(() => {
    let live = true;
    api.availableSections(doc.issue.id)
      .then((r) => { if (live) setAbsent(r.sections); })
      .catch(() => { /* the panel still works without the add-back chips */ });
    return () => { live = false; };
  }, [doc.issue.id, doc.nodes.length]);

  return (
    <>
      <div class="outline-head">
        <span class="mono-label">OUTLINE</span>
        <p class="quiet">Drag a row, or use the arrows. Echoes stays last.</p>
      </div>

      <div class="outline">
        {nodes.map((node, i) => {
          const pinned = node.fixed_position === 'last';
          const badge = BADGE[node.kind];
          return (
            <div
              key={node.id}
              class={`ol-row${selected === node.id ? ' selected' : ''}${drag === node.id ? ' dragging' : ''}`}
              draggable={!pinned}
              onDragStart={() => setDrag(node.id)}
              onDragEnd={() => setDrag(null)}
              onDragOver={(e) => { if (drag && !pinned) e.preventDefault(); }}
              onDrop={() => { if (drag && drag !== node.id) onReorder(drag, node.id); setDrag(null); }}
              onClick={() => onSelect(node.id)}
            >
              {pinned ? <span class="grip-space" /> : <GripVertical class="grip" />}
              <span class={`prov ${node.items.length ? provOf(doc, node) : 'own'}`} />
              <span class="ol-label">{node.label}</span>
              {node.publishes_heading === false && (
                <EyeOff class="eye" />
              )}
              {badge && <span class="ol-badge">{badge}</span>}
              <span class="ol-count">{node.items.length}</span>
              {pinned
                ? <span class="pinned">pinned</span>
                : (
                  <span class="ol-actions">
                    <button class="ol-btn danger" title="Remove section"
                      onClick={(e) => { e.stopPropagation(); onRemove(node.id); }}>
                      <X size={11} />
                    </button>
                    <button class="ol-btn" title="Move up" disabled={i === 0}
                      onClick={(e) => { e.stopPropagation(); onMove(node.id, -1); }}>
                      <ArrowUp size={11} />
                    </button>
                    <button class="ol-btn" title="Move down"
                      onClick={(e) => { e.stopPropagation(); onMove(node.id, 1); }}>
                      <ArrowDown size={11} />
                    </button>
                  </span>
                )}
            </div>
          );
        })}
      </div>

      <div class="outline-foot">
        <button class="ghost" onClick={() => onAdd({ type: 'ad_hoc', label: 'New section' })}>
          + Section
        </button>
        <button class="ghost" onClick={() => onAdd({ type: 'mdblock', label: 'Markdown' })}>
          + Markdown
        </button>
      </div>

      {absent.length > 0 && (
        <div class="absent">
          <span class="mono-label">NOT IN THIS ISSUE</span>
          <div class="chips">
            {absent.map((s) => (
              <button key={s.id} class="chip add" onClick={() => onAdd(s)}>{s.label}</button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/** The provenance of a section is the provenance of what is in it. */
function provOf(doc: IssueDoc, node: IssueNode): string {
  const kinds = new Set(
    node.items.map((id) => doc.items[id]?.authorship).filter(Boolean),
  );
  if (kinds.has('Thingy')) return 'thingy';
  if (kinds.has('syndicated')) return 'syndicated';
  return 'own';
}
