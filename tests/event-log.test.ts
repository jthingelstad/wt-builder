/**
 * The event log as the record (docs/event-log.md, 2026-10-11): who made each
 * event happen, the facts behind its sentence, written in the transaction of
 * the save it narrates, and readable one item at a time.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { IssueDoc } from '../src/shared/types.ts';
import { ACTOR_OF, EVENT_KINDS, took } from '../src/shared/events.ts';
import { line } from '../src/server/log.ts';

const work = mkdtempSync(join(tmpdir(), 'wt-events-'));
process.env.WT_BUILDER_DB = join(work, 'events.db');

const { server } = await import('../src/server/index.ts');
const store = await import('../src/server/db.ts');

let base = '';
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no address');
  base = `http://127.0.0.1:${addr.port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  rmSync(work, { recursive: true, force: true });
});

function issue(number: number): IssueDoc {
  const doc = JSON.parse(
    readFileSync(fileURLToPath(new URL('../fixtures/representative-issue.json', import.meta.url)), 'utf8'),
  ) as IssueDoc;
  doc.issue.id = `wt${number}`;
  doc.issue.number = number;
  return store.createIssueRow(doc, [{ kind: 'issue', summary: `Issue started — WT${number}` }]).doc;
}

const api = async (path: string, init?: RequestInit) => {
  const res = await fetch(`${base}${path}`, { headers: { 'Content-Type': 'application/json' }, ...init });
  return { status: res.status, body: await res.json() as any };
};

describe('migration v6 carries the old log', () => {
  it('splits sync, draft and draft shares, and gives every old event an actor', () => {
    const d = new Database(':memory:');
    store.migrate(d, 5);
    const insert = d.prepare('INSERT INTO events (issue_id, at, kind, summary, anchor) VALUES (?, ?, ?, ?, ?)');
    const old: [string, string, string | null][] = [
      ['sync', 'Write to Pinboard succeeded — A link', 'link-1'],
      ['sync', 'Finished after restart — A link', 'link-1'],
      ['sync', 'Deleted at Micro.blog — A post', 'post-1'],
      ['sync', 'Forked from Micro.blog — A post', 'post-1'],
      ['draft', 'Draft failed: the model was too busy — Echoes', 'echoes'],
      ['send', 'Draft shared — https://files.thingelstad.com/weekly-thing/drafts/x.html', null],
      ['send', 'Send started — website', null],
      ['send', 'Send finished — website', null],
      ['issue', 'Issue started — WT350', null],
      ['issue', 'Published — WT350', null],
      ['dropped', 'A link — deleted at Pinboard', 'link-2'],
      ['dropped', 'A link — outside the window', 'link-3'],
      ['moved', 'Briefly → Notable, following the bookmark', null],
      ['links', 'Kept as it is — https://example.com', null],
      ['links', '3 links checked: 1 dead', null],
      ['edit', 'Edited body — Intro', 'intro-1'],
    ];
    for (const [kind, summary, anchor] of old) insert.run('wt350', '2026-09-20T12:00:00.000Z', kind, summary, anchor);

    store.migrate(d);
    expect(d.pragma('user_version', { simple: true })).toBe(6);
    const rows = d.prepare('SELECT kind, actor, data FROM events ORDER BY id').all() as { kind: string; actor: string; data: string | null }[];
    expect(rows.map((r) => [r.kind, r.actor])).toEqual([
      ['write', 'wt-builder'],
      ['write', 'wt-builder'],
      ['gone', 'source'],
      ['source', 'jamie'],
      ['wand', 'jamie'],
      ['share', 'jamie'],
      ['send', 'jamie'],
      ['send', 'wt-builder'],
      ['issue', 'jamie'],
      ['issue', 'wt-builder'],
      ['dropped', 'source'],
      ['dropped', 'wt-builder'],
      ['moved', 'source'],
      ['links', 'jamie'],
      ['links', 'wt-builder'],
      ['edit', 'jamie'],
    ]);
    expect(JSON.parse(rows[4]!.data!)).toEqual({ outcome: 'failed' });
    // No old kind survives that the type does not know.
    for (const r of rows) expect(EVENT_KINDS).toContain(r.kind);
    d.close();
  });
});

describe('an event is written with the save it narrates', () => {
  it('at the save\'s instant, so the version before it is the issue before the change', () => {
    const doc = issue(990601);
    const before = doc.items['intro-1']!.body;
    doc.items['intro-1']!.body = 'A new intro.';
    const row = store.saveIssue(doc, [{ kind: 'edit', anchor: 'intro-1', summary: 'Edited body — Intro', data: { fields: ['body'] } }]);
    const [e] = store.listEvents(doc.issue.id, 1);
    expect(e).toMatchObject({ kind: 'edit', actor: 'jamie', anchor: 'intro-1', data: { fields: ['body'] } });
    expect(e!.at).toBe(row.updated_at);
    expect(store.versionBefore(doc.issue.id, e!.at)!.doc.items['intro-1']!.body).toBe(before);
  });

  it('a save that fails logs nothing, and an event that cannot be written undoes its save', () => {
    const doc = issue(990602);
    issue(990603);
    const events = store.listEvents(doc.issue.id).length;

    // The number belongs to another issue: the save throws.
    const clash = structuredClone(doc);
    clash.issue.number = 990603;
    expect(() => store.saveIssue(clash, [{ kind: 'settings', anchor: 'issue', summary: 'Settings — number' }])).toThrow();
    expect(store.listEvents(doc.issue.id)).toHaveLength(events);

    // Data that cannot be stored: the edit does not land without its event.
    doc.items['intro-1']!.body = 'Never saved.';
    expect(() => store.saveIssue(doc, [{ kind: 'edit', summary: 'x', data: { n: 1n } }])).toThrow();
    expect(store.getIssue(doc.issue.id)!.doc.items['intro-1']!.body).not.toBe('Never saved.');
    expect(store.listEvents(doc.issue.id)).toHaveLength(events);
  });

  it('takes the kind\'s actor unless the call names one', () => {
    const { issue: { id } } = issue(990604);
    store.record(id, { kind: 'write', summary: 'Write to Pinboard succeeded — x' });
    store.record(id, { kind: 'dropped', actor: 'source', summary: 'x — deleted at Pinboard' });
    expect(store.listEvents(id, 2).map((e) => e.actor)).toEqual(['source', 'wt-builder']);
    // Every kind has decided whose it is.
    for (const kind of EVENT_KINDS) expect(['jamie', 'wt-builder', 'source']).toContain(ACTOR_OF[kind]);
  });
});

describe('the routes say how an edit came to be', () => {
  it('?via=wand marks a pick from a wand, and plain typing is an edit', async () => {
    const { issue: { id } } = issue(990611);
    await api(`/api/issues/${id}/items/intro-1?via=wand`, { method: 'PATCH', body: JSON.stringify({ body: 'Picked.' }) });
    await api(`/api/issues/${id}/items/intro-1`, { method: 'PATCH', body: JSON.stringify({ body: 'Typed.' }) });
    const [typed, picked] = store.listEvents(id, 2);
    expect(picked).toMatchObject({ kind: 'edit', actor: 'jamie', anchor: 'intro-1', data: { fields: ['body'], via: 'wand' } });
    expect(picked!.summary).toMatch(/^Used the wand's draft for body — /);
    expect(typed).toMatchObject({ kind: 'edit', data: { fields: ['body'] } });
    expect(typed!.data).not.toHaveProperty('via');
  });

  it('a title picked from the head wand is a settings edit via the wand', async () => {
    const { issue: { id } } = issue(990612);
    await api(`/api/issues/${id}/settings?via=wand`, { method: 'POST', body: JSON.stringify({ title: 'Picked', dek: 'A dek' }) });
    expect(store.listEvents(id, 1)[0]).toMatchObject({
      kind: 'settings', anchor: 'issue', data: { fields: ['title', 'dek'], via: 'wand' },
    });
  });

  it('?item= is one item\'s history, newest first, and nothing else\'s', async () => {
    const { issue: { id } } = issue(990613);
    await api(`/api/issues/${id}/items/intro-1`, { method: 'PATCH', body: JSON.stringify({ body: 'One.' }) });
    await api(`/api/issues/${id}/items/outro-1`, { method: 'PATCH', body: JSON.stringify({ body: 'Elsewhere.' }) });
    await api(`/api/issues/${id}/items/intro-1/channel`, { method: 'POST', body: JSON.stringify({ channel: 'audio', on: false }) });
    const { body } = await api(`/api/issues/${id}/events?item=intro-1`);
    expect(body.events.map((e: any) => [e.kind, e.anchor])).toEqual([['channels', 'intro-1'], ['edit', 'intro-1']]);
    expect(body.events[0]).toMatchObject({ actor: 'jamie', data: { channel: 'audio', on: false } });
  });
});

describe('the service log', () => {
  it('starts every line with its instant and level, so it lines up with the event log', () => {
    const at = new Date('2026-10-11T10:48:32.995Z');
    expect(line('WARN', '[draft] wt353 Haiku: 429 (event 1601)', at)).toBe('2026-10-11T10:48:32.995Z WARN  [draft] wt353 Haiku: 429 (event 1601)');
    expect(line('INFO', 'x', at)).toBe('2026-10-11T10:48:32.995Z INFO  x');
    expect(line('ERROR', 'x', at)).toBe('2026-10-11T10:48:32.995Z ERROR x');
  });

  it('says how long something took in words a person reads', () => {
    expect([took(850), took(4_200), took(12_400), took(125_000)]).toEqual(['850 ms', '4.2 s', '12 s', '2 m 05 s']);
  });
});
