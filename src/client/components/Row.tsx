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
  gone: { cls: 'failed', label: 'Deleted at the source — your copy is kept', icon: <CircleAlert /> },
  conflict: { cls: 'failed', label: 'Edited here and at the source — your copy is kept', icon: <CircleAlert /> },
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
  /** Absent for seeded singletons (Photo, Intro…) — their section's X owns removal. */
  onRemove?: () => void;
  /**
   * Links only: Notable ↔ Briefly. Takes the promote slot — a link never
   * promotes, so for links that slot was a permanently disabled button.
   */
  moveSection?: { target: 'Notable' | 'Briefly'; onClick: () => void };
}): { sync?: SyncState; actions: RailAction[] } {
  const first: RailAction = opts.moveSection
    ? {
        key: 'move-section',
        label: `Move to ${opts.moveSection.target} — updates the _brief tag on Pinboard`,
        icon: opts.moveSection.target === 'Notable' ? <CornerUpRight /> : <CornerDownRight />,
        onClick: opts.moveSection.onClick,
      }
    : {
        key: 'promote',
        label: opts.promoteWhy ?? 'Promote to its own section',
        icon: <CornerUpRight />,
        disabled: !opts.canPromote,
        onClick: opts.onPromote,
      };
  const actions: RailAction[] = [
    first,
    { key: 'up', label: 'Move up', icon: <ArrowUp />, onClick: opts.onUp },
    { key: 'down', label: 'Move down', icon: <ArrowDown />, onClick: opts.onDown },
    { key: 'info', label: 'Inspect', icon: <Info />, onClick: opts.onInspect },
  ];
  if (opts.onRemove) {
    actions.push({
      key: 'remove',
      label: opts.item.authorship === 'syndicated'
        ? 'Remove — held out, so the sweep cannot bring it back'
        : 'Delete',
      icon: <X size={12} />,
      danger: true,
      onClick: opts.onRemove,
    });
  }
  return { sync: opts.item.sync_state, actions };
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

// ── Markdown sugar on the keyboard ────────────────────────────────────────
//
// The editables hold Markdown source while editing. These are the gestures
// a writer expects from any text field, expressed as Markdown: ⌘B, ⌘I, ⌘⇧K
// (code) wrap or unwrap the selection; ⌘K makes a link; pasting a URL over a
// selection links it. No toolbar, no editor library — the page is the editor
// (Jamie, 2026-09-20). All edits go through insertText so undo works.

/** Text offsets of the selection inside `el`, or null when it is elsewhere. */
function selectionOffsets(el: HTMLElement): { start: number; end: number; text: string } | null {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) return null;
  const before = document.createRange();
  before.selectNodeContents(el);
  before.setEnd(range.startContainer, range.startOffset);
  const start = before.toString().length;
  const text = range.toString();
  return { start, end: start + text.length, text };
}

/** Select the run [start, end) of `el`'s text, across its text nodes. */
function selectOffsets(el: HTMLElement, start: number, end: number): void {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let seen = 0;
  let from: [Node, number] | null = null;
  let to: [Node, number] | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const len = node.textContent?.length ?? 0;
    if (!from && start <= seen + len) from = [node, start - seen];
    if (!to && end <= seen + len) { to = [node, end - seen]; break; }
    seen += len;
  }
  if (!from || !to) return;
  const sel = window.getSelection();
  sel?.setBaseAndExtent(from[0], from[1], to[0], to[1]);
}

function insertText(text: string): void {
  document.execCommand('insertText', false, text);
}

/** Wrap the selection in `mark`, or unwrap it if it (or its surroundings) already is. */
function toggleWrap(el: HTMLElement, mark: string): void {
  const s = selectionOffsets(el);
  if (!s) return;
  const all = el.textContent ?? '';
  const n = mark.length;

  if (s.text.startsWith(mark) && s.text.endsWith(mark) && s.text.length >= 2 * n) {
    insertText(s.text.slice(n, -n));
    return;
  }
  if (all.slice(s.start - n, s.start) === mark && all.slice(s.end, s.end + n) === mark) {
    selectOffsets(el, s.start - n, s.end + n);
    insertText(s.text);
    return;
  }
  if (!s.text) {
    insertText(mark + mark);
    selectOffsets(el, s.start + n, s.start + n);
    return;
  }
  // Keep the surrounding whitespace outside the marks: "**word **" is not bold.
  const lead = s.text.length - s.text.trimStart().length;
  const trail = s.text.length - s.text.trimEnd().length;
  const core = s.text.trim();
  if (!core) return;
  insertText(s.text.slice(0, lead) + mark + core + mark + s.text.slice(s.text.length - trail));
}

const URL_ONLY = /^\s*https?:\/\/\S+\s*$/i;

/** ⌘K: [selection](|) with the caret in the parentheses; no selection: [|](). */
function makeLink(el: HTMLElement): void {
  const s = selectionOffsets(el);
  if (!s) return;
  if (URL_ONLY.test(s.text)) {
    // A selected URL becomes a link whose text is still to be written.
    insertText(`[](${s.text.trim()})`);
    selectOffsets(el, s.start + 1, s.start + 1);
    return;
  }
  insertText(`[${s.text}]()`);
  const caret = s.text ? s.start + s.text.length + 3 : s.start + 1;
  selectOffsets(el, caret, caret);
}

/** True when the key event was a formatting shortcut and has been handled. */
export function formatShortcut(e: KeyboardEvent): boolean {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return false;
  const el = e.currentTarget as HTMLElement;
  const key = e.key.toLowerCase();
  if (key === 'b' && !e.shiftKey) toggleWrap(el, '**');
  else if (key === 'i' && !e.shiftKey) toggleWrap(el, '_');
  else if (key === 'k' && e.shiftKey) toggleWrap(el, '`');
  else if (key === 'k') makeLink(el);
  else return false;
  e.preventDefault();
  return true;
}

// ── rich text in, Markdown out ────────────────────────────────────────────
//
// The editables commit `textContent`, and a paste from Safari, Notes, or
// Mail arrives as HTML: the links showed on screen as links and vanished on
// blur, because an <a> has no textContent that says where it went (WT350's
// Currently lines, 2026-09-20). Anything rich that lands in an editable is
// read back as inline Markdown instead, and a paste is converted on the way
// in so what is on screen is what will be kept.

/**
 * Inline Markdown for a DOM fragment: links, emphasis, code, line breaks.
 * `blockBreak` is what a P/DIV boundary becomes: a paragraph ("\n\n") for
 * pasted HTML, a line ("\n") for what the browser itself puts in a
 * contenteditable — Safari wraps every Enter in a <div>, and an empty one is
 * the blank line between paragraphs.
 */
export function domToMarkdown(root: Node, blockBreak = '\n\n'): string {
  const walk = (node: Node): string => {
    // Numeric node types, not Node.TEXT_NODE: this runs under test without a DOM.
    if (node.nodeType === 3) return (node.textContent ?? '').replace(/\u00a0/g, ' ');
    if (node.nodeType !== 1) return '';
    const el = node as HTMLElement;
    const inner = () => Array.from(el.childNodes).map(walk).join('');
    switch (el.tagName) {
      case 'BR': return '\n';
      case 'A': {
        const href = el.getAttribute('href') ?? '';
        const text = inner().trim();
        return /^https?:\/\//i.test(href) && text ? `[${text}](${href})` : text;
      }
      case 'STRONG': case 'B': { const t = inner(); return t.trim() ? `**${t.trim()}**` : t; }
      case 'EM': case 'I': { const t = inner(); return t.trim() ? `_${t.trim()}_` : t; }
      case 'CODE': { const t = inner(); return t ? `\`${t}\`` : ''; }
      case 'IMG': return '';
      case 'STYLE': case 'SCRIPT': case 'HEAD': return '';
      case 'P': case 'DIV': case 'LI': case 'H1': case 'H2': case 'H3': case 'H4': case 'BLOCKQUOTE':
        return `${inner()}${blockBreak}`;
      default: return inner();
    }
  };
  return walk(root)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * What a contenteditable holds, as text with its line structure. textContent
 * drops the newlines the browser expressed as <div> and <br>; this keeps them,
 * and turns any rich node that got in into Markdown.
 */
export function readEditable(el: HTMLElement, multiline: boolean): string {
  if (el.querySelector('a, strong, b, em, i, code')) return domToMarkdown(el, multiline ? '\n' : ' ');
  if (!multiline) return el.textContent ?? '';
  return domToMarkdown(el, '\n');
}

/** Clipboard → inline Markdown. Plain text as-is; HTML only when it carries structure. */
export function pasteAsMarkdown(data: DataTransfer | null): string {
  const plain = data?.getData('text/plain') ?? '';
  const html = data?.getData('text/html') ?? '';
  if (!html || !/<(a|strong|b|em|i|code)\b/i.test(html)) return plain.replace(/\u00a0/g, ' ');
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  return domToMarkdown(parsed.body) || plain;
}

function insertPaste(e: ClipboardEvent, multiline: boolean): void {
  e.preventDefault();
  let text = pasteAsMarkdown(e.clipboardData);
  if (!multiline) text = text.replace(/\s*\n\s*/g, ' ');
  // A URL pasted over selected words links them.
  const el = e.currentTarget as HTMLElement;
  const s = selectionOffsets(el);
  if (s?.text.trim() && URL_ONLY.test(text) && !URL_ONLY.test(s.text)) {
    text = `[${s.text}](${text.trim()})`;
  }
  document.execCommand('insertText', false, text);
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
    onPaste: (e: ClipboardEvent) => insertPaste(e, Boolean(multiline)),
    onBlur: (e: FocusEvent) => {
      const el = e.currentTarget as HTMLElement;
      const text = readEditable(el, Boolean(multiline));
      if (text !== value) onCommit(text);
    },
    onKeyDown: (e: KeyboardEvent) => {
      if (formatShortcut(e)) return;
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
  value, onCommit, ph, class: cls, readOnly, render, multiline, tag = 'span',
}: EditableProps & { render: (source: string) => string }) {
  const ref = useRef<HTMLElement>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || editing) return;
    el.innerHTML = value ? render(value) : '';
  }, [value, editing, render]);

  if (readOnly) {
    return createElement(tag, { class: cls, dangerouslySetInnerHTML: { __html: value ? render(value) : '' } });
  }

  const toSource = () => {
    if (editing) return;
    setEditing(true);
    if (ref.current) ref.current.textContent = value;
  };

  return createElement(tag, {
    ref,
    class: cls,
    contentEditable: true,
    spellcheck: true,
    'data-ph': ph,
    onMouseDown: toSource,
    onFocus: () => {
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
      },
    onPaste: (e: ClipboardEvent) => insertPaste(e, Boolean(multiline)),
    onBlur: (e: FocusEvent) => {
      const el = e.currentTarget as HTMLElement;
      // In source mode the node holds Markdown text; anything rich that got
      // in (a paste the handler missed, a drop) is read back as Markdown too.
      const text = readEditable(el, Boolean(multiline));
      setEditing(false);
      if (text !== value) onCommit(text);
      else el.innerHTML = value ? render(value) : '';
    },
    onKeyDown: (e: KeyboardEvent) => {
      if (formatShortcut(e)) return;
      const el = e.currentTarget as HTMLElement;
      if (e.key === 'Escape') { el.textContent = value; el.blur(); return; }
      if (e.key === 'Enter' && !multiline) { e.preventDefault(); el.blur(); }
    },
  });
}
