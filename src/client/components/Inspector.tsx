import { useState } from 'preact/hooks';

import type { IssueDoc } from '../../shared/types.ts';
import { CHANNELS } from '../../shared/types.ts';
import { api, type IssueResponse } from '../api.ts';

interface Props {
  doc: IssueDoc;
  itemId: string;
  run: (fn: () => Promise<IssueResponse>) => Promise<void>;
  onClose: () => void;
  onError: (m: string | null) => void;
}

const SYNC_LABEL: Record<string, string> = {
  synced: 'Synced with Pinboard',
  syncing: 'Writing to Pinboard…',
  failed: 'Pinboard write failed — your edit is kept',
  needs_commentary: 'No commentary yet',
  local: 'Edited here, not yet written back',
};

/** Provenance, channels, and the per-item actions. */
export function Inspector({ doc, itemId, run, onClose, onError }: Props) {
  const item = doc.items[itemId];
  const [writing, setWriting] = useState(false);
  if (!item) return null;

  const id = doc.issue.id;
  const node = doc.nodes.find((n) => n.items.includes(itemId));

  const writeBack = async () => {
    setWriting(true);
    try {
      const res = await api.writeBack(id, itemId);
      if (res.result.sync_state !== 'synced') {
        onError(`Pinboard: ${res.result.error ?? res.result.sync_state}. Your edit is kept.`);
      } else {
        onError(null);
      }
      await run(async () => res);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setWriting(false);
    }
  };

  return (
    <aside class="panel">
      <h3>{item.type.replace('_', ' ')}</h3>

      {item.title && (
        <div class="field">
          <label>Title</label>
          <input
            value={item.title}
            onBlur={(e) => void run(() => api.updateItem(id, itemId, { title: (e.target as HTMLInputElement).value }))}
          />
        </div>
      )}

      {item.type === 'currently' && (
        <div class="field">
          <label>Label</label>
          <input
            value={item.label ?? ''}
            onBlur={(e) => void run(() => api.updateItem(id, itemId, { label: (e.target as HTMLInputElement).value }))}
          />
        </div>
      )}

      {item.type === 'pinboard_link' ? (
        <div class="field">
          <label>Commentary</label>
          <textarea
            value={item.commentary ?? ''}
            onBlur={(e) => void run(() => api.updateItem(id, itemId, { commentary: (e.target as HTMLTextAreaElement).value }))}
          />
        </div>
      ) : (
        <div class="field">
          <label>Body</label>
          <textarea
            value={String(item.body ?? '')}
            onBlur={(e) => void run(() => api.updateItem(id, itemId, { body: (e.target as HTMLTextAreaElement).value }))}
          />
        </div>
      )}

      <h3 style="margin-top:18px">Editions</h3>
      <div style="display:flex;gap:6px;margin-bottom:14px">
        {CHANNELS.map((c) => {
          const locked = item.channel_locks?.[c];
          const on = item.channels[c];
          return (
            <button
              key={c}
              class={`btn small${on ? ' primary' : ''}`}
              disabled={Boolean(locked)}
              title={locked ?? `Toggle the ${c} edition`}
              onClick={() => void run(() => api.setChannel(id, itemId, c, !on))}
            >
              {c}
            </button>
          );
        })}
      </div>
      {Object.entries(item.channel_locks ?? {}).map(([c, why]) => (
        <p key={c} style="font-size:12px;color:var(--faint);margin:0 0 10px">{why}</p>
      ))}

      <h3 style="margin-top:18px">Provenance</h3>
      <div class="kv"><span>Authorship</span><span>{item.authorship}</span></div>
      <div class="kv"><span>Source</span><span>{item.source}</span></div>
      {node && <div class="kv"><span>Section</span><span>{node.label}</span></div>}
      {item.published_at && <div class="kv"><span>Published</span><span>{item.published_at}</span></div>}
      {item.source_url && (
        <div class="kv">
          <span>Original</span>
          <a href={item.source_url} target="_blank" rel="noreferrer" style="word-break:break-all">
            {item.source_url}
          </a>
        </div>
      )}
      {item.sync_state && (
        <div class="kv"><span>Sync</span><span>{SYNC_LABEL[item.sync_state] ?? item.sync_state}</span></div>
      )}

      {item.source === 'Pinboard' && (
        <button class="btn" style="margin-top:12px" onClick={writeBack} disabled={writing}>
          {writing ? 'Writing…' : 'Write back to Pinboard'}
        </button>
      )}

      {item.archive_references?.length ? (
        <>
          <h3 style="margin-top:18px">Archive references</h3>
          {item.archive_references.map((r) => (
            <div class="kv" key={r.url}>
              <span>WT{r.issue}</span>
              <a href={r.url} target="_blank" rel="noreferrer">{r.note ?? r.url}</a>
            </div>
          ))}
        </>
      ) : null}

      <div style="display:flex;gap:6px;margin-top:18px">
        <button
          class="btn"
          title="Hide this item — every edition off. Nothing is deleted."
          onClick={() => void run(() => api.setVisible(id, itemId, false))}
        >
          Hide
        </button>
        <button class="btn" onClick={onClose}>Close</button>
      </div>
    </aside>
  );
}
