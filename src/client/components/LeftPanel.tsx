/**
 * The left panel: what this issue *is*, and what is in it.
 *
 * Two states. At rest it is three lines of fact. Open for editing it is the
 * only place the issue's identity can be changed, which keeps the canvas about
 * the material and nothing else.
 */

import { useEffect, useRef, useState } from 'preact/hooks';

import type { IssueDoc, IssueNode } from '../../shared/types.ts';
import { isSaturday, shortKicker, spanLabel } from '../../shared/dates.ts';
import { itemsInWindow, orderedNodes, outOfWindow, windowOf } from '../../shared/render/plan.ts';
import { api } from '../api.ts';
import { ArrowDown, ArrowUp, EyeOff, GripVertical, X } from '../icons.tsx';
import { EventLog } from './EventLog.tsx';
import { Input } from './Field.tsx';
import { omnifocusUrl, taskpaper } from '../../shared/taskpaper.ts';
import { isFrozen } from './Page.tsx';

interface Props {
  doc: IssueDoc;
  selected: string | null;
  onSelect: (anchor: string) => void;
  /** Resolves to whether the change was saved. */
  onSettings: (patch: Record<string, unknown>) => Promise<boolean>;
  onMove: (nodeId: string, delta: number) => void;
  onRemove: (nodeId: string) => void;
  onAdd: (spec: { type: string; label: string; id?: string }) => void;
  onReorder: (nodeId: string, beforeId: string | null) => void;
  onSweep: () => void;
  sweeping: boolean;
  onShare: (note?: string) => Promise<unknown>;
  onUnshare: () => Promise<unknown>;
}

const SPANS = [7, 14, 21];

/**
 * Sharing a draft: a static page on the CDN, loudly labeled DRAFT, with an
 * optional note to the person it is for. Re-sharing refreshes the same URL;
 * Stop sharing deletes the page.
 */
function ShareCard({ doc, onShare, onUnshare }: {
  doc: IssueDoc;
  onShare: (note?: string) => Promise<unknown>;
  onUnshare: () => Promise<unknown>;
}) {
  const share = doc.draft_share;
  const [note, setNote] = useState(share?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const act = (fn: () => Promise<unknown>) => {
    setBusy(true);
    void fn().finally(() => setBusy(false));
  };

  return (
    <div class="meta-card share-card">
      {share ? (
        <>
          <div class="quiet">A DRAFT-labeled page, live at:</div>
          <a class="share-url" href={share.url} target="_blank" rel="noreferrer">
            {share.url.replace(/^https:\/\//, '')}
          </a>
        </>
      ) : (
        <div class="quiet">
          Publishes the draft as one DRAFT-labeled page at an unguessable URL.
        </div>
      )}
      <textarea
        class="share-note"
        rows={3}
        placeholder="A note to the person you're sharing with (optional)"
        value={note}
        onInput={(e) => setNote((e.currentTarget as HTMLTextAreaElement).value)}
      />
      <div class="meta-actions">
        <button class="btn small primary" disabled={busy}
          onClick={() => act(() => onShare(note || undefined))}>
          {busy ? 'Working…' : share ? 'Update page' : 'Share draft'}
        </button>
        {share && (
          <button class="btn small" onClick={() => {
            void navigator.clipboard.writeText(share.url).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}>
            {copied ? 'Copied' : 'Copy link'}
          </button>
        )}
        {share && (
          <button class="btn small" disabled={busy} onClick={() => act(onUnshare)}>
            Stop sharing
          </button>
        )}
      </div>
    </div>
  );
}

export function LeftPanel(props: Props) {
  const { doc } = props;
  const [editing, setEditing] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const w = windowOf(doc);
  const nodes = orderedNodes(doc);
  const swept = Object.keys(doc.items).length;
  const inWindow = itemsInWindow(doc).length;
  const outside = swept - inWindow;
  // Put to bed (or a pre-Builder record), nothing here changes: no Edit, no
  // Share, and an outline that only navigates.
  const frozen = isFrozen(doc);

  return (
    <aside class="left-panel">
      <div class="panel-head">
        <span class="mono-label">WT{doc.issue.number}</span>
        <span class="spacer" />
        {!frozen && (
          <button
            class={`btn tiny${editing ? ' primary' : ''}`}
            onClick={() => setEditing(!editing)}
          >
            {editing ? 'Done' : 'Edit'}
          </button>
        )}
      </div>

      {editing && !frozen
        ? <MetaEditor doc={doc} onSettings={props.onSettings} onSweep={props.onSweep} sweeping={props.sweeping} />
        : (
          <div class="meta-card">
            <div><span class="k">Publishes</span> {shortKicker(doc.issue.publication_date)}</div>
            <div><span class="k">Sources</span> {spanLabel(w)}</div>
            <div class="quiet">
              {outside > 0
                ? `${inWindow} items in that span · ${outside} scanned earlier now fall outside it.`
                : `${swept} items swept in from that span.`}
            </div>
            <div class="meta-actions">
              {/* A draft's only: the server refuses a scan once the issue is published. */}
              {doc.issue.status === 'draft' && (
                <button class="btn small" disabled={props.sweeping} onClick={props.onSweep}>
                  {props.sweeping ? 'Re-scanning…' : 'Re-scan'}
                </button>
              )}
              <button class="btn small" onClick={() => setLogOpen(true)}>Log</button>
              {!frozen && (
                <button
                  class={`btn small${doc.draft_share ? ' primary' : ''}`}
                  onClick={() => setShareOpen(!shareOpen)}
                >
                  {doc.draft_share ? 'Shared' : 'Share'}
                </button>
              )}
              {/* The issue's project, straight into OmniFocus: Jamie's
                  template with the builder's three dates in it. ⌥-click
                  copies the TaskPaper instead (shared/taskpaper.ts). */}
              <button
                class="btn small"
                title="Create this issue's project in OmniFocus (⌥-click to copy the TaskPaper)"
                onClick={(e) => {
                  const text = taskpaper(doc, window.location.origin);
                  if (e.altKey) { void navigator.clipboard.writeText(text); return; }
                  window.location.href = omnifocusUrl(text);
                }}
              >
                OmniFocus
              </button>
            </div>
          </div>
        )}

      {!editing && shareOpen && !frozen && (
        <ShareCard doc={doc} onShare={props.onShare} onUnshare={props.onUnshare} />
      )}

      {logOpen && (
        <EventLog issueId={doc.issue.id} number={doc.issue.number} onClose={() => setLogOpen(false)} />
      )}

      <Outline {...props} nodes={nodes} frozen={frozen} />
      <div class="panel-foot quiet">⌘/ for keyboard shortcuts</div>
    </aside>
  );
}

// ── issue metadata ────────────────────────────────────────────────────────

/**
 * Title and dek. The title is in the email's subject ("WT351 — title") and
 * the dek is the page's description. The canvas head edits them too, but a
 * published issue's head is read-only, so neither had an edit path, and a
 * fix made in Buttondown was reverted by the next re-send (review
 * 2026-09-27, §2.5).
 */
function HeadFields({ doc, onSettings }: {
  doc: IssueDoc;
  onSettings: (p: Record<string, unknown>) => Promise<boolean>;
}) {
  return (
    <>
      <label class="field-row col">
        <span class="mono-label">TITLE · IN THE EMAIL SUBJECT</span>
        <Input
          type="text" class="wide" value={doc.issue.title} placeholder="Untitled issue"
          onCommit={(text) => (text !== doc.issue.title ? onSettings({ title: text }) : undefined)}
        />
      </label>
      <label class="field-row col">
        <span class="mono-label">DEK</span>
        <Input
          type="text" class="wide" value={doc.issue.dek ?? ''} placeholder="A line about this issue…"
          onCommit={(text) => (text !== (doc.issue.dek ?? '') ? onSettings({ dek: text }) : undefined)}
        />
      </label>
    </>
  );
}

function MetaEditor({
  doc, onSettings, onSweep, sweeping,
}: {
  doc: IssueDoc;
  onSettings: (p: Record<string, unknown>) => Promise<boolean>;
  onSweep: () => void;
  sweeping: boolean;
}) {
  const w = windowOf(doc);
  const [snapped, setSnapped] = useState(false);
  // The date saves on change, the way a picker is used; its blur waits on
  // that save, as every other field's blur waits on its own. It resynced at
  // once instead, so the old date showed while the save was out and a
  // failed save dropped the typed one (Batch 5 review round 2).
  const dateSave = useRef<Promise<boolean> | undefined>(undefined);

  // Number, date and window are the edition's identity. Published, each
  // saved at once and the next re-send published a different edition — a
  // renumber forked the site, emails.json, the feed and the archive (review
  // 2026-09-27, §2.5). The server refuses them; here they are facts.
  if (doc.issue.status !== 'draft') {
    return (
      <div class="meta-card edit">
        <HeadFields doc={doc} onSettings={onSettings} />
        <div class="field-row">
          <span class="mono-label">ISSUE NUMBER</span>
          <span class="fixed-value">{doc.issue.number}</span>
        </div>
        <div class="field-row">
          <span class="mono-label">PUBLISHES</span>
          <span class="fixed-value">{shortKicker(doc.issue.publication_date)}</span>
        </div>
        <div class="field-row col">
          <span class="mono-label">SOURCE MATERIAL</span>
          <div class="window-line">{doc.issue.window_days} days · {spanLabel(w)}</div>
        </div>
        <p class="quiet fixed-note">
          Published: the number, date and window are fixed. A re-send would
          publish a different edition.
        </p>
      </div>
    );
  }

  return (
    <div class="meta-card edit">
      <HeadFields doc={doc} onSettings={onSettings} />
      <label class="field-row">
        <span class="mono-label">ISSUE NUMBER</span>
        <Input
          type="number" class="num" value={doc.issue.number}
          onCommit={(text) => {
            const n = Number(text);
            return n && n !== doc.issue.number ? onSettings({ number: n }) : undefined;
          }}
        />
      </label>

      <label class="field-row">
        <span class="mono-label">PUBLISHES</span>
        <Input
          type="date" value={doc.issue.publication_date}
          onChange={(e) => {
            const date = (e.target as HTMLInputElement).value;
            if (!date) return;
            setSnapped(!isSaturday(date));
            dateSave.current = onSettings({ publication_date: date });
          }}
          onCommit={() => {
            const saving = dateSave.current;
            dateSave.current = undefined;
            return saving;
          }}
        />
      </label>
      {snapped && (
        <p class="amber-note">
          Moved to its Saturday — the issue is dated Saturday no matter when
          it sends.
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
          <Input
            type="number" class="num small" value={doc.issue.window_days}
            aria-label="Days back from Friday"
            onCommit={(text) => {
              const d = Number(text);
              return d && d !== doc.issue.window_days ? onSettings({ window_days: d }) : undefined;
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
  doc, nodes, frozen, selected, onSelect, onMove, onRemove, onAdd, onReorder,
}: Props & { nodes: IssueNode[]; frozen: boolean }) {
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
        <p class="quiet">{frozen ? 'Click a row to go to it.' : 'Drag a row, or use the arrows. Echoes stays last.'}</p>
      </div>

      <div class="outline">
        {nodes.map((node, i) => {
          const pinned = node.fixed_position === 'last';
          // Frozen, a row is only a way to the section.
          const fixed = pinned || frozen;
          const badge = BADGE[node.kind];
          return (
            <div
              key={node.id}
              class={`ol-row${selected === node.id ? ' selected' : ''}${drag === node.id ? ' dragging' : ''}`}
              draggable={!fixed}
              onDragStart={() => setDrag(node.id)}
              onDragEnd={() => setDrag(null)}
              onDragOver={(e) => { if (drag && !fixed) e.preventDefault(); }}
              onDrop={() => { if (drag && drag !== node.id) onReorder(drag, node.id); setDrag(null); }}
              onClick={() => onSelect(node.id)}
            >
              {fixed ? <span class="grip-space" /> : <GripVertical class="grip" />}
              <span class={`prov ${node.items.length ? provOf(doc, node) : 'own'}`} />
              <span class="ol-label">{node.label}</span>
              {node.publishes_heading === false && (
                <EyeOff class="eye" />
              )}
              {badge && <span class="ol-badge">{badge}</span>}
              <span class="ol-count">{inWindowCount(doc, node)}</span>
              {pinned
                ? <span class="pinned">pinned</span>
                : !frozen && (
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

      {!frozen && <div class="outline-foot">
        <button class="ghost" onClick={() => onAdd({ type: 'ad_hoc', label: 'New section' })}>
          + Section
        </button>
        <button class="ghost" onClick={() => onAdd({ type: 'mdblock', label: 'Markdown' })}>
          + Markdown
        </button>
      </div>}

      {!frozen && absent.length > 0 && (
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
/** How many of a node's items the window still admits — the count the editions will print. */
function inWindowCount(doc: IssueDoc, node: IssueNode): number {
  const w = windowOf(doc);
  return node.items.filter((id) => {
    const item = doc.items[id];
    return item && !outOfWindow(item, w);
  }).length;
}

function provOf(doc: IssueDoc, node: IssueNode): string {
  const kinds = new Set(
    node.items.map((id) => doc.items[id]?.authorship).filter(Boolean),
  );
  if (kinds.has('Thingy')) return 'thingy';
  if (kinds.has('syndicated')) return 'syndicated';
  return 'own';
}
