/**
 * The last step of `npm run deploy`: restart the service and prove it came back.
 *
 * `launchctl kickstart -k` returning 0 means launchd took the request, not that
 * node is running. On 2026-11-03 it returned 0 while the job sat in "spawn
 * failed" (exit 78, nothing in the app's log), and the deploy called that a
 * success with WT Builder down. So a deploy passes only when launchd has a new
 * process and that process is listening on a TCP port.
 *
 * On failure it says what launchd reports and how to repair it, and exits 1.
 * It repairs nothing itself.
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const LABEL = 'com.thingelstad.wt-builder';
const WAIT_MS = 30_000;
const POLL_MS = 500;

export interface Host {
  kickstart(): { ok: boolean; detail: string };
  /** `launchctl print` for the job, or null when launchd does not know it. */
  job(): string | null;
  /** The TCP ports this process is listening on. */
  ports(pid: number): number[];
  sleep(ms: number): Promise<void>;
  now(): number;
}

export interface Job {
  pid: number | null;
  jobState: string | null;
  lastExit: string | null;
}

/** The job's own fields sit one tab in; deeper blocks have fields of the same name. */
export function parseJob(print: string | null): Job {
  const field = (name: string) => print?.match(new RegExp(`^\\t${name} = (.+)$`, 'm'))?.[1]?.trim() ?? null;
  const pid = Number(field('pid'));
  return {
    pid: Number.isInteger(pid) && pid > 0 ? pid : null,
    jobState: field('job state'),
    lastExit: field('last exit code'),
  };
}

/** `lsof -Fn` prints one `n<address>:<port>` line per listening socket. */
export function parsePorts(lsof: string): number[] {
  return lsof
    .split('\n')
    .filter((line) => line.startsWith('n'))
    .map((line) => Number(line.slice(line.lastIndexOf(':') + 1)))
    .filter((port) => Number.isInteger(port) && port > 0);
}

function repair(job: Job): string {
  const refused = job.lastExit?.startsWith('78') || job.jobState === 'spawn failed';
  if (job.pid === null && refused) {
    return [
      'launchd is refusing to spawn the job, the failure of 2026-11-03 (often after Homebrew replaces node).',
      'The plist is fine; reload it:',
      `  launchctl bootout gui/$(id -u)/${LABEL}`,
      `  launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/${LABEL}.plist`,
    ].join('\n');
  }
  return 'Look in ~/Library/Logs/wt-builder/wt-builder.err.';
}

/** Restart and wait. Returns what to tell the deployer, and whether it worked. */
export async function restart(host: Host): Promise<{ ok: boolean; message: string }> {
  const before = parseJob(host.job()).pid;
  const kick = host.kickstart();
  if (!kick.ok) return { ok: false, message: `launchctl kickstart failed: ${kick.detail}` };

  const deadline = host.now() + WAIT_MS;
  let job = parseJob(host.job());
  let ports: number[] = [];
  for (;;) {
    ports = job.pid !== null && job.pid !== before ? host.ports(job.pid) : [];
    if (ports.length > 0) return { ok: true, message: `${LABEL} is up: pid ${job.pid}, port ${ports.join(', ')}` };
    if (host.now() >= deadline) break;
    await host.sleep(POLL_MS);
    job = parseJob(host.job());
  }

  const seconds = WAIT_MS / 1000;
  const why =
    job.pid === null
      ? `no process after ${seconds} s (job state = ${job.jobState ?? 'unknown'}, last exit code = ${job.lastExit ?? 'none'})`
      : job.pid === before
        ? `pid ${job.pid} is still the old process after ${seconds} s`
        : `pid ${job.pid} is listening on no TCP port after ${seconds} s`;
  return { ok: false, message: `The deploy is built, but ${LABEL} did not come back: ${why}.\n${repair(job)}` };
}

const onHost: Host = {
  kickstart() {
    const uid = process.getuid?.();
    const done = spawnSync('launchctl', ['kickstart', '-k', `gui/${uid}/${LABEL}`], { encoding: 'utf8' });
    return { ok: done.status === 0, detail: (done.stderr || `exit ${done.status}`).trim() };
  },
  job() {
    const uid = process.getuid?.();
    const done = spawnSync('launchctl', ['print', `gui/${uid}/${LABEL}`], { encoding: 'utf8' });
    return done.status === 0 ? done.stdout : null;
  },
  ports(pid) {
    const args = ['-nP', '-a', '-p', String(pid), '-iTCP', '-sTCP:LISTEN', '-Fn'];
    return parsePorts(spawnSync('lsof', args, { encoding: 'utf8' }).stdout ?? '');
  },
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { ok, message } = await restart(onHost);
  (ok ? console.log : console.error)(message);
  process.exit(ok ? 0 : 1);
}
