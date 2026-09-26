/**
 * A fresh database for the browser tests, holding the representative issue
 * as a draft — the fixture every edition renders from. Run by the e2e web
 * server before it starts; the file lives in tmp/ and is thrown away.
 */
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';

const db = process.env.WT_BUILDER_DB!;
if (!db || !db.includes('/tmp/e2e/')) throw new Error('seed.ts only writes a tmp/e2e database');
mkdirSync(dirname(db), { recursive: true });
for (const f of [db, `${db}-wal`, `${db}-shm`]) rmSync(f, { force: true });

const store = await import('../../src/server/db.ts');
const doc = JSON.parse(readFileSync(new URL('../../fixtures/representative-issue.json', import.meta.url), 'utf8'));
store.saveIssue(doc);
store.closeDb();
console.log(`seeded ${doc.issue.id} into ${db}`);
