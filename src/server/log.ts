/**
 * The service log: launchd's stdout and stderr
 * (~/Library/Logs/wt-builder/wt-builder.{log,err}). It holds what the event
 * log does not: raw errors, model replies, MCP calls, the edge's refusals.
 * Every line starts with its UTC instant and level, so it lines up with the
 * event log; a line about an issue names it after the tag ("[draft] wt353
 * …"), and one that goes with an event names it ("event 1512").
 *
 *   2026-10-11T10:48:32.995Z WARN  [draft] wt353 Haiku: 429 Too Many Requests (event 1601)
 */

type Level = 'INFO' | 'WARN' | 'ERROR';

export function line(level: Level, text: string, now = new Date()): string {
  return `${now.toISOString()} ${level.padEnd(5)} ${text}`;
}

export const log = {
  info: (text: string) => console.log(line('INFO', text)),
  warn: (text: string) => console.warn(line('WARN', text)),
  error: (text: string) => console.error(line('ERROR', text)),
};
