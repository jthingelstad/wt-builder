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

import type { ArchiveReference, Channel, EchoOption, IssueDoc, IssueNode, Item } from '../../shared/types.ts';
import { CHANNELS, DRAFTABLE } from '../../shared/types.ts';
import { clockTime, kickerDate, longDate, wallClock, weekday } from '../../shared/dates.ts';
import {
  editionOnly, falloutOf, heldOut, itemsInWindow, orderedNodes, outOfWindow, postBlocks, windowOf,
} from '../../shared/render/plan.ts';
import { audioScript } from '../../shared/render/audio.ts';
import type { ScriptBlock } from '../../shared/render/audio.ts';
import { MEMBER_THANKS, PREMIUM_CONDITION } from '../../shared/render/email.ts';
import { imagesWithoutAlt, rejoinBody, splitBody, withImageAlts } from '../../shared/body.ts';
import { markdownInlineToSafeHtml, markdownToSafeHtml } from '../../shared/markdown.ts';
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
  /** The echoes Jamie ticked, appended to the section — each becomes an item. */
  addEchoes(nodeId: string, echoes: EchoOption[]): void;
  promote(itemId: string): void;
  demote(nodeId: string): void;
  moveToSection(itemId: string, target: 'Notable' | 'Briefly'): void;
  setChannel(itemId: string, channel: Channel, on: boolean): void;
  draft(itemId: string): void;
  /** The Echoes section wand: echoes to append, shown in a picker on the heading. */
  draftEchoes(nodeId: string): void;
  /** Ask for a better order for a link section; the answer shows in a picker. */
  suggestOrder(nodeId: string): void;
  applyOrder(nodeId: string, order: string[], why: string): void;
  uploadPhoto(itemId: string, file: File): Promise<unknown>;
}

export interface OrderProposal {
  nodeId: string;
  order: string[];
  current: string[];
  why: string;
  notes: { id: string; note: string }[];
}

interface PageProps {
  doc: IssueDoc;
  lens: Lens;
  selected: string | null;
  onSelect: (anchor: string | null) => void;
  act: PageActions;
  drafting: string | null;
  draft: { itemId: string; candidates: string[]; echoes?: EchoOption[]; membership?: { cta: string; thanks: string }[]; photo?: { alt: string; caption: string }[]; alts?: { src: string; alt: string }[] } | null;
  onPickDraft: (itemId: string, text: string, refs?: ArchiveReference[], extraPatch?: Record<string, unknown>) => void;
  onDismissDraft: () => void;
  /** The section whose order is being proposed, and the proposal. */
  ordering?: string | null;
  orderProposal?: OrderProposal | null;
  onDismissOrder?: () => void;
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
  return itemsInWindow(doc).reduce(
    (n, [, i]) => n + words(i.body) + words(i.commentary) + words(i.title) + words(i.media?.caption),
    0,
  );
}

export function Page({
  doc, lens, selected, onSelect, act, drafting, draft, onPickDraft, onDismissDraft,
  ordering, orderProposal, onDismissOrder,
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
  const linkCount = itemsInWindow(doc).filter(([, i]) => i.type === 'pinboard_link').length;
  const wordCount = issueWords(doc);
  const stats = lens === 'source'
    ? `${nodes.length} nodes · ${Object.keys(doc.items).length} items · ${wordCount} words`
    : `${wordCount.toLocaleString()} words · ${linkCount} links · ~${Math.max(1, Math.round(wordCount / 220))} min read`;

  rows.push(
    <Row
      key="head"
      anchor="issue"
      selected={selected === 'issue'}
      margin={
        <>
          <Wand
            redraft={Boolean(doc.issue.dek)}
            busy={drafting === 'issue'}
            onClick={() => act.draft('issue')}
          />
          {/* The head wand's candidates never had a picker — the call
              returned and nothing displayed (Jamie, 2026-09-04). Each
              candidate is two lines: the theme, then the dek. */}
          {draft?.itemId === 'issue' && (
            <DraftPicker
              candidates={draft.candidates}
              onPick={(text) => onPickDraft('issue', text)}
              onDismiss={onDismissDraft}
            />
          )}
        </>
      }
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
    // that disappears silently reads as data loss. And a section that is
    // written into — Currently, Notable, Briefly — keeps its heading and its
    // add chip while it is empty; otherwise a Currently put back after removal
    // has no way to get its first line (WT350, 2026-09-20).
    const writable = !readOnly && lens === 'website' &&
      (node.type === 'currently' || node.type === 'notable' || node.type === 'briefly' || node.type === 'echoes');
    if (!inLens.length && !fallout.all && lens !== 'source' && !writable) return;

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
      // Notable and Briefly carry an ordering wand: the model proposes a
      // sequence that reads better than bookmark order, and nothing moves
      // until Jamie applies it (Jamie, 2026-09-20).
      const orderable = !readOnly && lens === 'website' && (node.type === 'notable' || node.type === 'briefly') &&
        inLens.filter((id) => doc.items[id]?.type === 'pinboard_link').length >= 3;
      // The Echoes wand lives on the heading: it drafts echoes for the
      // section and the ticked ones append as items, so it can run again
      // for more (Jamie, 2026-09-20). Each echo's own wand redrafts it.
      const echoesWand = !readOnly && node.type === 'echoes';
      rows.push(
        <Row
          key={`${node.id}-h`}
          anchor={node.id}
          selected={selected === node.id}
          rail={<Rail {...rail} />}
          margin={orderable ? (
            <>
              <Wand redraft={false} busy={ordering === node.id} onClick={() => act.suggestOrder(node.id)} />
              {orderProposal?.nodeId === node.id && (
                <OrderPicker
                  doc={doc}
                  proposal={orderProposal}
                  onApply={() => { act.applyOrder(node.id, orderProposal.order, orderProposal.why); onDismissOrder?.(); }}
                  onDismiss={() => onDismissOrder?.()}
                />
              )}
            </>
          ) : echoesWand ? (
            <>
              <Wand redraft={inLens.length > 0} busy={drafting === node.id} onClick={() => act.draftEchoes(node.id)} />
              {draft?.itemId === node.id && draft.echoes && (
                <EchoesPicker
                  echoes={draft.echoes}
                  more={node.items.length > 0}
                  onCompose={(selected) => { act.addEchoes(node.id, selected); onDismissDraft(); }}
                  onDismiss={onDismissDraft}
                />
              )}
            </>
          ) : undefined}
        >
          <h2 class={fallout.all ? 'faded' : undefined} onClick={() => onSelect(node.id)}>
            <span class="hash">#</span>
            <Editable
              readOnly={readOnly || node.kind === 'section'}
              value={node.label}
              onCommit={() => { /* renamed from the outline */ }}
            />
            {node.kind === 'ad_hoc' && <span class="note-pill">AD HOC SECTION</span>}
            {node.fixed_position === 'last' && <span class="note-pill">FIXED LAST</span>}
            {fallout.all && (
              <span class="note-pill">ALL {fallout.count} FELL OUTSIDE THE WINDOW</span>
            )}
          </h2>
        </Row>,
      );
    } else if (node.type === 'membership' && inLens.length > 0) {
      // Membership publishes no heading, but on the canvas the block needs a
      // name so it does not read as a stray paragraph (Jamie, 2026-09-20).
      rows.push(
        <Row key={`${node.id}-h`} anchor={node.id} selected={selected === node.id} rail={<Rail {...rail} />}>
          <div class="subtle-head" onClick={() => onSelect(node.id)}>Supporting Members</div>
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
      // _brief tag, so the gesture is an edit at Pinboard too.
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
        // A singleton IS its section, and heading-less sections have no
        // section rail in the reading lenses — so its Up/Down move the
        // node. Moving the item within its one-item node was a silent
        // no-op (Jamie's haiku-above-outro report, 2026-09-04).
        onUp: () => (singleton ? act.moveNode(node.id, -1) : act.moveItem(node.id, itemId, -1)),
        onDown: () => (singleton ? act.moveNode(node.id, 1) : act.moveItem(node.id, itemId, 1)),
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
              {DRAFTABLE.has(item.type) && (
                <Wand
                  redraft={hasText}
                  busy={drafting === itemId}
                  onClick={() => act.draft(itemId)}
                />
              )}
              {draft?.itemId === itemId && (draft.photo ? (
                <PhotoPicker
                  candidates={draft.photo}
                  onPick={(pair) => onPickDraft(itemId, item.body ?? '', undefined, {
                    media: { ...(item.media ?? {}), alt: pair.alt, caption: pair.caption },
                  })}
                  onDismiss={onDismissDraft}
                />
              ) : draft.membership ? (
                <MembershipPicker
                  candidates={draft.membership}
                  onPick={(pair) => onPickDraft(itemId, pair.cta, undefined, { member_thanks: pair.thanks })}
                  onDismiss={onDismissDraft}
                />
              ) : draft.alts ? (
                <AltPicker
                  alts={draft.alts}
                  onUse={(alts) => onPickDraft(itemId, withImageAlts(item.body, Object.fromEntries(alts.map((a) => [a.src, a.alt]))))}
                  onDismiss={onDismissDraft}
                />
              ) : draft.echoes ? (
                <EchoesPicker
                  echoes={draft.echoes}
                  single
                  onPick={(echo) => onPickDraft(itemId, echo.text, echo.archive_references, { ask: echo.ask ?? '' })}
                  onDismiss={onDismissDraft}
                />
              ) : (
                <DraftPicker
                  candidates={draft.candidates}
                  onPick={(text) => onPickDraft(itemId, text)}
                  onDismiss={onDismissDraft}
                />
              ))}
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
        const membershipId = inLens.find((id) => doc.items[id]?.body?.trim());
        const membershipItem = membershipId ? doc.items[membershipId] : undefined;
        rows.push(
          <Row key={`${node.id}-liquid`} anchor={node.id}>
            <div class="liquid">
              <code>{`{% if ${PREMIUM_CONDITION} %}`}</code>
              <div class="indent liquid-editable">
                <Editable
                  tag="span" multiline readOnly={readOnly}
                  value={membershipItem?.member_thanks ?? ''}
                  ph={`(no drafted thanks — falls back to the invitation + “${MEMBER_THANKS}”)`}
                  onCommit={(text) => membershipId && act.updateItem(membershipId, { member_thanks: text })}
                />
              </div>
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
      // Echoes are drafted, not typed: the section's add is the wand on its
      // heading. The empty section says so rather than showing a bare rule.
      if (node.type === 'echoes' && inLens.length === 0) {
        rows.push(
          <Row key={`${node.id}-add`} anchor={node.id}>
            <button class="ghost-chip" disabled={drafting === node.id} onClick={() => act.draftEchoes(node.id)}>
              {drafting === node.id ? 'Reading the archive…' : '✦ Draft echoes from the archive'}
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

  // The builder's own lines — the opening, the section openers and closers,
  // Thingy's hello, the close — are spoken like everything else, so they
  // read as script, numbered with the rest. They are set in amber, the
  // colour this lens already uses for its audio-only devices, so it is
  // clear they are generated rather than Jamie's words; drawn as rules
  // they looked like headings that would not be read (Jamie, 2026-09-22).
  const isGenerated = (b: ScriptBlock) => b.kind !== 'cue';
  const firstGenerated = script.findIndex(isGenerated);

  return (
    <>
      {script.map((block, i) => {
        const anchor = block.itemId ?? block.nodeId ?? 'issue';

        cue += 1;
        const n = cue;
        const classes = ['cue'];
        if (isGenerated(block)) classes.push('cue-generated');
        if (block.speaker === 'thingy') classes.push('cue-thingy');
        // A section boundary is the longest pause; the gap shows it.
        if (block.pauseBefore === 'section') classes.push('cue-after-pause');

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
            <div class={classes.join(' ')} onClick={() => onSelect(anchor)}>
              <span class="cue-num">{String(n).padStart(2, '0')}</span>
              <span class="cue-text">
                {block.speaker === 'thingy' && <span class="cue-speaker">THINGY</span>}
                {text}
                {i === firstGenerated && (
                  <span class="cue-reverse-note">
                    GENERATED — the builder's own spoken lines are set in this colour; every other line is the issue's text.
                  </span>
                )}
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
              {node.type === 'photo'
                ? 'The photo has no caption to speak; the picture is never described.'
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

  // Prose (intro, outro, Markdown blocks): rendered paragraphs at rest,
  // Markdown source while editing, with the blank lines visible. A plain <p>
  // here swallowed the second paragraph — newlines vanished on save
  // (2026-09-20) — and showed raw link syntax at rest.
  const body = (
    <RichEditable
      tag="div" class="post-body" multiline readOnly={readOnly}
      value={item.body ?? ''}
      ph="Write something here…"
      render={markdownToSafeHtml}
      onCommit={(text) => set({ body: text })}
    />
  );

  switch (item.type) {
    case 'currently':
      // Two inline editables on one line. An empty body is a zero-width span,
      // so a click "in the body" landed on the line and the browser put the
      // caret in the nearest editable — the label — and typing overwrote it
      // (2026-09-20). The empty body gets a real width (canvas.css .cur-body)
      // and a click on the line itself focuses the body.
      return (
        <p
          class="cur-line"
          onClick={(e) => {
            if (readOnly || e.target !== e.currentTarget) return;
            (e.currentTarget as HTMLElement).querySelector<HTMLElement>('.cur-body')?.focus();
          }}
        >
          <strong>
            <Editable
              readOnly={readOnly} value={item.label ?? ''} ph="Label"
              onCommit={(text) => set({ label: text })}
            />
            :
          </strong>{' '}
          <RichEditable
            class="cur-body"
            readOnly={readOnly} value={item.body ?? ''} ph="What's happening…"
            render={markdownInlineToSafeHtml}
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
      // A Briefly line with more than one paragraph edits as a block, for the
      // same reason a structured Journal post does.
      return node.type === 'briefly' && postBlocks(item.commentary).length <= 1
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
            {/* Rendered at rest like everything else; it showed raw Markdown (2026-09-20). */}
            <RichEditable
              tag="div" class="post-body" multiline readOnly={readOnly} value={item.commentary ?? ''}
              ph="Why this is worth reading…" render={markdownToSafeHtml}
              onCommit={(text) => set({ commentary: text })}
            />
          </>
        );

    case 'journal_post': {
      const c = wallClock(item.published_at);
      // The post's own images are shown as images; Jamie edits the words.
      const split = splitBody(item.body);
      // Promoted, the post is a section of its own: its title is the heading,
      // its paragraphs, headings, lists, and quotes print as written, and the
      // clock stays behind with the Journal moment it used to be.
      if (node.kind === 'promoted_item' || item.presentation === 'promoted') {
        return (
          <>
            <RichEditable
              tag="div" multiline class="post-body" readOnly={readOnly}
              value={split.prose} ph="…"
              render={markdownToSafeHtml}
              onCommit={(text) => set({ body: rejoinBody(text, split.tail) })}
            />
            {split.images.map((img) => (
              <img key={img.src} class="post-image" src={img.src} alt={img.alt} loading="lazy" />
            ))}
          </>
        );
      }
      // The lead is the title when the post has one (bold), the time of day otherwise.
      const title = String(item.title ?? '').trim();
      const lead = title || (c ? clockTime(c) : '');
      const leadLink = lead && (
        <>
          {title
            ? <strong><a href={item.source_url} target="_blank" rel="noreferrer">{title}</a></strong>
            : <a href={item.source_url} target="_blank" rel="noreferrer">{lead}</a>}
          <span class="emdash"> — </span>
        </>
      );
      // A moment is one line and edits as one. A post with more structure —
      // a list, several paragraphs — edits as a block: in a single-line span
      // its line breaks are invisible, Enter blurs, and the inline view had
      // welded WT351's bullets onto one line (2026-09-21).
      if (postBlocks(split.prose).length > 1) {
        return (
          <>
            {leadLink && <p>{leadLink}</p>}
            <RichEditable
              tag="div" multiline class="post-body" readOnly={readOnly}
              value={split.prose} ph="…"
              render={markdownToSafeHtml}
              onCommit={(text) => set({ body: rejoinBody(text, split.tail) })}
            />
            {split.images.map((img) => (
              <img key={img.src} class="post-image" src={img.src} alt={img.alt} loading="lazy" />
            ))}
          </>
        );
      }
      return (
        <>
          <p>
            {leadLink}
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

    case 'echo':
      // One echo: the thread, then its door — both Jamie's to edit. The
      // door prints as "Ask Thingy: question" linked to Thingy's chat; the
      // renderers build the link, so only the question is edited here.
      return (
        <div class="echo">
          {thingy && node.items[0] === itemId && <ByChip />}
          <RichEditable
            tag="div" class="echo-thread" multiline readOnly={readOnly}
            value={item.body ?? ''} ph="The thread from this issue back through the archive…"
            render={markdownInlineToSafeHtml}
            onCommit={(text) => set({ body: text })}
          />
          <p class="echo-ask">
            <em>Ask Thingy:</em>{' '}
            <Editable
              class="echo-question" readOnly={readOnly} value={item.ask ?? ''}
              ph="A question a curious reader could ask (or leave empty for no door)"
              onCommit={(text) => set({ ask: text })}
            />
          </p>
        </div>
      );

    case 'echoes':
      // Generated, but Jamie's to edit (2026-09-04): rendered at rest,
      // markdown source while editing — and a body change drops the item
      // back to draft for the Thingy review gate (issue.ts updateItem).
      return (
        <>
          {thingy && <ByChip />}
          <RichEditable
            tag="div" multiline class="echoes-refs" readOnly={readOnly}
            value={item.body ?? ''} ph="Echoes from the archive…"
            render={renderEchoesHtml}
            onCommit={(text) => set({ body: text })}
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

/**
 * A proposed order beside the current one. Titles only — the point is the
 * sequence. Apply moves the items; dismiss leaves everything where it is.
 */
function OrderPicker({
  doc, proposal, onApply, onDismiss,
}: { doc: IssueDoc; proposal: OrderProposal; onApply: () => void; onDismiss: () => void }) {
  const name = (id: string) => {
    const t = String(doc.items[id]?.title ?? '').trim() || '(untitled)';
    return t.length > 46 ? `${t.slice(0, 45).trimEnd()}…` : t;
  };
  const note = (id: string) => proposal.notes.find((n) => n.id === id)?.note;
  const unchanged = proposal.order.every((id, i) => proposal.current[i] === id);
  return (
    <div class="draft-picker order-picker">
      <div class="dp-head">
        <span class="mono-label">PROPOSED ORDER</span>
        <button class="dp-x" aria-label="Dismiss" onClick={onDismiss}>×</button>
      </div>
      {proposal.why && <p class="op-why">{proposal.why}</p>}
      <ol class="op-list">
        {proposal.order.map((id, i) => {
          const was = proposal.current.indexOf(id);
          const moved = was !== i;
          return (
            <li key={id} class={moved ? 'moved' : ''}>
              <span class="op-num">{i + 1}</span>
              <span class="op-title">{name(id)}</span>
              {moved && <span class="op-was">was {was + 1}</span>}
              {note(id) && <span class="op-note">{note(id)}</span>}
            </li>
          );
        })}
      </ol>
      {unchanged
        ? <p class="dp-foot">Same as it is now.</p>
        : (
          <div class="op-actions">
            <button class="btn small primary" onClick={onApply}>Apply this order</button>
            <button class="btn small" onClick={onDismiss}>Keep as is</button>
          </div>
        )}
      <p class="dp-foot">Nothing moves until you apply it.</p>
    </div>
  );
}

/**
 * The Echoes wand offers units, not candidates: select any subset and the
 * section composes from it — length follows quality. Wider than the notes
 * track on purpose; five echoes cannot breathe in 250px, so the picker
 * overlays the card like a popover.
 */
function EchoesPicker({
  echoes, onCompose, onPick, onDismiss, single, more,
}: {
  echoes: EchoOption[];
  /** Section wand: the ticked echoes, appended in this order. */
  onCompose?: (selected: EchoOption[]) => void;
  /** Per-echo wand: one way of saying it replaces the echo's words. */
  onPick?: (echo: EchoOption) => void;
  onDismiss: () => void;
  /** Pick one, not any — the per-echo redraft. */
  single?: boolean;
  /** The section already holds echoes; these add to it. */
  more?: boolean;
}) {
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const toggle = (i: number) => {
    const next = new Set(picked);
    if (next.has(i)) next.delete(i); else next.add(i);
    setPicked(next);
  };
  const selected = echoes.filter((_, i) => picked.has(i));

  return (
    <div class="draft-picker echoes-picker">
      <div class="dp-head">
        <span class="mono-label">{single ? 'REDRAFTED — PICK ONE' : more ? 'MORE ECHOES — ADD ANY' : 'ECHOES — ADD ANY'}</span>
        <button class="dp-x" aria-label="Dismiss" onClick={onDismiss}>×</button>
      </div>
      {echoes.length === 0 && <p class="quiet">Nothing came back.</p>}
      {echoes.map((echo, i) => (
        <button
          key={i}
          class={`dp-option${picked.has(i) ? ' picked' : ''}`}
          aria-pressed={single ? undefined : picked.has(i)}
          onClick={() => (single ? onPick?.(echo) : toggle(i))}
        >
          {!single && <span class="dp-check">{picked.has(i) ? '✓' : ''}</span>}
          <span class="dp-text">
            {echo.text}
            {echo.ask && <span class="dp-ask">Ask Thingy: {echo.ask}</span>}
          </span>
        </button>
      ))}
      {single ? (
        <p class="dp-foot">Same thread, said again. Nothing is written until you pick one.</p>
      ) : (
        <div class="dp-compose">
          <button
            class="btn small primary"
            disabled={selected.length === 0}
            onClick={() => onCompose?.(selected)}
          >
            Add {selected.length || 'none'} {selected.length === 1 ? 'echo' : 'echoes'}
          </button>
          <span class="dp-foot">
            {more ? 'Each one joins the section as its own echo, after what is there.' : 'Each one becomes its own echo, in this order. Run the wand again for more.'}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Membership candidates are pairs - the invitation and the member
 * thank-you drafted together so the two email branches always agree.
 * One pick fills both (body + member_thanks).
 */
/** The photo wand's pairs: alt for the reader who cannot see it, caption for the one who can. */
function PhotoPicker({
  candidates, onPick, onDismiss,
}: {
  candidates: { alt: string; caption: string }[];
  onPick: (pair: { alt: string; caption: string }) => void;
  onDismiss: () => void;
}) {
  return (
    <div class="draft-picker membership-picker">
      <div class="dp-head">
        <span class="mono-label">FROM THE PHOTO — PICK A PAIR</span>
        <button class="dp-x" aria-label="Dismiss" onClick={onDismiss}>×</button>
      </div>
      {candidates.length === 0 && <p class="quiet">Nothing came back.</p>}
      {candidates.map((pair, i) => (
        <button key={i} class="dp-option" onClick={() => onPick(pair)}>
          <span class="dp-pair-label">ALT</span>
          {pair.alt}
          <span class="dp-pair-label">CAPTION</span>
          {pair.caption}
        </button>
      ))}
      <p class="dp-foot">One pick fills alt and caption. Both stay editable.</p>
    </div>
  );
}

/**
 * The Journal wand's alts: one per picture, written from the picture, each
 * editable before it goes in. "Use these" writes them into the post's own
 * image tags, and the body write-back carries them to the blog — so the
 * site and the email get them through the same body (2026-09-20).
 */
function AltPicker({
  alts, onUse, onDismiss,
}: {
  alts: { src: string; alt: string }[];
  onUse: (alts: { src: string; alt: string }[]) => void;
  onDismiss: () => void;
}) {
  const [edited, setEdited] = useState(alts);
  return (
    <div class="draft-picker membership-picker alt-picker">
      <div class="dp-head">
        <span class="mono-label">FROM THE PICTURES — ALT TEXT</span>
        <button class="dp-x" aria-label="Dismiss" onClick={onDismiss}>×</button>
      </div>
      {edited.length === 0 && <p class="quiet">Nothing came back.</p>}
      {edited.map((a, i) => (
        <div key={a.src} class="alt-row">
          <img src={a.src} alt="" loading="lazy" />
          <textarea
            rows={2}
            value={a.alt}
            onInput={(e) => {
              const alt = (e.currentTarget as HTMLTextAreaElement).value;
              setEdited((prev) => prev.map((x, j) => (j === i ? { ...x, alt } : x)));
            }}
          />
        </div>
      ))}
      <div class="dp-compose">
        <button class="btn small primary" disabled={!edited.some((a) => a.alt.trim())} onClick={() => onUse(edited)}>
          Use these
        </button>
        <span class="dp-foot">Written into the post and back to Micro.blog. Nothing is written until you choose.</span>
      </div>
    </div>
  );
}

function MembershipPicker({
  candidates, onPick, onDismiss,
}: {
  candidates: { cta: string; thanks: string }[];
  onPick: (pair: { cta: string; thanks: string }) => void;
  onDismiss: () => void;
}) {
  return (
    <div class="draft-picker membership-picker">
      <div class="dp-head">
        <span class="mono-label">DRAFTED — PICK A PAIR</span>
        <button class="dp-x" aria-label="Dismiss" onClick={onDismiss}>×</button>
      </div>
      {candidates.length === 0 && <p class="quiet">Nothing came back.</p>}
      {candidates.map((pair, i) => (
        <button key={i} class="dp-option" onClick={() => onPick(pair)}>
          <span class="dp-pair-label">EVERYONE</span>
          {pair.cta}
          <span class="dp-pair-label">MEMBERS SEE</span>
          {pair.thanks}
        </button>
      ))}
      <p class="dp-foot">One pick fills both email branches. Nothing is written until you choose.</p>
    </div>
  );
}

const ByChip = () => (
  <div class="byline-chip"><span class="dot" />By Thingy</div>
);

/**
 * A single-body Echoes item (WT350 and earlier) is short paragraphs of
 * inline markdown. Joined without newlines so the edit-mode
 * `white-space: pre-line` cannot double-space the rendered view.
 */
function renderEchoesHtml(source: string): string {
  return source
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${markdownInlineToSafeHtml(paragraph)}</p>`)
    .join('');
}

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
    if (!file.type.startsWith('image/')) { setFailed(`${file.name} is not an image.`); return; }
    setUploading(true);
    setFailed(null);
    act.uploadPhoto(itemId, file)
      .catch((err: Error) => setFailed(err.message))
      .finally(() => setUploading(false));
  };

  const drop = useFileDrop(readOnly ? null : take);

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
      <label class={`photo-drop${drop.over ? ' over' : ''}`} {...drop.handlers}>
        <input
          type="file" accept="image/*" hidden disabled={readOnly}
          onChange={(e) => take((e.currentTarget as HTMLInputElement).files?.[0])}
        />
        <ImagePlus />
        <span>{drop.over ? 'Drop to upload' : 'Drop a photo here, or click to choose'}</span>
        <span class="hint">Time and place are read from the file. Both stay editable.</span>
        {failed && <span class="hint error-text">{failed}</span>}
      </label>
    );
  }

  const c = wallClock(media.timestamp);
  const meta = [
    c ? `${longDate(c).replace(/^\w+, /, '')}, ${c.y}` : '',
    media.location,
  ].filter(Boolean).join(' · ');

  return (
    <div class={`photo-set${drop.over ? ' over' : ''}`} {...drop.handlers}>
      <div class="photo-frame">
        <img src={media.url} alt={media.alt ?? ''} />
        {drop.over && <div class="photo-drop-veil">Drop to replace</div>}
      </div>
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

/**
 * HTML5 drop for one zone. dragenter/dragleave fire for every child the
 * pointer crosses, so a depth count — not a boolean — says when it has left.
 * `null` accepts nothing (read-only), and the window guard in main.tsx then
 * refuses the drop instead of letting the browser open the file.
 */
function useFileDrop(onFile: ((file: File) => void) | null) {
  const [depth, setDepth] = useState(0);
  const files = (e: DragEvent) => onFile !== null && (e.dataTransfer?.types.includes('Files') ?? false);
  return {
    over: depth > 0,
    handlers: {
      onDragEnter: (e: DragEvent) => { if (!files(e)) return; e.preventDefault(); setDepth((d) => d + 1); },
      onDragLeave: (e: DragEvent) => { if (!files(e)) return; setDepth((d) => Math.max(0, d - 1)); },
      onDragOver: (e: DragEvent) => {
        if (!files(e)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer!.dropEffect = 'copy';
      },
      onDrop: (e: DragEvent) => {
        if (!files(e)) return;
        e.preventDefault();
        e.stopPropagation();
        setDepth(0);
        const file = e.dataTransfer?.files[0];
        if (file) onFile!(file);
      },
    },
  };
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

  // A Currently line's label is its title-equivalent; without it the Source
  // lens showed five bodies and no way to tell Building from Listening.
  const primary = item.title ?? item.label ?? item.media?.alt;
  const body = item.commentary ?? item.body ?? item.media?.caption ?? '';

  const chips = !CHANNELS.every((c) => item.channels[c]) || item.channel_locks;
  const state = outOfWindow(item, w) ? 'OUTSIDE WINDOW'
    : heldOut(item) ? 'HELD OUT'
    : node.kind === 'promoted_item' ? 'PROMOTED'
    : null;

  const meta = [
    node.label,
    item.tags?.length ? item.tags.join(' ') : '',
    item.published_at ? wallClock(item.published_at)?.key : '',
    item.presentation,
    item.media?.location,
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
            : item.type === 'currently' ? { label: title }
            : { title })}
        />
      )}

      {item.type === 'photo' && item.media?.url && (
        <img class="src-photo" src={item.media.url} alt={item.media.alt ?? ''} loading="lazy" />
      )}

      {/* Rendered at rest, Markdown while editing — the same as the page. Source
          is about provenance and structure, not about reading raw Markdown
          (Jamie, 2026-09-20: "too markdown"). */}
      {item.type === 'membership' && <div class="src-label">INVITATION — everyone else</div>}
      <RichEditable
        class="src-body" tag="div" multiline readOnly={readOnly} value={body} ph="No text"
        render={markdownToSafeHtml}
        onCommit={(text) => set(
          item.type === 'pinboard_link' ? { commentary: text }
            : item.type === 'photo' ? { media: { ...(item.media ?? {}), caption: text } }
            : { body: text },
        )}
      />
      {item.type === 'echo' && (
        <>
          <div class="src-label">ASK THINGY — the door under the thread</div>
          <RichEditable
            class="src-body" tag="div" readOnly={readOnly}
            value={item.ask ?? ''} ph="No question — the echo prints without a door."
            render={markdownInlineToSafeHtml}
            onCommit={(text) => set({ ask: text })}
          />
          {item.archive_references?.length ? (
            <div class="src-meta">
              grounded in{' '}
              {item.archive_references.map((r, i) => (
                <span key={r.url}>
                  {i > 0 && ', '}
                  <a href={r.url} target="_blank" rel="noreferrer" title={r.note ?? r.title ?? r.url}>
                    {r.issue ? `WT${r.issue}` : r.title ?? domainOf(r.url)}
                  </a>
                </span>
              ))}
            </div>
          ) : (
            <div class="src-meta">no citations carried</div>
          )}
        </>
      )}
      {item.type === 'membership' && (
        <>
          <div class="src-label">THANKS — what a Supporting Member sees instead (email only)</div>
          <RichEditable
            class="src-body" tag="div" multiline readOnly={readOnly}
            value={item.member_thanks ?? ''} ph="No drafted thanks — the email falls back to the invitation."
            render={markdownToSafeHtml}
            onCommit={(text) => set({ member_thanks: text })}
          />
        </>
      )}

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
