import { useState } from 'preact/hooks';

import type { IssueDoc, Item } from '../../shared/types.ts';
import { CHANNELS } from '../../shared/types.ts';
import { api, shouldWriteBack, type IssueResponse } from '../api.ts';

interface Props {
  doc: IssueDoc;
  itemId: string;
  run: (fn: () => Promise<IssueResponse>) => Promise<void>;
  onClose: () => void;
  /** Present when the review panel yielded the rail — the way back. */
  onBackToReview?: () => void;
  onError: (m: string | null) => void;
}

const SYNC_LABEL: Record<string, string> = {
  synced: 'Synced with {source}',
  syncing: 'Writing to {source}…',
  failed: 'Write to {source} failed — your edit is kept',
  needs_commentary: 'No commentary yet',
  local: 'Edited here, not yet written back to {source}',
  gone: 'Deleted at {source} — your copy is kept',
  conflict: 'Edited both here and at {source} — your copy is kept',
};

function syncLine(state: string, source: string): string {
  const label = SYNC_LABEL[state] ?? state;
  return label.includes('{source}') ? label.replace('{source}', source) : label;
}

/** Provenance, fields, channels, and source synchronization for one item. */
export function Inspector({ doc, itemId, run, onClose, onError, onBackToReview }: Props) {
  const item = doc.items[itemId];
  const [writing, setWriting] = useState(false);
  if (!item) return null;

  const id = doc.issue.id;
  const prefix = `item-${itemId}`;
  const node = doc.nodes.find((n) => n.items.includes(itemId));
  const imported = item.source === 'Pinboard' || item.source === 'Micro.blog';

  const writeBack = async () => {
    setWriting(true);
    try {
      const res = await api.writeBack(id, itemId);
      await run(async () => res);
      if (res.result.sync_state === 'synced') onError(null);
      else onError(`${item.source}: ${res.result.error ?? res.result.sync_state}. Your edit is kept.`);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setWriting(false);
    }
  };

  const commit = async (patch: Record<string, unknown>) => {
    try {
      const updated = await api.updateItem(id, itemId, patch);
      await run(async () => updated);
      if (shouldWriteBack(item, patch)) await writeBack();
    } catch (err) {
      onError((err as Error).message);
    }
  };

  const commitField = (field: keyof Item, value: unknown) => {
    if (item[field] !== value) void commit({ [field]: value });
  };

  const commitMedia = (field: string, value: string) => {
    if ((item.media?.[field as keyof NonNullable<Item['media']>] ?? '') === value) return;
    void commit({ media: { ...(item.media ?? {}), [field]: value } });
  };

  return (
    <aside class="panel" aria-label={`${item.type.replace('_', ' ')} inspector`}>
      {onBackToReview && (
        <button class="btn tiny back-review" onClick={onBackToReview}>← Review</button>
      )}
      <h3>{item.type.replace('_', ' ')}</h3>

      {(item.title !== undefined || imported) && (
        <div class="field">
          <label htmlFor={`${prefix}-title`}>Title</label>
          <input
            id={`${prefix}-title`}
            value={item.title ?? ''}
            onBlur={(e) => commitField('title', (e.target as HTMLInputElement).value)}
          />
        </div>
      )}

      {item.type === 'currently' && (
        <div class="field">
          <label htmlFor={`${prefix}-label`}>Label</label>
          <input
            id={`${prefix}-label`}
            value={item.label ?? ''}
            onBlur={(e) => commitField('label', (e.target as HTMLInputElement).value)}
          />
        </div>
      )}

      {item.type === 'photo' ? (
        <PhotoFields item={item} prefix={prefix} commit={commitMedia} />
      ) : item.type === 'pinboard_link' ? (
        <>
          <div class="field">
            <label htmlFor={`${prefix}-commentary`}>Commentary</label>
            <textarea
              id={`${prefix}-commentary`}
              value={item.commentary ?? ''}
              onBlur={(e) => commitField('commentary', (e.target as HTMLTextAreaElement).value)}
            />
          </div>
          <div class="field">
            <label htmlFor={`${prefix}-tags`}>Pinboard tags</label>
            <input
              id={`${prefix}-tags`}
              value={(item.tags ?? []).join(', ')}
              onBlur={(e) => {
                const tags = (e.target as HTMLInputElement).value
                  .split(',')
                  .map((tag) => tag.trim())
                  .filter(Boolean);
                if (tags.join('\n') !== (item.tags ?? []).join('\n')) void commit({ tags });
              }}
            />
          </div>
        </>
      ) : (
        <div class="field">
          <label htmlFor={`${prefix}-body`}>Body</label>
          <textarea
            id={`${prefix}-body`}
            value={String(item.body ?? '')}
            onBlur={(e) => commitField('body', (e.target as HTMLTextAreaElement).value)}
          />
        </div>
      )}

      {item.authorship === 'Thingy' && (
        <div class="review-box">
          <span>{item.reviewed ? 'Reviewed by Jamie' : 'Jamie review required'}</span>
          <button
            class={`btn small${item.reviewed ? '' : ' primary'}`}
            onClick={() => void commit({ reviewed: !item.reviewed, status: item.reviewed ? 'draft' : 'reviewed' })}
          >
            {item.reviewed ? 'Mark draft' : 'Mark reviewed'}
          </button>
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
              disabled={Boolean(locked)}
              title={locked ?? `Toggle the ${channel} edition`}
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
      {item.sync_state && (
        <div class="kv"><span>Sync</span><span>{syncLine(item.sync_state, item.source)}</span></div>
      )}
      {item.sync_error && <p class="field-note error-text">{item.sync_error}</p>}

      {imported && (
        <button class="btn" style="margin-top:12px" onClick={writeBack} disabled={writing}>
          {writing ? 'Writing…' : `Retry write to ${item.source}`}
        </button>
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
        <button class="btn" onClick={onClose}>Close</button>
      </div>
    </aside>
  );
}

function PhotoFields({
  item, prefix, commit,
}: {
  item: Item;
  prefix: string;
  commit: (field: string, value: string) => void;
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
          <input
            id={`${prefix}-${field.key}`}
            type={field.type ?? 'text'}
            value={item.media?.[field.key] ?? ''}
            onBlur={(e) => commit(field.key, (e.target as HTMLInputElement).value)}
          />
        </div>
      ))}
    </>
  );
}
