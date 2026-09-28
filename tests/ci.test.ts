/**
 * CI runs the browser suite.
 *
 * tests/e2e is the only coverage of guardBed (the 423 on a put-to-bed issue)
 * and of the contenteditable regressions, and CI skipped it (review
 * 2026-09-27, §7). This holds the workflow's shape: a Playwright job after
 * the unit tests, with both engines, and the audit still last and advisory.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');

/** One job's block of the workflow: from its header to the next job's. */
function job(name: string): string {
  const lines = workflow.split('\n');
  const start = lines.indexOf(`  ${name}:`);
  if (start < 0) return '';
  const end = lines.findIndex((l, i) => i > start && /^ {2}[A-Za-z0-9_-]+:\s*$/.test(l));
  return lines.slice(start, end < 0 ? undefined : end).join('\n');
}

/** The `- run:` / `- uses:` steps of a job, in order, each with its settings. */
function steps(block: string): string[] {
  return block.split(/\n(?= {6}- )/).slice(1);
}

describe('the CI workflow', () => {
  it('runs the browser suite after the unit tests, on both engines', () => {
    const e2e = job('e2e');
    expect(e2e).toMatch(/needs:\s*test\b/);
    expect(e2e).toMatch(/runs-on:\s*ubuntu-latest/);
    expect(e2e).toContain('npx playwright install --with-deps chromium webkit');
    expect(e2e).toContain('npm run test:e2e');
  });

  it('keeps the audit last in its job, and advisory', () => {
    const test = steps(job('test'));
    const audit = test.at(-1) ?? '';
    expect(audit).toContain('npm audit');
    expect(audit).toMatch(/continue-on-error:\s*true/);
    expect(workflow.match(/npm audit/g)).toHaveLength(1);
  });
});
