/**
 * The canvas row: `76px | 680px | {0 | 250px}` — structure, page, notes.
 *
 * Structure is left of the page and editorial is right of it: skeleton beside
 * the document, marginalia in the margin. The card is painted by the middle
 * cell on every row (see canvas.css) rather than drawn around the grid, which
 * would have to contain the margins too.
 *
 * Every row carries `data-anchor` — an item id, a node id, or `issue` — so the
 * progress strip can jump to it.
 */

import { createElement, type ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

import type { Item, SyncState } from '../../shared/types.ts';
import {
  ArrowDown, ArrowUp, CircleAlert, CloudCheck, CornerDownRight, CornerUpRight,
  Info, PencilLine, Spinner, WandSparkles, X,
} from '../icons.tsx';

interface RowProps {
  anchor: string;
  /** Mono section name, shown only when that name does not publish. */
  structureName?: string;
  rail?: ComponentChildren;
  margin?: ComponentChildren;
  selected?: boolean;
  children: ComponentChildren;
}

export function Row({ anchor, structureName, rail, margin, selected, children }: RowProps) {
  return (
    <div class={`row${selected ? ' selected' : ''}`} data-anchor={anchor}>
      <div class="row-structure">
        {structureName && <div class="structure-name">{structureName}</div>}
        {rail}
      </div>
      <div class="row-page">{children}</div>
      <div class="row-margin">{margin}</div>
    </div>
  );
}

// ── the control rail ──────────────────────────────────────────────────────

export interface RailAction {
  key: string;
  label: string;
  icon: ComponentChildren;
  onClick: () => void;
  disabled?: boolean;
  /** Shown instead of the plain hover border — used for remove. */
  danger?: boolean;
}

/**
 * A 2×n grid 49px wide, right-aligned against the card — not a horizontal run.
 * That shape is why the gutter is 76px rather than wider.
 *
 * The cluster sits at `opacity: .3` and comes up on row hover, so the skeleton
 * is legible without the controls competing with the prose.
 */
export function Rail({ sync, actions }: { sync?: SyncState; actions: RailAction[] }) {
  return (
    <div class="rail">
      {sync && <SyncGlyph state={sync} />}
      {actions.map((a) => (
        <button
          key={a.key}
          class={`rail-btn${a.danger ? ' danger' : ''}`}
          title={a.label}
          aria-label={a.label}
          disabled={a.disabled}
          onClick={a.onClick}
        >
          {a.icon}
        </button>
      ))}
    </div>
  );
}

const SYNC: Record<SyncState, { cls: string; label: string; icon: ComponentChildren }> = {
  synced: { cls: 'synced', label: 'Synced with the source', icon: <CloudCheck /> },
  syncing: { cls: 'saving', label: 'Writing back…', icon: <Spinner size={13} /> },
  failed: { cls: 'failed', label: 'Write failed — your edit is kept', icon: <CircleAlert /> },
  needs_commentary: { cls: 'needs', label: 'No commentary yet', icon: <PencilLine /> },
  local: { cls: 'needs', label: 'Edited here, not yet written back', icon: <PencilLine /> },
};

/** Nothing renders when there is nothing to sync. */
export function SyncGlyph({ state }: { state: SyncState }) {
  const s = SYNC[state];
  if (!s) return null;
  return <span class={`sync-glyph ${s.cls}`} title={s.label} aria-label={s.label}>{s.icon}</span>;
}

/** The standard rail for one item. Sections have no `info` — they have no inspector. */
export function itemRail(opts: {
  item: Item;
  canPromote: boolean;
  promoteWhy?: string;
  onPromote: () => void;
  onUp: () => void;
  onDown: () => void;
  onInspect: () => void;
}): { sync?: SyncState; actions: RailAction[] } {
  return {
    sync: opts.item.sync_state,
    actions: [
      {
        key: 'promote',
        label: opts.promoteWhy ?? 'Promote to its own section',
        icon: <CornerUpRight />,
        disabled: !opts.canPromote,
        onClick: opts.onPromote,
      },
      { key: 'up', label: 'Move up', icon: <ArrowUp />, onClick: opts.onUp },
      { key: 'down', label: 'Move down', icon: <ArrowDown />, onClick: opts.onDown },
      { key: 'info', label: 'Inspect', icon: <Info />, onClick: opts.onInspect },
    ],
  };
}

/** The rail for a section heading: reorder, demote a promoted item, remove. */
export function sectionRail(opts: {
  promoted: boolean;
  movable: boolean;
  onDemote: () => void;
  onUp: () => void;
  onDown: () => void;
  onRemove: () => void;
}): { actions: RailAction[] } {
  const actions: RailAction[] = [];
  if (opts.promoted) {
    actions.push({
      key: 'demote', label: 'Put back in Journal',
      icon: <CornerDownRight />, onClick: opts.onDemote,
    });
  }
  actions.push(
    { key: 'up', label: 'Move section up', icon: <ArrowUp />, disabled: !opts.movable, onClick: opts.onUp },
    { key: 'down', label: 'Move section down', icon: <ArrowDown />, disabled: !opts.movable, onClick: opts.onDown },
    { key: 'remove', label: 'Remove section', icon: <X size={12} />, danger: true, onClick: opts.onRemove },
  );
  return { actions };
}

// ── the editorial margin's draft button ───────────────────────────────────

/**
 * Full strength when the item has no text — the wand is the way in. Dimmed to
 * `.35` and hover-revealed when pressing it would overwrite something Jamie
 * wrote, which is a different and rarer intent.
 */
export function Wand({ redraft, onClick, busy }: { redraft: boolean; onClick: () => void; busy?: boolean }) {
  return (
    <button
      class={`wand${redraft ? ' redraft' : ''}`}
      title={redraft ? 'Draft this again' : 'Draft this'}
      aria-label={redraft ? 'Draft this again' : 'Draft this'}
      disabled={busy}
      onClick={onClick}
    >
      {busy ? <Spinner size={12} /> : <WandSparkles />}
    </button>
  );
}

// ── editing ───────────────────────────────────────────────────────────────

interface EditableProps {
  value: string;
  onCommit: (next: string) => void;
  ph?: string;
  class?: string;
  multiline?: boolean;
  readOnly?: boolean;
  tag?: 'span' | 'div' | 'h1' | 'h2' | 'p';
}

/**
 * A `contenteditable` run, committed on blur.
 *
 * Deliberately uncontrolled. Writing `value` back into the node on every render
 * moves the caret to the start mid-word, so the DOM text is only reset when the
 * value changed *elsewhere* and this node does not have focus.
 */
export function Editable({
  value, onCommit, ph, class: cls, multiline, readOnly, tag = 'span',
}: EditableProps) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || document.activeElement === el) return;
    if (el.textContent !== value) el.textContent = value ?? '';
  }, [value]);

  if (readOnly) return createElement(tag, { class: cls }, value);

  return createElement(tag, {
    ref,
    class: cls,
    contentEditable: true,
    spellcheck: true,
    'data-ph': ph,
    onBlur: (e: FocusEvent) => {
      const text = (e.currentTarget as HTMLElement).textContent ?? '';
      if (text !== value) onCommit(text);
    },
    onKeyDown: (e: KeyboardEvent) => {
      const el = e.currentTarget as HTMLElement;
      if (e.key === 'Escape') { el.textContent = value; el.blur(); return; }
      if (e.key === 'Enter' && !multiline) { e.preventDefault(); el.blur(); }
    },
  });
}


/**
 * An editable run that *reads* as rendered Markdown and *edits* as source.
 *
 * The page is the editor, so a link has to look like a link — but the stored
 * value is Markdown and round-tripping rendered HTML back to Markdown loses
 * information. So the node shows rendered HTML at rest and swaps to the source
 * text for editing.
 *
 * The swap happens on `mousedown`, before focus lands. Doing it on `focus`
 * would replace the text after the browser had already chosen a caret position,
 * dropping the caret at the start of the run instead of where Jamie clicked.
 */
export function RichEditable({
  value, onCommit, ph, class: cls, readOnly, render,
}: EditableProps & { render: (source: string) => string }) {
  const ref = useRef<HTMLElement>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || editing) return;
    el.innerHTML = value ? render(value) : '';
  }, [value, editing, render]);

  if (readOnly) {
    return <span class={cls} dangerouslySetInnerHTML={{ __html: value ? render(value) : '' }} />;
  }

  const toSource = () => {
    if (editing) return;
    setEditing(true);
    if (ref.current) ref.current.textContent = value;
  };

  return (
    <span
      ref={ref}
      class={cls}
      contentEditable
      spellcheck
      data-ph={ph}
      onMouseDown={toSource}
      onFocus={() => {
        // Keyboard focus: no click position to preserve, so caret goes to the end.
        if (editing) return;
        toSource();
        const el = ref.current;
        if (!el) return;
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }}
      onBlur={(e: FocusEvent) => {
        const el = e.currentTarget as HTMLElement;
        const text = el.textContent ?? '';
        setEditing(false);
        if (text !== value) onCommit(text);
        else el.innerHTML = value ? render(value) : '';
      }}
      onKeyDown={(e: KeyboardEvent) => {
        const el = e.currentTarget as HTMLElement;
        if (e.key === 'Escape') { el.textContent = value; el.blur(); return; }
        if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
      }}
    />
  );
}
