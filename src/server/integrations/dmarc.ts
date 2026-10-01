/**
 * Postmark's DMARC Digests — the aggregate reports mailbox providers send
 * for thingelstad.com (the `rua=` in its DMARC record), read back for the
 * Buttondown check (2026-10-01).
 *
 * GET only: reports listed by date, then each report's rows. The same API
 * can rotate the token and delete the record; nothing here calls either.
 * The token is `POSTMARK_DMARC_TOKEN`, server-side like every credential.
 *
 * Aggregate reports are per sending source and count, never per recipient,
 * so nothing here can say anything about a reader.
 */

import { credentials } from '../config.ts';

const API = 'https://dmarc.postmarkapp.com';

/** One row of an aggregate report: one source's messages, and how DMARC judged them. */
export interface DmarcRecord {
  source_ip: string;
  host_name?: string;
  count: number;
  header_from?: string;
  policy_evaluated_spf?: string;
  policy_evaluated_dkim?: string;
  policy_evaluated_disposition?: string;
  dkim_domain?: string;
  spf_domain?: string;
}

export interface DmarcReport {
  id: number | string;
  organization_name: string;
  date_range_begin: string;
  date_range_end: string;
  records: DmarcRecord[];
}

export function isConfigured(): boolean {
  return Boolean(credentials.postmarkDmarcToken);
}

async function get(path: string): Promise<unknown> {
  const token = credentials.postmarkDmarcToken;
  if (!token) throw new Error('POSTMARK_DMARC_TOKEN is not configured');
  const res = await fetch(`${API}${path}`, {
    headers: { Accept: 'application/json', 'X-Api-Token': token },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Postmark DMARC ${path.split('?')[0]} failed: ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
}

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const MAX_REPORTS = 300;

/**
 * Every report whose window overlaps [from, to], with its rows. Listed by
 * calendar day on either side (a report covers the day before it is sent),
 * then kept by its own date range.
 */
export async function reportsBetween(from: number, to: number): Promise<DmarcReport[]> {
  const listed: { id: number | string; organization_name: string; date_range_begin: string; date_range_end: string }[] = [];
  let path: string | undefined = `/records/my/reports?from_date=${day(from - 86_400_000)}&to_date=${day(to + 3 * 86_400_000)}&limit=50`;
  while (path && listed.length < MAX_REPORTS) {
    const page = (await get(path)) as { entries?: typeof listed; meta?: { next_url?: string; next?: string | number } };
    listed.push(...(page.entries ?? []));
    const next = page.meta?.next_url;
    if (!next) break;
    const u = new URL(next, API);
    path = `${u.pathname}${u.search}`;
  }
  const overlapping = listed.filter((r) => Date.parse(r.date_range_begin) <= to && Date.parse(r.date_range_end) >= from);
  const out: DmarcReport[] = [];
  const queue = [...overlapping];
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
    for (let r = queue.shift(); r !== undefined; r = queue.shift()) {
      const full = (await get(`/records/my/reports/${encodeURIComponent(String(r.id))}`)) as { records?: DmarcRecord[] };
      out.push({ ...r, records: full.records ?? [] });
    }
  }));
  return out;
}
