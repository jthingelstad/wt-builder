/**
 * Sections that wait on other sections (docs/mcp-plan.md, Part A).
 *
 * The strip used to treat every pill as something Jamie could do now, and the
 * only notion of order was that Echoes prints last. Position is not the real
 * constraint: some sections are *made from* others, and finishing one before
 * its inputs means doing it again. Jamie, 2026-10-04: "Haiku cannot be
 * generated until Notable, Journal, Briefly are populated — those are inputs
 * for it." A pill for one of these reads `waiting`, and says on what.
 *
 * The rule for adding a dependency: a section waits on another only when it
 * is made from it. Reading something for flavour is not one — Membership's
 * wand sees the assembled issue but is grounded in the members page, and
 * waits on nothing. The full map, with every section that waits on nothing
 * and why, is the plan's "dependency map".
 */

/** Dependency groups. A group can span node types: Featured is Notable. */
export type Section =
  | 'title' | 'notable' | 'journal' | 'briefly' | 'intro' | 'outro' | 'haiku' | 'echoes';

export const DEPENDS_ON: Readonly<Partial<Record<Section, readonly Section[]>>> = {
  // "Title and dek depend on Featured links for sure." The dek also lists
  // Briefly and Journal topics, but those are known as soon as they are in.
  title: ['notable'],
  // "Just Notable and Journal is what I would have expected."
  echoes: ['notable', 'journal'],
  haiku: ['notable', 'journal', 'briefly'],
  // "Outro should depend on Intro."
  outro: ['intro'],
};

/** What a section is called when no node in the issue names it. */
export const SECTION_NAME: Readonly<Record<Section, string>> = {
  title: 'Title',
  notable: 'Notable',
  journal: 'Journal',
  briefly: 'Briefly',
  intro: 'Intro',
  outro: 'Outro',
  haiku: 'Haiku',
  echoes: 'Echoes',
};

/**
 * The group a node's pills belong to. Older issues call the heading-link
 * section Featured; a promoted post is still the Journal's.
 */
export function sectionOf(node: { type: string; kind: string }): Section | undefined {
  if (node.kind === 'promoted_item') return 'journal';
  switch (node.type) {
    case 'notable':
    case 'featured':
      return 'notable';
    case 'journal':
    case 'briefly':
    case 'intro':
    case 'outro':
    case 'haiku':
    case 'echoes':
      return node.type;
    default:
      return undefined;
  }
}

/** One unmet input, and how far along it is. */
export interface WaitingOn {
  section: Section;
  name: string;
  done: number;
  total: number;
}

interface DependentUnit {
  state: 'done' | 'partial' | 'todo' | 'waiting';
  kind: string;
  section?: Section;
  waiting_on?: WaitingOn[];
}

/**
 * Whether one of a section's pills counts as finished input. Done, or a
 * Journal post that only lacks alt text: its words are what the dependent
 * section reads, and those are published (a Journal pill is partial for
 * nothing else).
 */
const counts = (u: DependentUnit, section: Section) =>
  u.state === 'done' || (section === 'journal' && u.state === 'partial');

/**
 * Mark every unfinished pill whose inputs are unfinished as `waiting`, with
 * what it waits on. A finished pill stays done. A section not in the issue,
 * or with nothing in it, owes nothing and is met. Sync pills are not input.
 *
 * Mutates and returns `units`. Inputs are judged as computed, before any
 * pill is marked: nothing that waits is itself waited on today, and if a
 * chain is added, a waiting input is not done, so what follows waits too.
 */
export function applyDependencies<U extends DependentUnit>(
  units: U[],
  names: Partial<Record<Section, string>> = {},
): U[] {
  const progress = new Map<Section, { done: number; total: number }>();
  for (const u of units) {
    if (!u.section || u.kind === 'sync') continue;
    const p = progress.get(u.section) ?? { done: 0, total: 0 };
    p.total += 1;
    if (counts(u, u.section)) p.done += 1;
    progress.set(u.section, p);
  }
  for (const u of units) {
    if (!u.section || u.state === 'done' || u.kind === 'sync') continue;
    const unmet: WaitingOn[] = [];
    for (const dep of DEPENDS_ON[u.section] ?? []) {
      const p = progress.get(dep);
      if (p && p.done < p.total) {
        unmet.push({ section: dep, name: names[dep] ?? SECTION_NAME[dep], ...p });
      }
    }
    if (unmet.length) {
      u.state = 'waiting';
      u.waiting_on = unmet;
    }
  }
  return units;
}

/** "Notable (3 of 5), Briefly (6 of 9)". */
export function waitingSummary(on: readonly WaitingOn[]): string {
  return on.map((w) => `${w.name} (${w.done} of ${w.total})`).join(', ');
}

/** The first cycle in a dependency map, as a path, or null. */
export function findCycle(map: Partial<Record<string, readonly string[]>>): string[] | null {
  const state = new Map<string, 'visiting' | 'done'>();
  const walk = (node: string, path: string[]): string[] | null => {
    if (state.get(node) === 'done') return null;
    if (state.get(node) === 'visiting') return [...path.slice(path.indexOf(node)), node];
    state.set(node, 'visiting');
    for (const next of map[node] ?? []) {
      const found = walk(next, [...path, node]);
      if (found) return found;
    }
    state.set(node, 'done');
    return null;
  };
  for (const node of Object.keys(map)) {
    const found = walk(node, []);
    if (found) return found;
  }
  return null;
}
