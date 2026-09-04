/**
 * The issue as a page — the editor is a WYSIWYG rendering of the material,
 * not a form beside a preview.
 *
 * Every block is a `Row`, so structure lands in the left margin and editorial
 * in the right one while the card stays continuous behind the reading column.
 * The lens decides what the middle cell renders; the margins are the same in
 * all four.
 */

import type { ComponentChildren, RefObject } from 'preact';
import { useState } from 'preact/hooks';

import type { ArchiveReference, Channel, IssueDoc, IssueNode, Item } from '../../shared/types.ts';
import { CHANNELS } from '../../shared/types.ts';
import { clockTime, kickerDate, longDate, wallClock, weekday } from '../../shared/dates.ts';
import {
  editionOnly, falloutOf, heldOut, orderedNodes, outOfWindow, windowOf,
} from '../../shared/render/plan.ts';
import { audioScript } from '../../shared/render/audio.ts';
import { MEMBER_THANKS, PREMIUM_CONDITION } from '../../shared/render/email.ts';
import { rejoinBody, splitBody } from '../../shared/body.ts';
import { markdownInlineToSafeHtml } from '../../shared/markdown.ts';
import { ImagePlus, Plus, Spinner, Trash } from '../icons.tsx';
import { Editable, Rail, RichEditable, Row, Wand, itemRail, sectionRail } from './Row.tsx';

export type Lens = Channel | 'source';

/** Link sections whose entries can move down to Briefly (matches plan.ts). */
const HEADING_LINK_SECTIONS: ReadonlySet<string> = new Set(['notable', 'featured']);

export interface PageActions {
  updateItem(itemId: string, patch: Record<string, unknown>): void;
  updateIssue(patch: Record<string, unknown>): void;
  moveItem(nodeId: string, itemId: string, delta: number): void;
  removeItem(nodeId: string, itemId: string): void;
  moveNode(nodeId: string, delta: number): void;
  removeNode(nodeId: string): void;
  addNode(spec: { type: string; label: string; before?: string; kind?: string }): void;
  addItem(nodeId: string, type: string): void;
  promote(itemId: string): void;
  demote(nodeId: string): void;
  moveToSection(itemId: string, target: 'Notable' | 'Briefly'): void;
  setChannel(itemId: string, channel: Channel, on: boolean): void;
  draft(itemId: string): void;
  uploadPhoto(itemId: string, file: File): Promise<unknown>;
}

interface PageProps {
  doc: IssueDoc;
  lens: Lens;
  selected: string | null;
  onSelect: (anchor: string | null) => void;
  act: PageActions;
  drafting: string | null;
  draft: { itemId: string; candidates: string[]; references?: ArchiveReference[] } | null;
  onPickDraft: (itemId: string, text: string) => void;
  onDismissDraft: () => void;
  /** The `position: relative` host the note overlay measures against. */
  hostRef?: RefObject<HTMLDivElement>;
  /** Opens the notes track from 0 to 250px. */
  withNotes?: boolean;
  children?: ComponentChildren;
}

/** Sections that carry themselves — printing the label would be an artifact. */
function headingPublishes(node: IssueNode): boolean {
  return node.publishes_heading !== false;
}

// ── word counting, for the byline ─────────────────────────────────────────

function words(s: string | undefined): number {
  const t = String(s ?? '').trim();
  return t ? t.split(/\s+/).length : 0;
}

function issueWords(doc: IssueDoc): number {
  return Object.values(doc.items).reduce(
    (n, i) => n + words(i.body) + words(i.commentary) + words(i.title) + words(i.media?.caption),
    0,
  );
}

export function Page({
  doc, lens, selected, onSelect, act, drafting, draft, onPickDraft, onDismissDraft,
  hostRef, withNotes, children,
}: PageProps) {
  const published = doc.issue.status === 'published';
  const readOnly = published;
  const w = windowOf(doc);
  const nodes = orderedNodes(doc);

  // Audio is a script, not a page, so it does not share the block renderers.
  if (lens === 'audio') {
    return (
      <div class="rows lens-audio" ref={hostRef}>
        <AudioScript doc={doc} selected={selected} onSelect={onSelect} />
        {children}
      </div>
    );
  }

  const rows: ComponentChildren[] = [];

  // ── head ────────────────────────────────────────────────────────────────
  const linkCount = Object.values(doc.items).filter((i) => i.type === 'pinboard_link').length;
  const wordCount = issueWords(doc);
  const stats = lens === 'source'
    ? `${nodes.length} nodes · ${Object.keys(doc.items).length} items · ${wordCount} words`
    : `${wordCount.toLocaleString()} words · ${linkCount} links · ~${Math.max(1, Math.round(wordCount / 220))} min read`;

  rows.push(
    <Row
      key="head"
      anchor="issue"
      selected={selected === 'issue'}
      margin={<Wand
        redraft={Boolean(doc.issue.dek)}
        busy={drafting === 'issue'}
        onClick={() => act.draft('issue')}
      />}
    >
      <div class="page-head" onClick={() => onSelect('issue')}>
        <div class="kicker">WT{doc.issue.number} · {kickerDate(doc.issue.publication_date)}</div>
        <Editable
          tag="h1"
          readOnly={readOnly}
          value={doc.issue.title}
          ph="Untitled issue"
          onCommit={(title) => act.updateIssue({ title })}
        />
        <Editable
          tag="p"
          class="dek"
          readOnly={readOnly}
          value={doc.issue.dek ?? ''}
          ph="A line about this issue…"
          onCommit={(dek) => act.updateIssue({ dek })}
        />
        <div class="byline">
          {/* A website rendering artifact — Source shows the editor's measure instead. */}
          {lens !== 'source' && (
            <>
              <span class="avatar">JT</span>
              <span class="name">Jamie Thingelstad</span>
            </>
          )}
          <span class="stats">{stats}</span>
        </div>
      </div>
    </Row>,
  );

  // ── sections ────────────────────────────────────────────────────────────
  nodes.forEach((node, index) => {
    const inLens = lens === 'source'
      ? node.items
      : node.items.filter((id) => {
          const item = doc.items[id];
          return item && !outOfWindow(item, w) && item.channels[lens as Channel];
        });

    const fallout = falloutOf(doc, node, w);
    // Source shows structure as structure: every node gets a heading, including
    // the ones whose name does not publish.
    const showHeading = lens === 'source' || headingPublishes(node);

    // A section emptied by the window says so rather than vanishing: a section
    // that disappears silently reads as data loss.
    if (!inLens.length && !fallout.all && lens !== 'source') return;

    if (index > 0) {
      rows.push(
        <Row key={`${node.id}-rule`} anchor={node.id}>
          {!readOnly && lens === 'website' && (
            <InsertPoint
              onMarkdown={() => act.addNode({ kind: 'markdown', type: 'mdblock', label: 'Markdown block', before: node.id })}
              onSection={() => act.addNode({ type: 'ad_hoc', label: 'Section', before: node.id })}
            />
          )}
          <hr class="section-rule" />
        </Row>,
      );
    }

    const rail = sectionRail({
      promoted: node.kind === 'promoted_item',
      movable: node.movable && node.fixed_position !== 'last',
      onDemote: () => act.demote(node.id),
      onUp: () => act.moveNode(node.id, -1),
      onDown: () => act.moveNode(node.id, 1),
      onRemove: () => act.removeNode(node.id),
    });

    if (showHeading && lens === 'source') {
      const kind = node.kind === 'promoted_item' ? 'PROMOTED' : 'SECTION';
      rows.push(
        <Row
          key={`${node.id}-h`}
          anchor={node.id}
          selected={selected === node.id}
          rail={<Rail {...rail} />}
        >
          <div class="src-section" onClick={() => onSelect(node.id)}>
            <h2 class={fallout.all ? 'faded' : undefined}>{node.label}</h2>
            <span class="meta">
              {kind} · {node.type} · {node.items.length} ITEM{node.items.length === 1 ? '' : 'S'}
              {fallout.count > 0 && ` · ${fallout.count} OUTSIDE WINDOW`}
            </span>
          </div>
        </Row>,
      );
    } else if (showHeading) {
      rows.push(
        <Row
          key={`${node.id}-h`}
          anchor={node.id}
          selected={selected === node.id}
          rail={<Rail {...rail} />}
        >
          <h2 class={fallout.all ? 'faded' : undefined} onClick={() => onSelect(node.id)}>
            <span class="hash">#</span>
            <Editable
              readOnly={readOnly || node.kind === 'section'}
              value={node.label}
              onCommit={() => { /* renamed from the outline */ }}
            />
            {node.kind === 'ad_hoc' && <span class="note-pill">AD HOC SECTION</span>}
            {node.fixed_position === 'last' && <span class="note-pill">FIXED LAST · NOT IN AUDIO</span>}
            {fallout.all && (
              <span class="note-pill">ALL {fallout.count} FELL OUTSIDE THE WINDOW</span>
            )}
          </h2>
        </Row>,
      );
    }

    // Journal groups its items on date boundaries and prints the weekday alone.
    let lastKey = '';

    inLens.forEach((itemId, i) => {
      const item = doc.items[itemId];
      if (!item) return;

      if (node.type === 'journal' && lens !== 'source') {
        const c = wallClock(item.published_at);
        const key = c?.key ?? '';
        if (key !== lastKey) {
          lastKey = key;
          rows.push(
            <Row key={`${itemId}-date`} anchor={node.id}>
              <div class="journal-date">{c ? weekday(c) : ''}</div>
            </Row>,
          );
        }
      }

      // Seeded singletons (Photo, Intro…) are removed as sections; every
      // other item — a Currently entry, a link, a Journal post — gets its
      // own X on the rail.
      const singleton = ['intro', 'outro', 'photo', 'haiku', 'membership', 'echoes']
        .includes(item.type);

      // A link in a heading section moves down to Briefly; a Briefly link
      // moves up to Notable. The server mirrors the move onto the bookmark's
      // __brief tag, so the gesture is an edit at Pinboard too.
      const moveTarget: 'Notable' | 'Briefly' | null =
        item.type === 'pinboard_link'
          ? node.type === 'briefly' ? 'Notable'
            : HEADING_LINK_SECTIONS.has(node.type) ? 'Briefly'
            : null
          : null;

      const rowRail = itemRail({
        item,
        canPromote: node.type === 'journal' && Boolean(item.title),
        promoteWhy: node.type === 'journal' && !item.title
          ? 'An untitled post cannot be promoted — give it a title first'
          : undefined,
        onPromote: () => act.promote(itemId),
        ...(moveTarget
          ? {
              moveSection: {
                target: moveTarget,
                onClick: () => act.moveToSection(itemId, moveTarget),
              },
            }
          : {}),
        onUp: () => act.moveItem(node.id, itemId, -1),
        onDown: () => act.moveItem(node.id, itemId, 1),
        onInspect: () => onSelect(itemId),
        ...(singleton ? {} : { onRemove: () => act.removeItem(node.id, itemId) }),
      });

      const hasText = Boolean(item.commentary || item.body || item.media?.caption);

      rows.push(
        <Row
          key={itemId}
          anchor={itemId}
          selected={selected === itemId}
          structureName={!showHeading && i === 0 ? node.label.toUpperCase() : undefined}
          rail={<Rail {...rowRail} />}
          margin={
            <>
              <Wand
                redraft={hasText}
                busy={drafting === itemId}
                onClick={() => act.draft(itemId)}
              />
              {draft?.itemId === itemId && (
                <DraftPicker
                  candidates={draft.candidates}
                  onPick={(text) => onPickDraft(itemId, text)}
                  onDismiss={onDismissDraft}
                />
              )}
            </>
          }
        >
          <Block
            doc={doc} node={node} item={item} itemId={itemId} lens={lens}
            readOnly={readOnly} act={act} onSelect={onSelect}
          />
        </Row>,
      );
    });

    // Buttondown branches Membership on subscriber type. Only the email
    // renderer knows about Liquid — the item itself carries one body — so the
    // branch is shown here rather than living in the material.
    if (lens === 'email' && node.type === 'membership' && inLens.length > 0) {
      const body = inLens
        .map((id) => doc.items[id]?.body)
        .find((b) => b && b.trim());
      if (body) {
        rows.push(
          <Row key={`${node.id}-liquid`} anchor={node.id}>
            <div class="liquid">
              <code>{`{% if ${PREMIUM_CONDITION} %}`}</code>
              <code class="indent">…{` ${MEMBER_THANKS}`}</code>
              <code>{'{% else %}'}</code>
              <code class="indent">…</code>
              <code>{'{% endif %}'}</code>
            </div>
            <p class="liquid-note">
              Buttondown only. Members already supporting get the thanks; everyone
              else gets the invitation. The website prints the invitation variant
              as plain prose.
            </p>
          </Row>,
        );
      }
    }

    // Add affordances — dashed ghost chips where writing starts.
    if (!readOnly && lens === 'website') {
      if (node.type === 'currently') {
        rows.push(
          <Row key={`${node.id}-add`} anchor={node.id}>
            <button class="ghost-chip" onClick={() => act.addItem(node.id, 'currently')}>
              + Currently entry
            </button>
          </Row>,
        );
      }
      if (node.type === 'notable' || node.type === 'briefly') {
        rows.push(
          <Row key={`${node.id}-add`} anchor={node.id}>
            <button class="ghost-chip" onClick={() => act.addItem(node.id, 'pinboard_link')}>
              + Write a link here
            </button>
          </Row>,
        );
      }
    }

    // Held-out items stay visible so exclusion is reversible, not a disappearance.
    if (lens !== 'source') {
      for (const itemId of node.items) {
        const item = doc.items[itemId];
        if (!item || inLens.includes(itemId)) continue;
        if (outOfWindow(item, w)) continue;
        rows.push(
          <Row key={`${itemId}-held`} anchor={itemId}>
            <HeldStrip
              item={item}
              lens={lens as Channel}
              onPutBack={() => act.setChannel(itemId, lens as Channel, true)}
            />
          </Row>,
        );
      }
    }
  });

  if (!readOnly && lens === 'website') {
    const present = new Set(nodes.map((n) => String(n.type)));
    const tail: [string, string][] = [
      ['intro', '+ Intro'], ['quote', '+ Quote'], ['currently', '+ Currently'],
      ['photo', '+ Photo'], ['outro', '+ Outro'],
    ];
    rows.push(
      <Row key="tail-add" anchor="issue">
        <div class="ghost-tail">
          {tail.filter(([t]) => !present.has(t)).map(([t, label]) => (
            <button
              key={t}
              class="ghost-chip"
              onClick={() => act.addNode({ type: t, label: label.slice(2) })}
            >
              {label}
            </button>
          ))}
          <button class="ghost-chip" onClick={() => act.addNode({ kind: 'markdown', type: 'mdblock', label: 'Markdown block' })}>
            + Markdown block
          </button>
          <button class="ghost-chip" onClick={() => act.addNode({ type: 'ad_hoc', label: 'Section' })}>
            + Section
          </button>
        </div>
      </Row>,
    );
  }

  return (
    <div class={`rows lens-${lens}${withNotes ? ' with-notes' : ''}`} ref={hostRef}>
      {rows}
      {children}
    </div>
  );
}

/**
 * A section boundary's insert point — a hairline that only says what it can
 * do on hover, so the page stays a page until you ask (interface-spec,
 * hover-revealed chrome).
 */
function InsertPoint({ onMarkdown, onSection }: { onMarkdown: () => void; onSection: () => void }) {
  return (
    <div class="insert-point">
      <button class="ip-pill" onClick={onMarkdown}>+ Markdown here</button>
      <button class="ip-pill" onClick={onSection}>+ Section here</button>
    </div>
  );
}

// ── the Audio lens ────────────────────────────────────────────────────────

/**
 * A numbered script, not a page.
 *
 * The cues come from the renderer that actually feeds the synthesizer, so what
 * is on screen is the text that will be spoken. A lens that re-derived the
 * script could drift from the mp3 without anything failing.
 */
function AudioScript({
  doc, selected, onSelect,
}: { doc: IssueDoc; selected: string | null; onSelect: (a: string | null) => void }) {
  const script = audioScript(doc);

  let cue = 0;
  const omitted = doc.nodes.filter(
    (n) => n.items.length > 0 && !n.items.some((id) => doc.items[id]?.channels.audio),
  );

  return (
    <>
      {script.map((block, i) => {
        const anchor = block.itemId ?? block.nodeId ?? 'issue';

        if (block.kind === 'transition') {
          return (
            <Row key={`t-${i}`} anchor={anchor} selected={selected === anchor}>
              <div class="cue-section">
                <span class="cue-label">{block.text.replace(/\.$/, '').toUpperCase()}</span>
                <span class="cue-rule" />
              </div>
            </Row>
          );
        }

        cue += 1;
        const n = cue;

        // Briefly speaks title-first — the reverse of print. The title is
        // highlighted, and the first reversed cue says why once.
        const firstReversed = Boolean(block.reversed)
          && script.findIndex((b) => b.reversed) === i;
        let text: ComponentChildren = block.text;
        if (block.reversed && block.title && block.text.includes(block.title)) {
          const at = block.text.indexOf(block.title);
          text = (
            <>
              {block.text.slice(0, at)}
              <mark class="cue-title">{block.title}</mark>
              {block.text.slice(at + block.title.length)}
            </>
          );
        }

        return (
          <Row key={`c-${i}`} anchor={anchor} selected={selected === anchor}>
            <div class="cue" onClick={() => onSelect(anchor)}>
              <span class="cue-num">{String(n).padStart(2, '0')}</span>
              <span class="cue-text">
                {text}
                {firstReversed && (
                  <span class="cue-reverse-note">
                    TITLE FIRST — the page prints description → title; audio reverses.
                  </span>
                )}
              </span>
            </div>
          </Row>
        );
      })}

      {omitted.map((node) => (
        <Row key={`omit-${node.id}`} anchor={node.id}>
          <div class="cue-omit">
            <span class="cue-omit-label">NOT SPOKEN</span>
            <span>
              {node.type === 'echoes'
                ? 'Echoes is never spoken.'
                : node.type === 'photo'
                  ? 'The photo is omitted rather than narrated.'
                  : `${node.label} is held out of the audio edition.`}
            </span>
          </div>
        </Row>
      ))}
    </>
  );
}

// ── one item, rendered for a lens ─────────────────────────────────────────

interface BlockProps {
  doc: IssueDoc;
  node: IssueNode;
  item: Item;
  itemId: string;
  lens: Lens;
  readOnly: boolean;
  act: PageActions;
  onSelect: (anchor: string) => void;
}

function Block(props: BlockProps) {
  return props.lens === 'source' ? <SourceBlock {...props} /> : <ChannelBlock {...props} />;
}

/** The Website/Email/Audio rendering — what a reader sees. */
function ChannelBlock({ doc, node, item, itemId, readOnly, act }: BlockProps) {
  const set = (patch: Record<string, unknown>) => act.updateItem(itemId, patch);
  const thingy = item.authorship === 'Thingy';

  const body = (
    <Editable
      tag="p" multiline readOnly={readOnly}
      value={item.body ?? ''}
      ph="Write something here…"
      onCommit={(text) => set({ body: text })}
    />
  );

  switch (item.type) {
    case 'currently':
      return (
        <p>
          <strong>
            <Editable
              readOnly={readOnly} value={item.label ?? ''} ph="Label"
              onCommit={(text) => set({ label: text })}
            />
            :
          </strong>{' '}
          <Editable
            readOnly={readOnly} value={item.body ?? ''} ph="…"
            onCommit={(text) => set({ body: text })}
          />
        </p>
      );

    case 'photo':
      return (
        <Photo
          item={item} itemId={itemId} issueId={doc.issue.id}
          readOnly={readOnly} set={set} act={act}
        />
      );

    case 'quote':
      return (
        <blockquote>
          <Editable
            tag="p" multiline readOnly={readOnly} value={item.body ?? ''}
            ph="The quote…" onCommit={(text) => set({ body: text })}
          />
          <Editable
            class="attribution" readOnly={readOnly} value={item.attribution ?? ''}
            ph="Who said it" onCommit={(text) => set({ attribution: text })}
          />
        </blockquote>
      );

    case 'haiku':
      return (
        <Editable
          class="haiku" tag="div" multiline readOnly={readOnly}
          value={item.body ?? ''} ph="Five, seven, five…"
          onCommit={(text) => set({ body: text })}
        />
      );

    case 'pinboard_link':
      return node.type === 'briefly'
        ? (
          <p>
            <RichEditable
              readOnly={readOnly} value={item.commentary ?? ''}
              ph="A line about it" render={markdownInlineToSafeHtml}
              onCommit={(text) => set({ commentary: text })}
            />
            {' '}
            <a href={item.source_url} target="_blank" rel="noreferrer" class="brief-title">
              {item.title}
            </a>
            <span class="arrow"> →</span>
          </p>
        )
        : (
          <>
            <div class="link-title">
              <a href={item.source_url} target="_blank" rel="noreferrer">{item.title}</a>
              <span class="link-domain">{domainOf(item.source_url)}</span>
            </div>
            <Editable
              tag="p" multiline readOnly={readOnly} value={item.commentary ?? ''}
              ph="Why this is worth reading…" onCommit={(text) => set({ commentary: text })}
            />
          </>
        );

    case 'journal_post': {
      const c = wallClock(item.published_at);
      // The post's own images are shown as images; Jamie edits the words.
      const split = splitBody(item.body);
      return (
        <>
          <p>
            {c && (
              <>
                <a href={item.source_url} target="_blank" rel="noreferrer">{clockTime(c)}</a>
                <span class="emdash"> — </span>
              </>
            )}
            <RichEditable
              readOnly={readOnly} value={split.prose} ph="…"
              render={markdownInlineToSafeHtml}
              onCommit={(text) => set({ body: rejoinBody(text, split.tail) })}
            />
          </p>
          {split.images.map((img) => (
            <img key={img.src} class="post-image" src={img.src} alt={img.alt} loading="lazy" />
          ))}
        </>
      );
    }

    case 'echoes':
      return (
        <>
          {thingy && <ByChip />}
          <div
            class="echoes-refs"
            dangerouslySetInnerHTML={{ __html: markdownInlineToSafeHtml(item.body ?? '') }}
          />
        </>
      );

    case 'markdown':
      return (
        <>
          <div class="md-label">MARKDOWN BLOCK</div>
          <Editable
            class="md-body" tag="div" multiline readOnly={readOnly}
            value={item.body ?? ''} ph="Markdown…"
            onCommit={(text) => set({ body: text })}
          />
        </>
      );

    default:
      return (
        <>
          {thingy && <ByChip />}
          {item.title && node.kind === 'promoted_item' && (
            <div class="link-title">{item.title}</div>
          )}
          {body}
        </>
      );
  }
}

/**
 * Candidates from the wand. Nothing is written until one is chosen, and
 * dismissing leaves the item exactly as it was.
 */
function DraftPicker({
  candidates, onPick, onDismiss,
}: { candidates: string[]; onPick: (text: string) => void; onDismiss: () => void }) {
  return (
    <div class="draft-picker">
      <div class="dp-head">
        <span class="mono-label">DRAFTED — PICK ONE</span>
        <button class="dp-x" aria-label="Dismiss" onClick={onDismiss}>×</button>
      </div>
      {candidates.length === 0 && <p class="quiet">Nothing came back.</p>}
      {candidates.map((text, i) => (
        <button key={i} class="dp-option" onClick={() => onPick(text)}>{text}</button>
      ))}
      <p class="dp-foot">Nothing is written until you pick one.</p>
    </div>
  );
}

const ByChip = () => (
  <div class="byline-chip"><span class="dot" />By Thingy</div>
);

function domainOf(url: string | undefined): string {
  if (!url) return '';
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

// ── photo ─────────────────────────────────────────────────────────────────

/**
 * Empty is a `<label>` wrapping a hidden file input, so the whole 300px zone is
 * the control — a div with a click handler is not reachable from the keyboard.
 */
function Photo({
  item, itemId, issueId, readOnly, set, act,
}: {
  item: Item;
  itemId: string;
  issueId: string;
  readOnly: boolean;
  set: (p: Record<string, unknown>) => void;
  act: PageActions;
}) {
  const media = item.media ?? {};
  const [uploading, setUploading] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  /**
   * The server reads the EXIF, not the browser: the file's modified time is
   * when it was copied, not when it was taken.
   */
  const take = (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setFailed(null);
    act.uploadPhoto(itemId, file)
      .catch((err: Error) => setFailed(err.message))
      .finally(() => setUploading(false));
  };

  if (uploading) {
    return (
      <div class="photo-drop busy">
        <Spinner size={20} />
        <span>Resizing and uploading…</span>
      </div>
    );
  }

  if (!media.url) {
    return (
      <label class="photo-drop">
        <input
          type="file" accept="image/*" hidden disabled={readOnly}
          onChange={(e) => take((e.currentTarget as HTMLInputElement).files?.[0])}
        />
        <ImagePlus />
        <span>Drop a photo here, or click to choose</span>
        <span class="hint">Time and place are read from the file. Both stay editable.</span>
        {failed && <span class="hint error-text">{failed}</span>}
      </label>
    );
  }

  const c = wallClock(media.timestamp);
  const meta = [
    c ? `${longDate(c).replace(/^\w+, /, '')}, ${c.y}` : '',
    c ? clockTime(c) : '',
    media.location,
  ].filter(Boolean).join(' · ');

  return (
    <div class="photo-set">
      <img src={media.url} alt={media.alt ?? ''} />
      {!readOnly && (
        <div class="photo-actions">
          <label class="btn small">
            Replace
            <input type="file" accept="image/*" hidden
              onChange={(e) => take((e.currentTarget as HTMLInputElement).files?.[0])} />
          </label>
          <button class="btn small" title="Remove" onClick={() => set({ media: { ...media, url: '' } })}>
            <Trash />
          </button>
        </div>
      )}
      <Editable
        class="photo-caption" tag="div" multiline readOnly={readOnly}
        value={media.caption ?? ''} ph="Caption…"
        onCommit={(caption) => set({ media: { ...media, caption } })}
      />
      {meta && <div class="photo-meta">{meta}</div>}
    </div>
  );
}

// ── held out ──────────────────────────────────────────────────────────────

function HeldStrip({
  item, lens, onPutBack,
}: { item: Item; lens: Channel; onPutBack: () => void }) {
  const on = CHANNELS.filter((c) => item.channels[c]);
  const label = on.length === 0
    ? { text: 'NOT IN THIS ISSUE', cls: 'none' }
    : { text: `${on.map((c) => c.toUpperCase()).join(' + ')} ONLY`, cls: 'email' };

  const text = item.title || item.commentary || item.body || item.media?.caption || '';

  return (
    <div class="held-strip">
      <span class={`chan ${label.cls}`}>{label.text}</span>
      <span class="text">{text}</span>
      <button class="btn small" onClick={onPutBack}>
        {on.length === 0 ? 'Put back' : 'Add here too'}
      </button>
    </div>
  );
}

// ── the Source lens ───────────────────────────────────────────────────────

/**
 * Prose plus one quiet line — never a labelled field grid. The grid version was
 * truthful and unreadable.
 */
function SourceBlock({ doc, node, item, itemId, readOnly, act }: BlockProps) {
  const set = (patch: Record<string, unknown>) => act.updateItem(itemId, patch);
  const w = windowOf(doc);

  const primary = item.title ?? item.media?.alt;
  const body = item.commentary ?? item.body ?? item.media?.caption ?? '';

  const chips = !CHANNELS.every((c) => item.channels[c]) || item.channel_locks;
  const state = outOfWindow(item, w) ? 'OUTSIDE WINDOW'
    : heldOut(item) ? 'HELD OUT'
    : node.kind === 'promoted_item' ? 'PROMOTED'
    : item.authorship === 'Thingy' && !item.reviewed ? 'NEEDS REVIEW'
    : null;

  const meta = [
    node.label,
    item.tags?.length ? item.tags.join(' ') : '',
    item.published_at ? wallClock(item.published_at)?.key : '',
    item.presentation,
    item.media?.location,
    item.authorship === 'Thingy' ? (item.reviewed ? 'reviewed' : 'draft') : '',
    editionOnly(item) ? 'edition only' : '',
  ].filter(Boolean);

  const imported = item.source_snapshot?.[item.type === 'pinboard_link' ? 'commentary' : 'body'];
  const diverged = typeof imported === 'string' && imported.trim() && imported !== body;

  return (
    <div class="src-item">
      <div class="src-head">
        <span class="src-type">{item.type.replace(/_/g, ' ').toUpperCase()}</span>
        <span class={`src-dot ${authorClass(item)}`} />
        <span class="src-author">{item.source}</span>
        <span class="src-spacer" />
        {state && <span class="src-state">{state}</span>}
        {chips && CHANNELS.map((c) => (
          <span
            key={c}
            class={`src-chip${item.channels[c] ? ' on' : ''}${item.channel_locks?.[c] ? ' locked' : ''}`}
            title={item.channel_locks?.[c] ?? `${c}: ${item.channels[c] ? 'on' : 'off'}`}
          >
            {c[0]!.toUpperCase()}
          </span>
        ))}
      </div>

      {primary !== undefined && (
        <Editable
          class="src-primary" readOnly={readOnly} value={primary ?? ''} ph="Untitled"
          onCommit={(title) => set(item.type === 'photo'
            ? { media: { ...(item.media ?? {}), alt: title } }
            : { title })}
        />
      )}

      <Editable
        class="src-body" tag="div" multiline readOnly={readOnly} value={body} ph="No text"
        onCommit={(text) => set(
          item.type === 'pinboard_link' ? { commentary: text }
            : item.type === 'photo' ? { media: { ...(item.media ?? {}), caption: text } }
            : { body: text },
        )}
      />

      <div class="src-meta">
        {meta.join(' · ')}
        {item.source_url && (
          <>
            {meta.length ? ' · ' : ''}
            <a href={item.source_url} target="_blank" rel="noreferrer">{domainOf(item.source_url)}</a>
          </>
        )}
      </div>

      {diverged && <div class="src-meta">as imported: “{String(imported).slice(0, 120)}”</div>}
    </div>
  );
}

function authorClass(item: Item): string {
  if (item.authorship === 'Thingy') return 'thingy';
  if (item.authorship === 'syndicated') return 'syndicated';
  return 'jamie';
}

export { Plus };
