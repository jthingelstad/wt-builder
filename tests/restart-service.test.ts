/**
 * `npm run deploy` must not report success with the service down. On
 * 2026-11-03 `launchctl kickstart -k` returned 0 while the job sat in "spawn
 * failed". launchd and lsof are stubbed here, so nothing on the host restarts.
 */

import { describe, expect, it } from 'vitest';
import { parseJob, parsePorts, restart, type Host } from '../scripts/restart-service.ts';

const running = (pid: number) =>
  [
    'gui/502/com.thingelstad.wt-builder = {',
    '\tactive count = 1',
    '\tstate = running',
    '\tprogram = /opt/homebrew/bin/node',
    `\tpid = ${pid}`,
    '\tjob state = running',
    '\tendpoints = {',
    '\t\tpid = 7',
    '\t\tjob state = nested',
    '\t}',
    '}',
  ].join('\n');

const spawnFailed = [
  'gui/502/com.thingelstad.wt-builder = {',
  '\tstate = spawn scheduled',
  '\tlast exit code = 78: EX_CONFIG',
  '\tjob state = spawn failed',
  '}',
].join('\n');

/** launchd answers from `jobs` in turn, then keeps repeating the last answer. */
function fakeHost(jobs: (string | null)[], ports: Record<number, number[]> = {}, kicked = true) {
  let clock = 0;
  let asked = 0;
  const host: Host & { kicks: number } = {
    kicks: 0,
    kickstart() {
      host.kicks += 1;
      return { ok: kicked, detail: kicked ? '' : 'Could not find service' };
    },
    job: () => jobs[Math.min(asked++, jobs.length - 1)] ?? null,
    ports: (pid) => ports[pid] ?? [],
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock,
  };
  return host;
}

describe('reading launchd and lsof', () => {
  it('reads the job fields, not the same names in a deeper block', () => {
    expect(parseJob(running(52890))).toEqual({ pid: 52890, jobState: 'running', lastExit: null });
  });

  it('reads a job that failed to spawn as having no process', () => {
    expect(parseJob(spawnFailed)).toEqual({ pid: null, jobState: 'spawn failed', lastExit: '78: EX_CONFIG' });
  });

  it('reads a job launchd does not know as having no process', () => {
    expect(parseJob(null).pid).toBeNull();
  });

  it('reads ports from lsof, and none from no output', () => {
    expect(parsePorts('p52890\nf17\nn127.0.0.1:4317\n')).toEqual([4317]);
    expect(parsePorts('')).toEqual([]);
  });
});

describe('a deploy passes only with a new process on a port', () => {
  it('passes once the new process is listening', async () => {
    const host = fakeHost([running(1), running(1), running(2), running(2)], { 1: [4317], 2: [4317] });
    const { ok, message } = await restart(host);
    expect(ok).toBe(true);
    expect(message).toContain('pid 2, port 4317');
    expect(host.kicks).toBe(1);
  });

  it('passes when the service was already down before the deploy', async () => {
    const host = fakeHost([spawnFailed, running(2)], { 2: [4317] });
    expect((await restart(host)).ok).toBe(true);
  });

  it('fails on the spawn failure of 2026-11-03, and prints the repair', async () => {
    const { ok, message } = await restart(fakeHost([running(1), spawnFailed], { 1: [4317] }));
    expect(ok).toBe(false);
    expect(message).toContain('no process after 30 s');
    expect(message).toContain('last exit code = 78: EX_CONFIG');
    expect(message).toContain('launchctl bootout gui/$(id -u)/com.thingelstad.wt-builder');
    expect(message).toContain('launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.thingelstad.wt-builder.plist');
  });

  it('fails when the new process never listens, and does not offer the reload', async () => {
    const { ok, message } = await restart(fakeHost([running(1), running(2)], { 1: [4317] }));
    expect(ok).toBe(false);
    expect(message).toContain('pid 2 is listening on no TCP port');
    expect(message).not.toContain('bootout');
    expect(message).toContain('wt-builder.err');
  });

  it('does not take the old process, still listening, for the new one', async () => {
    const { ok, message } = await restart(fakeHost([running(1)], { 1: [4317] }));
    expect(ok).toBe(false);
    expect(message).toContain('pid 1 is still the old process');
  });

  it('fails at once when launchctl itself refuses', async () => {
    const { ok, message } = await restart(fakeHost([null], {}, false));
    expect(ok).toBe(false);
    expect(message).toContain('Could not find service');
  });
});
