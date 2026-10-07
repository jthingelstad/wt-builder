/**
 * The Share view: a layer over the editor, as Send is, for an issue that has
 * gone out (docs/share-plan.md). Put to bed, the editor's Publish becomes
 * Share and lands here, this week or a year later.
 *
 * Each share is one post to one place, worked like a task: LinkedIn, which
 * Jamie posts himself (copy, open, mark shared), or a blog post WT Builder
 * makes on micro.blog through Micropub. Shares live in their own table, not
 * in the issue, so a sleeping issue takes them. A share that went is the
 * record of what went out, and is shown as it went.
 */

import { useEffect, useRef, useState } from 'preact/hooks';

import type { IssueDoc, Share as ShareRow, ShareDestination } from '../../shared/types.ts';
import { DESTINATION_NAME, LINKEDIN_MAX, foldAt, linksIssue, plainText, shareLink } from '../../shared/shares.ts';
import { api, type ShareOption } from '../api.ts';
import { ArrowLeft, Check, CornerUpRight, Globe, Plus, Trash, WandSparkles } from '../icons.tsx';

interface Props {
  doc: IssueDoc;
  onBack: () => void;
  /** To the Send view, where Made in and Put to bed live. */
  onSends: () => void;
}

const LINKEDIN_FEED = 'https://www.linkedin.com/feed/';

const when = (iso: string) =>
  new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

export function Share({ doc, onBack, onSends }: Props) {
  const id = doc.issue.id;
  const n = doc.issue.number;
  const [shares, setShares] = useState<ShareRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const published = doc.issue.status === 'published';

  useEffect(() => {
    let live = true;
    api.listShares(id)
      .then((r) => { if (live) setShares(r.shares); })
      .catch((e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [id]);

  // Escape goes back, as it does from Send.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')) return;
      onBack();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [onBack]);

  const add = async (destination: ShareDestination) => {
    setAdding(true);
    setError(null);
    try {
      setShares((await api.createShare(id, destination)).shares);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAdding(false);
    }
  };

  return (
    <div class="send-layer share-layer">
      <header class="header">
        <button class="btn ghost-btn" onClick={onBack}><ArrowLeft /> Issue</button>
        <span class="mark">W</span>
        <span class="head-divider" />
        <span class="identity">
          <span class="wt">WT{n}</span>
          <span class="win">{doc.issue.title}</span>
        </span>
        <span class="head-spacer" />
        <button class="btn ghost-btn" onClick={onSends} title="The Send view: what went out, Made in, and Put to bed">Sends</button>
      </header>

      <div class="send-body">
        <h1>Share</h1>
        <p class="lede">
          Telling people about WT{n}. Each share is one post to one place:
          LinkedIn, which you post yourself, or a blog post WT Builder makes on
          micro.blog. The link is in the words, never in a comment.
        </p>

        {error && <div class="error-bar" role="alert">{error}</div>}

        {published ? (
          <div class="share-new">
            <span class="mono-label">NEW SHARE</span>
            <button class="btn" disabled={adding} onClick={() => add('linkedin')}><Plus /> LinkedIn</button>
            <button class="btn" disabled={adding} onClick={() => add('blog')}><Plus /> Blog post</button>
          </div>
        ) : (
          <div class="send-warn">WT{n} has not gone out yet, so there is no page to share. Send it first.</div>
        )}

        {shares === null && !error && <p class="quiet">Loading…</p>}
        {shares?.length === 0 && published && (
          <p class="quiet share-empty">No shares yet. Start one above.</p>
        )}
        {shares?.map((s) => (
          <ShareCard key={s.id} doc={doc} share={s} onShares={setShares} />
        ))}
      </div>
    </div>
  );
}

function ShareCard({ doc, share, onShares }: { doc: IssueDoc; share: ShareRow; onShares: (s: ShareRow[]) => void }) {
  const id = doc.issue.id;
  const n = doc.issue.number;
  const linkedin = share.destination === 'linkedin';
  const shared = share.state === 'shared';
  const [text, setText] = useState(share.text);
  const [title, setTitle] = useState(share.title ?? '');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<ShareOption[] | null>(null);
  const [copied, setCopied] = useState(false);
  // What the server holds, so a blur with nothing changed saves nothing.
  const saved = useRef({ text: share.text, title: share.title ?? '' });

  /** Save what changed. Every action saves first, so what goes is what is on screen. */
  const flush = async (next = { text, title }): Promise<boolean> => {
    const patch: { text?: string; title?: string } = {};
    if (next.text !== saved.current.text) patch.text = next.text;
    if (!linkedin && next.title !== saved.current.title) patch.title = next.title;
    if (!Object.keys(patch).length) return true;
    try {
      const r = await api.updateShare(id, share.id, patch);
      saved.current = { text: r.share.text, title: r.share.title ?? '' };
      setErr(null);
      onShares(r.shares);
      return true;
    } catch (e) {
      setErr(`Not saved: ${(e as Error).message}`);
      return false;
    }
  };

  const act = async (name: string, fn: () => Promise<void>) => {
    setBusy(name);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const draft = () => act('draft', async () => {
    setCandidates((await api.draftShare(id, share.id)).candidates);
  });

  const use = (c: ShareOption) => {
    const written = text.trim() && text.trim() !== shareLink(doc, share.destination);
    if (written && !confirm('Replace the words in this share with the draft?')) return;
    const next = { text: c.text, title: linkedin ? title : c.title ?? '' };
    setText(next.text);
    setTitle(next.title);
    setCandidates(null);
    void flush(next);
  };

  // The clipboard is written first, inside the click: Safari refuses a write
  // that comes after an await.
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch (e) {
      setErr(`Could not copy: ${(e as Error).message}`);
    }
    void flush();
  };

  const markShared = () => {
    const url = prompt(`Marking the LinkedIn share of WT${n} as shared. The post's URL, if you have it (optional):`, '');
    if (url === null) return;
    void act('shared', async () => {
      if (!(await flush())) return;
      onShares((await api.markShared(id, share.id, url.trim() || undefined)).shares);
    });
  };

  const post = () => {
    if (!confirm(`Post this to thingelstad.com now, under Weekly Thing? It publishes on micro.blog and goes out to the blog's feed.`)) return;
    void act('post', async () => {
      if (!(await flush())) return;
      onShares((await api.postShare(id, share.id)).shares);
    });
  };

  const remove = () => {
    if (!confirm(`Delete this ${DESTINATION_NAME[share.destination]} share? It was never shared.`)) return;
    void act('delete', async () => {
      onShares((await api.deleteShare(id, share.id)).shares);
    });
  };

  const shown = shared ? share.text : text;
  const fold = linkedin ? foldAt(shown) : null;
  const length = shown.length;
  const missingLink = !linksIssue(shown, doc);
  const markdown = linkedin && plainText(shown) !== shown;

  return (
    <section class={`send-card share-card ${share.destination}${shared ? ' sent' : ''}`} data-share={share.id}>
      <div class="sc-head">
        <span class={`sc-tile${shared ? ' done' : ''}`}>{linkedin ? <CornerUpRight size={14} /> : <Globe />}</span>
        <div class="sc-name">
          <div class="sc-title">
            {DESTINATION_NAME[share.destination]}
            <span class={`sc-pill ${shared ? 'sent' : 'none'}`}>{shared ? 'SHARED' : 'DRAFT'}</span>
          </div>
          <div class="sc-dest">
            {shared && share.shared_at
              ? <>Shared {when(share.shared_at)}</>
              : <>Started {when(share.created_at)}</>}
            {share.url && <> · <a href={share.url} target="_blank" rel="noreferrer">the post ↗</a></>}
          </div>
        </div>
        {!shared && (
          <button class="btn" disabled={busy !== null} onClick={draft} title="Three drafts to pick from. Nothing is written until you pick one.">
            <WandSparkles /> {busy === 'draft' ? 'Drafting…' : 'Draft'}
          </button>
        )}
      </div>

      <div class="sh-body">
        {shared ? (
          <>
            {share.title && <div class="sh-title-shown">{share.title}</div>}
            <div class="sh-text-shown">{share.text}</div>
          </>
        ) : (
          <>
            {!linkedin && (
              <input
                class="sh-title" type="text" value={title} placeholder="Title (optional: most posts have none)"
                onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
                onBlur={() => void flush()}
              />
            )}
            <textarea
              class="sh-text" rows={linkedin ? 10 : 7} value={text}
              placeholder={linkedin ? 'What to say on LinkedIn, above the link' : 'The post, ending on the issue'}
              onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
              onBlur={() => void flush()}
            />
          </>
        )}

        {linkedin && (
          <div class="sh-meta">
            <span class={`sh-count${length > LINKEDIN_MAX ? ' over' : ''}`}>{length.toLocaleString()} / {LINKEDIN_MAX.toLocaleString()}</span>
            {fold === null
              ? <span class="quiet">The whole post shows; LinkedIn does not fold it.</span>
              : <span class="quiet">LinkedIn folds it behind "…see more" after:</span>}
          </div>
        )}
        {linkedin && fold !== null && (
          <div class="sh-fold"><span>{shown.slice(0, fold).trimEnd()}</span><span class="sh-more">…see more</span></div>
        )}
        {missingLink && <div class="sc-evidence warn">The post does not link WT{n}: {shareLink(doc, share.destination)}</div>}
        {markdown && <div class="sc-evidence warn">LinkedIn shows Markdown as typed: links and asterisks will show.</div>}
        {err && <div class="sc-evidence error">{err}</div>}

        {candidates && (
          <div class="draft-picker sh-cands">
            <div class="dp-head">
              <span class="mono-label">DRAFTED — PICK ONE</span>
              <button class="dp-x" aria-label="Dismiss" onClick={() => setCandidates(null)}>×</button>
            </div>
            {candidates.map((c, i) => (
              <div key={i} class="sh-cand">
                {c.lead_title && <div class="sh-lead">Leads with <strong>{c.lead_title}</strong></div>}
                {c.title && <div class="sh-lead"><strong>{c.title}</strong></div>}
                <div class="sh-cand-text">{c.text}</div>
                <button class="btn small" onClick={() => use(c)}>Use this</button>
              </div>
            ))}
            <p class="dp-foot">Nothing is written until you pick one.</p>
          </div>
        )}
      </div>

      {!shared && (
        <div class="sh-actions">
          {linkedin ? (
            <>
              <button class="btn" onClick={copy}>{copied ? <><Check /> Copied</> : 'Copy text'}</button>
              <a class="btn" href={LINKEDIN_FEED} target="_blank" rel="noreferrer" onClick={() => void flush()}>Open LinkedIn ↗</a>
              <button class="btn primary" disabled={busy !== null} onClick={markShared}>
                {busy === 'shared' ? 'Marking…' : 'Mark shared'}
              </button>
            </>
          ) : (
            <button class="btn primary" disabled={busy !== null || !text.trim()} onClick={post}>
              {busy === 'post' ? 'Posting…' : 'Post to the blog'}
            </button>
          )}
          <span class="head-spacer" />
          <button class="btn ghost-btn" disabled={busy !== null} onClick={remove} title="Delete this share"><Trash /> Delete</button>
        </div>
      )}
    </section>
  );
}
