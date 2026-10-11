/**
 * The publish surface's own frontmatter parser and permalink derivation,
 * vendored verbatim (plus type annotations) from
 * another.thingelstad.com/lib/loadEpisodes.js.
 *
 * tests/podcast-contract.test.ts proves what we emit against these copies;
 * tests/podcast-parser-drift.test.ts proves these copies against the live source
 * whenever the sibling repo is present on disk.
 */

export function parseFrontmatter(raw: string) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { data: {} as Record<string, unknown>, body: raw };
  const data: Record<string, unknown> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    if (value === 'true') data[key] = true;
    else if (value === 'false') data[key] = false;
    else if (value !== '' && /^-?\d+$/.test(value)) data[key] = Number(value);
    else data[key] = value;
  }
  return { data, body: match[2]! };
}

export function computePermalink(date: Date, slug: string): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `/${yyyy}/${mm}/${dd}/${slug}.html`;
}
