import { useEffect } from 'preact/hooks';

import type { IssueDoc, Item } from '../../shared/types.ts';
import { CHANNELS } from '../../shared/types.ts';
import { api, shouldWriteBack, writeBackMessage, type IssueResponse } from '../api.ts';
import { edited, Input, useFieldValue } from './Field.tsx';
import { isFrozen } from './Page.tsx';
import { giftLine, linkFindings, type LinkFinding } from '../../shared/link-findings.ts';
import { titleHint, unfinishedHint } from '../../shared/hints.ts';

interface Props {
  doc: IssueDoc;
  itemId: string;
  run: (fn: () => Promise<IssueResponse>) => Promise<boolean>;
  onClose: () => void;
  /** Present when the review panel yielded the rail — the way back. */
  onBackToReview?: () => void;
  onError: (m: string | null) => void;
  /**
   * Whether a write-back or a conflict choice for this item is out, and the
   * way to say one started or ended. Held by the editor, not here: the
   * Inspector is keyed by its item, and switching away and back during a
   * write remounted it with Retry enabled (Batch 5 review round 2).
   */
  writeOut: boolean;
  onWriteOut: (itemId: string, out: boolean) => void;
}

const SYNC_LABEL: Record<string, string> = {
  synced: 'Synced with {source}',
  syncing: 'Writing to {source}…',
  failed: 'Write to {source} failed — your edit is kept',
  needs_commentary: 'No commentary yet',
  local: 'Edited here, not yet written back to {source}',
  gone: 'Deleted at {source} — your copy is kept',
  conflict: 'Edited both here and at {source} — keep yours, or take theirs',
};

const VERDICT: Record<string, string> = {
  dead: 'Dead',
  moved: 'Moved',
  unchecked: 'The site would not say',
};

/** What the check found, in words: the status, and why when it says. */
function findingLine(f: LinkFinding): string {
  const r = f.result!;
  const status = r.status ? ` (${r.status})` : '';
  if (r.verdict === 'dead') return `${VERDICT.dead}${status}${r.note ? ` — ${r.note}` : ''}`;
  if (r.verdict === 'moved') {
    const why = r.note === 'shortened' ? 'a shortened link' : r.canonical_hint ? "the page names another as its own" : 'it redirects, or carries tracking';
    return `${VERDICT.moved} — ${why}`;
  }
  return `${VERDICT.unchecked}${status}${r.note ? ` — ${r.note}` : ''}`;
}

function syncLine(state: string, source: string): string {
  const label = SYNC_LABEL[state] ?? state;
  return label.includes('{source}') ? label.replace('{source}', source) : label;
}

/**
 * A textarea that is as tall as its text. The fixed 84px box showed four
 * lines of a twelve-paragraph post, which made the inspector useless for the
 * one thing "Show me" brought you there to do (Jamie, 2026-09-20).
 */
function GrowingTextarea(props: { id: string; value: string; disabled?: boolean; onCommit: (text: string) => unknown }) {
  // Uncontrolled while focused: a save landing mid-sentence re-renders this.
  const { ref, settle } = useFieldValue<HTMLTextAreaElement>(props.value);
  const fit = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight + 2, window.innerHeight * 0.6)}px`;
  };
  useEffect(fit, [props.value]);
  return (
    <textarea
      ref={ref}
      id={props.id}
      class="growing"
      defaultValue={props.value}
      readOnly={props.disabled}
      onInput={fit}
      onBlur={(e) => settle(props.onCommit(e.currentTarget.value))}
    />
  );
}

/** Provenance, fields, channels, and source synchronization for one item. */
export function Inspector({ doc, itemId, run, onClose, onError, onBackToReview, writeOut, onWriteOut }: Props) {
  const item = doc.items[itemId];
  if (!item) return null;
  // Out from here, or from anywhere: an edit's own write-back leaves the
  // item `syncing` until it answers.
  const writing = writeOut || item.sync_state === 'syncing';
  // Put to bed (or a pre-Builder record): every field is read-only and no
  // button changes anything. The server's 423 is the backstop, not the message.
  const frozen = isFrozen(doc);

  const id = doc.issue.id;
  const prefix = `item-${itemId}`;
  const node = doc.nodes.find((n) => n.items.includes(itemId));
  const promoted = node?.kind === 'promoted_item';
  const imported = item.source === 'Pinboard' || item.source === 'Micro.blog';

  const report = (result: Parameters<typeof writeBackMessage>[1]) => {
    const message = writeBackMessage(item.source, result);
    if (message !== undefined) onError(message);
  };

  const writeBack = async () => {
    onWriteOut(itemId, true);
    try {
      const res = await api.writeBack(id, itemId);
      await run(async () => res);
      report(res.result);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      onWriteOut(itemId, false);
    }
  };

  const resolve = async (keep: 'mine' | 'theirs') => {
    onWriteOut(itemId, true);
    try {
      const res = await api.resolveConflict(id, itemId, keep);
      await run(async () => res);
      const saved = res.issue.items[itemId];
      report(res.result ?? (saved && { sync_state: saved.sync_state, error: saved.sync_error }));
    } catch (err) {
      onError((err as Error).message);
    } finally {
      onWriteOut(itemId, false);
    }
  };

  // This item's link findings that are not fine and not kept: its own link
  // and any link in its words (plan 2026-10-01 §3).
  const kept = new Set(doc.link_check?.accepted ?? []);
  // A gift link is a finding whatever the check said: the page answers 200
  // to the checker and to readers alike until the gift runs out.
  const findings = linkFindings(doc).links.filter((f) =>
    f.items.includes(itemId) && (f.gift || (f.result && f.result.verdict !== 'ok')) && !kept.has(f.url));
  // Held by the editor like a write-back, so a remount mid-move keeps the buttons off.
  const linkBusy = writing;

  const linkAction = async (action: 'use' | 'original' | 'keep', url?: string) => {
    onWriteOut(itemId, true);
    try {
      await run(() => api.linkAction(id, itemId, action, url));
    } finally {
      onWriteOut(itemId, false);
    }
  };

  /**
   * Pinboard has no rename: the move adds a bookmark at the printed link
   * with every field of this one, then deletes this one. Asked first.
   */
  const moveBookmark = async () => {
    if (!item.canonical_url || !item.source_url) return;
    if (!confirm(`Move the Pinboard bookmark from\n${item.source_url}\nto\n${item.canonical_url}?\n\nIts title, commentary, tags, privacy and date go with it, and the old bookmark is deleted.`)) return;
    onWriteOut(itemId, true);
    try {
      const answer: { moved?: Awaited<ReturnType<typeof api.moveBookmark>> } = {};
      const ok = await run(async () => (answer.moved = await api.moveBookmark(id, itemId)));
      if (ok && answer.moved && !answer.moved.result.removed) {
        onError('Moved — but the old bookmark could not be deleted, so delete it at Pinboard.');
      }
    } finally {
      onWriteOut(itemId, false);
    }
  };

  /**
   * The save runs inside run(), as the canvas's do, so its failure is one a
   * later success clears; called outside it, the bar kept saying a save had
   * failed after it had gone through (Batch 5 review, N6). Resolves to
   * whether it was saved.
   */
  const commit = async (patch: Record<string, unknown>): Promise<boolean> => {
    const answer: { updated?: Awaited<ReturnType<typeof api.updateItem>> } = {};
    const ok = await run(async () => (answer.updated = await api.updateItem(id, itemId, patch)));
    // The server writes a mirrored field back to its source as part of the
    // edit and reports the outcome; the inspector only surfaces it.
    if (ok && shouldWriteBack(item, patch) && answer.updated?.result) {
      report(answer.updated.result);
    }
    return ok;
  };

  /**
   * The save's promise, or undefined when there is nothing to save.
   *
   * Frozen, a field saves nothing, whatever its blur reads back. A read-only
   * Title on an untitled post reads back '' where the item holds undefined,
   * so focusing it to copy and clicking away sent {title: ''} into the
   * server's 423 (Batch 7 review, B1). The same holds for every field below.
   */
  const commitField = (field: 'title' | 'label' | 'commentary' | 'body' | 'ask', value: string) =>
    !frozen && edited(item[field], value) ? commit({ [field]: value }) : undefined;

  const commitMedia = (field: string, value: string) => {
    if (frozen) return undefined;
    if (!edited(item.media?.[field as keyof NonNullable<Item['media']>], value)) return undefined;
    return commit({ media: { ...(item.media ?? {}), [field]: value } });
  };

  return (
    <aside class="panel" aria-label={`${item.type.replace('_', ' ')} inspector`}>
      {onBackToReview && (
        <button class="btn tiny back-review" onClick={onBackToReview}>← Review</button>
      )}
      <h3>{item.type.replace('_', ' ')}</h3>
      {frozen && (
        <p class="field-note">
          {doc.issue.put_to_bed_at
            ? `WT${doc.issue.number} is put to bed — wake it to change anything.`
            : 'A pre-Builder record — nothing here is editable.'}
        </p>
      )}

      {(item.title !== undefined || imported) && (
        <div class="field">
          <label htmlFor={`${prefix}-title`}>Title</label>
          <Input
            id={`${prefix}-title`}
            readOnly={frozen}
            value={item.title ?? ''}
            // A promoted post's title is its section heading, and the
            // server refuses a blank one. Cleared, the field goes back to
            // the saved title, as the heading on the canvas does (Batch 5
            // review round 2, B2).
            onCommit={(text) => (promoted && !text.trim() ? undefined : commitField('title', text))}
          />
        </div>
      )}

      {item.type === 'currently' && (
        <div class="field">
          <label htmlFor={`${prefix}-label`}>Label</label>
          <Input
            id={`${prefix}-label`}
            readOnly={frozen}
            value={item.label ?? ''}
            onCommit={(text) => commitField('label', text)}
          />
        </div>
      )}

      {item.type === 'photo' ? (
        <PhotoFields item={item} prefix={prefix} commit={commitMedia} frozen={frozen} />
      ) : item.type === 'pinboard_link' ? (
        <>
          <div class="field">
            <label htmlFor={`${prefix}-commentary`}>Commentary</label>
            <GrowingTextarea
              id={`${prefix}-commentary`}
              disabled={frozen}
              value={item.commentary ?? ''}
              onCommit={(text) => commitField('commentary', text)}
            />
          </div>
          <div class="field">
            <label htmlFor={`${prefix}-tags`}>Pinboard tags</label>
            <Input
              id={`${prefix}-tags`}
              readOnly={frozen}
              value={(item.tags ?? []).join(', ')}
              onCommit={(text) => {
                if (frozen) return undefined;
                const tags = text
                  .split(',')
                  .map((tag) => tag.trim())
                  .filter(Boolean);
                return tags.join('\n') !== (item.tags ?? []).join('\n') ? commit({ tags }) : undefined;
              }}
            />
          </div>
        </>
      ) : (
        <div class="field">
          <label htmlFor={`${prefix}-body`}>Body</label>
          <GrowingTextarea
            id={`${prefix}-body`}
            disabled={frozen}
            value={String(item.body ?? '')}
            onCommit={(text) => commitField('body', text)}
          />
        </div>
      )}

      {item.type === 'echo' && (
        <div class="field">
          <label htmlFor={`${prefix}-ask`}>Ask Thingy</label>
          <Input
            id={`${prefix}-ask`}
            readOnly={frozen}
            value={item.ask ?? ''}
            placeholder="The question under the thread; empty prints no door"
            onCommit={(text) => commitField('ask', text)}
          />
        </div>
      )}

      {item.authorship === 'Thingy' && (
        <div class="review-box">
          <span>{item.reviewed ? 'Reviewed by Jamie' : 'Jamie review required'}</span>
          {!frozen && (
            <button
              class={`btn small${item.reviewed ? '' : ' primary'}`}
              onClick={() => void commit({ reviewed: !item.reviewed, status: item.reviewed ? 'draft' : 'reviewed' })}
            >
              {item.reviewed ? 'Mark draft' : 'Mark reviewed'}
            </button>
          )}
        </div>
      )}

      <h3 style="margin-top:18px">Editions</h3>
      <div class="edition-buttons">
        {CHANNELS.map((channel) => {
          const locked = item.channel_locks?.[channel];
          const on = item.channels[channel];
          return (
            <button
              key={channel}
              class={`btn small${on ? ' primary' : ''}`}
              disabled={Boolean(locked) || frozen}
              title={locked ?? (frozen ? `In the ${channel} edition: ${on ? 'yes' : 'no'}` : `Toggle the ${channel} edition`)}
              aria-label={`${on ? 'Remove' : 'Include'} item ${on ? 'from' : 'in'} ${channel}`}
              onClick={() => void run(() => api.setChannel(id, itemId, channel, !on))}
            >
              {channel}
            </button>
          );
        })}
      </div>
      {Object.entries(item.channel_locks ?? {}).map(([channel, why]) => (
        <p key={channel} class="field-note">{why}</p>
      ))}

      <h3 style="margin-top:18px">Provenance</h3>
      <div class="kv"><span>Authorship</span><span>{item.authorship}</span></div>
      <div class="kv"><span>Source</span><span>{item.source}</span></div>
      {node && <div class="kv"><span>Section</span><span>{node.label}</span></div>}
      {item.published_at && <div class="kv"><span>Published</span><span>{item.published_at}</span></div>}
      {item.source_url && (
        <div class="kv">
          <span>Original</span>
          <a href={item.source_url} target="_blank" rel="noreferrer" class="break-link">
            {item.source_url}
          </a>
        </div>
      )}
      {item.canonical_url && (
        <div class="kv">
          <span>Prints</span>
          <a href={item.canonical_url} target="_blank" rel="noreferrer" class="break-link">
            {item.canonical_url}
          </a>
        </div>
      )}
      {item.sync_state && (
        <div class="kv"><span>Sync</span><span>{syncLine(item.sync_state, item.source)}</span></div>
      )}
      {item.sync_error && <p class="field-note error-text">{item.sync_error}</p>}

      {frozen ? null : imported && item.sync_state === 'conflict' ? (
        // A retry would be refused again: the source moved. Jamie chooses.
        <div class="conflict-actions" style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn" onClick={() => void resolve('mine')} disabled={writing}
            title={`Write this copy over ${item.source}'s`}>
            {writing ? 'Writing…' : 'Keep mine'}
          </button>
          <button class="btn" onClick={() => void resolve('theirs')} disabled={writing}
            title={`Replace this copy with ${item.source}'s`}>
            Take theirs
          </button>
        </div>
      ) : imported && (
        <button class="btn" style="margin-top:12px" onClick={writeBack} disabled={writing}>
          {writing ? 'Writing…' : `Retry write to ${item.source}`}
        </button>
      )}

      {/* The row's own hints, said in full (src/shared/hints.ts). Never a gate. */}
      {!frozen && (unfinishedHint(item) || titleHint(item)) && (
        <>
          <h3 style="margin-top:18px">Hints</h3>
          {[unfinishedHint(item), titleHint(item)].filter(Boolean).map((text) => (
            <p class="field-note link-gift" key={text}>{text}</p>
          ))}
        </>
      )}

      {!frozen && (findings.length > 0 || item.canonical_url) && (
        <>
          <h3 style="margin-top:18px">Links</h3>
          {findings.map((f) => (
            <div class="link-finding" key={f.url}>
              <a href={f.url} target="_blank" rel="noreferrer" class="break-link">{f.url}</a>
              {f.gift && <p class="field-note link-gift">{giftLine(f.gift)}</p>}
              {f.result && f.result.verdict !== 'ok' && <p class="field-note">{findingLine(f)}</p>}
              {f.result?.suggestion && (
                <p class="field-note">
                  Suggested:{' '}
                  <a href={f.result.suggestion} target="_blank" rel="noreferrer" class="break-link">{f.result.suggestion}</a>
                </p>
              )}
              <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">
                {f.role === 'item' && item.type === 'pinboard_link' && f.result?.suggestion && (
                  <button class="btn" disabled={linkBusy}
                    title="Print this link in the issue. The bookmark keeps its own URL."
                    onClick={() => void linkAction('use')}>
                    Use the suggested link
                  </button>
                )}
                {(f.gift || f.result?.verdict !== 'unchecked') && (
                  <button class="btn" disabled={linkBusy}
                    title={f.role === 'inline' ? 'Edit the commentary to change it, or keep it as it is.' : 'Leave the link as it is and stop asking.'}
                    onClick={() => void linkAction('keep', f.url)}>
                    Keep as it is
                  </button>
                )}
              </div>
            </div>
          ))}
          {item.canonical_url && (
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
              <button class="btn" disabled={linkBusy} onClick={() => void linkAction('original')}
                title="Print the bookmark's own URL again">
                Back to the bookmark's link
              </button>
              {item.source === 'Pinboard' && (
                <button class="btn" disabled={linkBusy} onClick={() => void moveBookmark()}
                  title="Move the Pinboard bookmark to the link the issue prints">
                  Move bookmark…
                </button>
              )}
            </div>
          )}
        </>
      )}

      {item.archive_references?.length ? (
        <>
          <h3 style="margin-top:18px">Archive references</h3>
          {item.archive_references.map((reference) => (
            <div class="kv" key={reference.url}>
              <span>
                {reference.issue
                  ? `WT${reference.issue}`
                  : reference.kind === 'podcast' ? 'Podcast' : 'Blog'}
              </span>
              <a href={reference.url} target="_blank" rel="noreferrer">
                {reference.note ?? reference.title ?? reference.url}
              </a>
            </div>
          ))}
        </>
      ) : null}

      <div class="panel-actions">
        {!frozen && (
          <button
            class="btn"
            title="Hide this item — every edition off. Nothing is deleted."
            onClick={async () => {
              await run(() => api.setVisible(id, itemId, false));
              onClose();
            }}
          >
            Hide
          </button>
        )}
        <button class="btn" onClick={onClose}>Close</button>
      </div>
    </aside>
  );
}

function PhotoFields({
  item, prefix, commit, frozen,
}: {
  item: Item;
  prefix: string;
  commit: (field: string, value: string) => unknown;
  frozen: boolean;
}) {
  const fields: { key: keyof NonNullable<Item['media']>; label: string; type?: string }[] = [
    { key: 'url', label: 'Image URL', type: 'url' },
    { key: 'alt', label: 'Alt text' },
    { key: 'caption', label: 'Caption' },
    { key: 'timestamp', label: 'Timestamp (ISO 8601)' },
    { key: 'location', label: 'Location' },
  ];
  return (
    <>
      {fields.map((field) => (
        <div class="field" key={field.key}>
          <label htmlFor={`${prefix}-${field.key}`}>{field.label}</label>
          <Input
            id={`${prefix}-${field.key}`}
            type={field.type ?? 'text'}
            readOnly={frozen}
            value={item.media?.[field.key] ?? ''}
            onCommit={(text) => commit(field.key, text)}
          />
        </div>
      ))}
    </>
  );
}
