/**
 * Version the Buttondown-hosted config — the newsletter settings and the
 * welcome automations that live in Buttondown's web UI and that nothing
 * could grep. The r/WeeklyThing references survived there for months after
 * the community wound down because this config had no repository.
 *
 *   npm run buttondown:pull    # snapshot live config into buttondown/
 *   npm run buttondown:diff    # what differs, repo vs live
 *   npm run buttondown:push    # apply the repo's managed fields to live
 *
 * Layout: buttondown/newsletters/<username>.json holds the config with the
 * long human-authored text fields extracted to sibling .md files
 * (<username>/<field>.md) so copy edits happen in Markdown, not inside
 * JSON strings. Automations mirror this: automations/<slug>.json with
 * send_email bodies at <slug>/action-<i>.md.
 *
 * The `api_key` each newsletter object carries is STRIPPED on pull and
 * never written — this repository is public.
 *
 * Push is deliberately narrow: it PATCHes only managed fields that differ
 * from live, and prints each one. It never creates or deletes newsletters
 * or automations; removing an automation action is expressed by editing
 * the actions array in its JSON (and push PATCHes the whole array).
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
try {
  process.loadEnvFile(join(ROOT, '.env'));
} catch {
  /* env may already be present */
}

const API = 'https://api.buttondown.com/v1';
const OUT = join(ROOT, 'buttondown');

const KEY = process.env.BUTTONDOWN_API_KEY;
if (!KEY) {
  console.error('BUTTONDOWN_API_KEY is not configured');
  process.exit(1);
}

/** Newsletter fields whose values are prose/markup: extracted to .md files. */
const EXTRACTED_FIELDS = [
  'description',
  'footer',
  'header',
  'css',
  'web_css',
  'custom_subscription_confirmation_email_text',
  'custom_subscription_confirmation_reminder_email_text',
  'custom_subscription_confirmed_email_text',
  'custom_premium_confirmation_email_body',
  'custom_churn_email_body',
  'custom_gift_subscription_email_body',
  'custom_gift_unsubscription_email_body',
  'custom_expired_trial_notification_body',
];

/** Fields push may PATCH on a newsletter — the managed set. */
const MANAGED_NEWSLETTER_FIELDS = [
  ...EXTRACTED_FIELDS,
  'custom_subscription_confirmation_email_subject',
  'custom_subscription_confirmation_reminder_email_subject',
  'custom_subscription_confirmed_email_subject',
  'custom_premium_confirmation_email_subject',
  'custom_churn_email_subject',
];

async function call(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Token ${KEY}`,
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const read = (p: string) => readFileSync(p, 'utf8');
const writeIf = (p: string, content: string) => {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
};

// ── pull ──────────────────────────────────────────────────────────────────

async function pull() {
  const newsletters = (await call('/newsletters')).results ?? [];
  for (const n of newsletters) {
    const name = slug(n.username || n.name);
    const dir = join(OUT, 'newsletters');
    const config: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(n)) {
      if (k === 'api_key') continue; // secret; this repo is public
      if (EXTRACTED_FIELDS.includes(k) && typeof v === 'string' && v) {
        // Verbatim: any newline normalization breaks the round-trip diff.
        writeIf(join(dir, name, `${k}.md`), v);
        config[k] = { $file: `${name}/${k}.md` };
      } else {
        config[k] = v;
      }
    }
    writeIf(join(dir, `${name}.json`), JSON.stringify(config, null, 2) + '\n');
    console.log(`pulled newsletter ${name}`);
  }

  const automations = (await call('/automations')).results ?? [];
  for (const a of automations) {
    const name = slug(a.name);
    const dir = join(OUT, 'automations');
    const copy = structuredClone(a);
    (copy.actions ?? []).forEach((action: any, i: number) => {
      const body = action?.metadata?.body;
      if (typeof body === 'string' && body) {
        writeIf(join(dir, name, `action-${i}.md`), body);
        action.metadata.body = { $file: `${name}/action-${i}.md` };
      }
    });
    writeIf(join(dir, `${name}.json`), JSON.stringify(copy, null, 2) + '\n');
    console.log(`pulled automation ${name} (${(a.actions ?? []).length} actions)`);
  }
}

// ── resolve repo state (inline the $file markers) ─────────────────────────

function resolveFiles(obj: any, baseDir: string): any {
  if (Array.isArray(obj)) return obj.map((x) => resolveFiles(x, baseDir));
  if (obj && typeof obj === 'object') {
    if (typeof obj.$file === 'string' && Object.keys(obj).length === 1) {
      return read(join(baseDir, obj.$file));
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) out[k] = resolveFiles(v, baseDir);
    return out;
  }
  return obj;
}

function repoNewsletters(): any[] {
  const dir = join(OUT, 'newsletters');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => resolveFiles(JSON.parse(read(join(dir, f))), dir));
}

function repoAutomations(): any[] {
  const dir = join(OUT, 'automations');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => resolveFiles(JSON.parse(read(join(dir, f))), dir));
}

// ── diff / push ───────────────────────────────────────────────────────────

interface Change {
  kind: 'newsletter' | 'automation';
  id: string;
  label: string;
  patch: Record<string, unknown>;
  detail: string[];
}

async function computeChanges(): Promise<Change[]> {
  const changes: Change[] = [];

  const liveNewsletters = (await call('/newsletters')).results ?? [];
  for (const repo of repoNewsletters()) {
    const live = liveNewsletters.find((n: any) => n.id === repo.id);
    if (!live) {
      console.warn(`newsletter ${repo.username} not found live — skipping`);
      continue;
    }
    const patch: Record<string, unknown> = {};
    const detail: string[] = [];
    for (const field of MANAGED_NEWSLETTER_FIELDS) {
      if (!(field in repo)) continue;
      if ((repo[field] ?? '') !== (live[field] ?? '')) {
        patch[field] = repo[field];
        detail.push(field);
      }
    }
    if (detail.length) {
      changes.push({ kind: 'newsletter', id: live.id, label: repo.username, patch, detail });
    }
  }

  const liveAutomations = (await call('/automations')).results ?? [];
  for (const repo of repoAutomations()) {
    const live = liveAutomations.find((a: any) => a.id === repo.id);
    if (!live) {
      console.warn(`automation ${repo.name} not found live — skipping`);
      continue;
    }
    const detail: string[] = [];
    if (JSON.stringify(repo.actions ?? []) !== JSON.stringify(live.actions ?? [])) detail.push('actions');
    if (repo.name !== live.name) detail.push('name');
    if (repo.status !== live.status) detail.push('status');
    if (detail.length) {
      changes.push({
        kind: 'automation',
        id: live.id,
        label: repo.name,
        patch: { name: repo.name, status: repo.status, actions: repo.actions },
        detail,
      });
    }
  }

  return changes;
}

async function main() {
  const mode = process.argv[2];
  if (mode === 'pull') return pull();

  const changes = await computeChanges();
  if (!changes.length) {
    console.log('repo and live Buttondown config agree — nothing to do');
    return;
  }
  for (const c of changes) {
    console.log(`${c.kind} ${c.label}: ${c.detail.join(', ')}`);
  }
  if (mode === 'diff') return;

  if (mode === 'push') {
    for (const c of changes) {
      const path = c.kind === 'newsletter' ? `/newsletters/${c.id}` : `/automations/${c.id}`;
      await call(path, { method: 'PATCH', body: JSON.stringify(c.patch) });
      console.log(`pushed ${c.kind} ${c.label}`);
    }
    return;
  }

  console.error('usage: buttondown-config.ts pull|diff|push');
  process.exit(1);
}

await main();
