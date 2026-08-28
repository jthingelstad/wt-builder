/**
 * Collapse mode — one row per section instead of the blocks.
 *
 * For reordering and seeing the shape of an issue at a glance. Nothing is
 * editable here: the row is a handle on a section, not the section itself.
 */

import { useState } from 'preact/hooks';

import type { IssueDoc, IssueNode } from '../../shared/types.ts';
import { orderedNodes, windowOf, outOfWindow } from '../../shared/render/plan.ts';
import { bodyLines } from '../../shared/render/plan.ts';
import { speakable } from '../../shared/render/speech.ts';
import { ArrowDown, ArrowUp, X } from '../icons.tsx';

interface Props {
  doc: IssueDoc;
  selected: string | null;
  onOpen: (nodeId: string) => void;
  onMove: (nodeId: string, delta: number) => void;
  onRemove: (nodeId: string) => void;
  onReorder: (nodeId: string, beforeId: string) => void;
}

const BADGE: Record<string, string> = {
  ad_hoc: 'AD HOC',
  mdblock: 'MARKDOWN',
  promoted_item: 'PROMOTED',
};

/** The first line of whatever this section actually holds. */
function preview(doc: IssueDoc, node: IssueNode): string {
  for (const id of node.items) {
    const item = doc.items[id];
    if (!item) continue;
    const text = item.title
      ?? bodyLines(item.commentary)[0]
      ?? bodyLines(item.body)[0]
      ?? item.media?.caption;
    // Markdown and raw <img> are stripped: a preview is for recognising the
    // section at a glance, and link syntax buries the words that do that.
    const plain = speakable(text).trim();
    if (plain) return plain.length > 120 ? `${plain.slice(0, 120)}…` : plain;
  }
  return '';
}

export function CollapseView({ doc, selected, onOpen, onMove, onRemove, onReorder }: Props) {
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const w = windowOf(doc);
  const nodes = orderedNodes(doc);

  return (
    <div class="collapse">
      {nodes.map((node, i) => {
        const pinned = node.fixed_position === 'last';
        const badge = BADGE[node.kind];
        const total = node.items.length;
        const live = node.items.filter((id) => {
          const item = doc.items[id];
          return item && !outOfWindow(item, w);
        }).length;

        return (
          <div
            key={node.id}
            class={`cv-row${selected === node.id ? ' selected' : ''}${over === node.id ? ' over' : ''}${drag === node.id ? ' dragging' : ''}`}
            draggable={!pinned}
            onDragStart={() => setDrag(node.id)}
            onDragEnd={() => { setDrag(null); setOver(null); }}
            onDragOver={(e) => { if (drag && !pinned) { e.preventDefault(); setOver(node.id); } }}
            onDragLeave={() => setOver(null)}
            onDrop={() => {
              if (drag && drag !== node.id) onReorder(drag, node.id);
              setDrag(null);
              setOver(null);
            }}
            onClick={() => onOpen(node.id)}
          >
            <span class="cv-grip">{pinned ? '' : '⠿'}</span>
            <span class="cv-label">{node.label}</span>
            {badge && <span class="ol-badge">{badge}</span>}
            <span class="cv-preview">{preview(doc, node)}</span>
            <span class="cv-count">
              {live === total ? `${total} item${total === 1 ? '' : 's'}` : `${live} of ${total}`}
            </span>
            {pinned
              ? <span class="pinned">fixed last</span>
              : (
                <span class="cv-actions">
                  <button class="ol-btn" title="Move up" disabled={i === 0}
                    onClick={(e) => { e.stopPropagation(); onMove(node.id, -1); }}>
                    <ArrowUp size={11} />
                  </button>
                  <button class="ol-btn" title="Move down"
                    onClick={(e) => { e.stopPropagation(); onMove(node.id, 1); }}>
                    <ArrowDown size={11} />
                  </button>
                  <button class="ol-btn danger" title="Remove section"
                    onClick={(e) => { e.stopPropagation(); onRemove(node.id); }}>
                    <X size={11} />
                  </button>
                </span>
              )}
          </div>
        );
      })}
    </div>
  );
}
