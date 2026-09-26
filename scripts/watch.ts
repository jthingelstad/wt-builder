/**
 * Watch an issue live while Jamie builds it: one line per thing that
 * happened — the event log, each item's sync state as it changes, the
 * issue's status and its send and verify legs, and anything the service
 * writes to its log or error log. Read-only; the live-session mode
 * (AGENTS.md) arms this first.
 *
 *   npm run watch                 # the newest draft
 *   npm run watch -- wt352        # a given issue, by id or number
 *   npm run watch -- wt352 --from 560   # resume after event 560
 *
 * It follows ONE issue whatever its status: the scratch watcher it replaced
 * tracked drafts only, so publishing read as every item being removed.
 */
import Database from 'better-sqlite3';
import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const DB = process.env.WT_BUILDER_DB ?? join(ROOT, 'data', 'wt-builder.db');
const LOGS = ['wt-builder.log', 'wt-builder.err'].map((f) => join(homedir(), 'Library', 'Logs', 'wt-builder', f));
const POLL_MS = 3000;

const args = process.argv.slice(2);
const fromAt = args.indexOf('--from');
const from = fromAt >= 0 ? Number(args[fromAt + 1]) : undefined;
const target = args.find((a, i) => !a.startsWith('--') && i !== fromAt + 1);

const db = new Database(DB, { readonly: true, fileMustExist: true });
const row = (target
  ? db.prepare('SELECT id FROM issues WHERE id = ? OR number = ?').get(target, Number(target.replace(/^wt/i, '')) || -1)
  : db.prepare("SELECT id FROM issues WHERE status = 'draft' ORDER BY number DESC LIMIT 1").get()) as { id: string } | undefined;
if (!row) {
  console.error(target ? `no issue ${target}` : 'no draft to watch — name one: npm run watch -- wt352');
  process.exit(1);
}
const id = row.id;

type Snap = { status: string; items: Map<string, [string | undefined, string]>; legs: Map<string, string> };
function snapshot(): Snap {
  const r = db.prepare('SELECT doc FROM issues WHERE id = ?').get(id) as { doc: string } | undefined;
  const doc = r ? JSON.parse(r.doc) : { issue: { status: 'deleted' }, items: {} };
  const items = new Map<string, [string | undefined, string]>();
  for (const [k, it] of Object.entries<Record<string, unknown>>(doc.items ?? {})) {
    items.set(k, [it.sync_state as string | undefined, String(it.title ?? it.label ?? it.type).slice(0, 60)]);
  }
  const legs = new Map<string, string>();
  for (const [d, s] of Object.entries<{ status: string }>(doc.sends ?? {})) legs.set(`send ${d}`, s.status);
  for (const [d, v] of Object.entries<{ status: string }>(doc.verify ?? {})) legs.set(`verify ${d}`, v.status);
  return { status: doc.issue.status, items, legs };
}

const say = (line: string) => console.log(line);
let last = from ?? ((db.prepare('SELECT max(id) AS m FROM events WHERE issue_id = ?').get(id) as { m: number | null }).m ?? 0);
let prev = snapshot();
const pos = new Map(LOGS.map((f) => [f, existsSync(f) ? statSync(f).size : 0]));
say(`watching ${id} (${prev.status}) from event ${last}`);

function tick(): void {
  for (const e of db.prepare('SELECT id, at, kind, summary FROM events WHERE issue_id = ? AND id > ? ORDER BY id').all(id, last) as { id: number; at: string; kind: string; summary: string }[]) {
    say(`EVENT ${e.at.slice(11, 19)}Z ${e.kind}: ${e.summary.slice(0, 200)}`);
    last = e.id;
  }
  const now = snapshot();
  if (now.status !== prev.status) say(`STATUS ${prev.status} -> ${now.status}`);
  for (const [k, [state, title]] of now.items) {
    const was = prev.items.get(k);
    if (!was) say(`ITEM new ${title}${state ? `: ${state}` : ''}`);
    else if (was[0] !== state) say(`SYNC ${title}: ${was[0]} -> ${state}`);
  }
  for (const [k, [, title]] of prev.items) if (!now.items.has(k)) say(`ITEM removed ${title}`);
  for (const [k, s] of now.legs) if (prev.legs.get(k) !== s) say(`LEG ${k}: ${prev.legs.get(k) ?? 'none'} -> ${s}`);
  prev = now;

  for (const f of LOGS) {
    if (!existsSync(f)) continue;
    const size = statSync(f).size;
    let at = pos.get(f) ?? 0;
    if (size < at) at = 0;
    if (size > at) {
      const buf = Buffer.alloc(size - at);
      const fd = openSync(f, 'r');
      readSync(fd, buf, 0, buf.length, at);
      closeSync(fd);
      for (const line of buf.toString('utf8').split('\n')) if (line.trim()) say(`LOG[${f.endsWith('.err') ? 'err' : 'log'}] ${line.slice(0, 300)}`);
    }
    pos.set(f, size);
  }
}

setInterval(() => {
  try { tick(); } catch (err) { say(`watch-error ${(err as Error).message}`); }
}, POLL_MS);
