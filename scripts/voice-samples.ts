/**
 * Render the current Membership block in the issue's voice and in a few
 * candidates for Thingy, so a second voice is chosen by ear.
 *
 *   npm run voice:samples -- wt350 [out-dir] [voice ...]
 *
 * Costs a few cents per run. Writes <voice>.mp3 files; prints nothing secret.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import * as store from '../src/server/db.ts';
import { TTS_VOICE, speak } from '../src/server/integrations/audio.ts';
import { flatten } from '../src/shared/render/plan.ts';
import { speakable } from '../src/shared/render/speech.ts';

const [issueId, outDir = 'tmp/voice-samples', ...voices] = process.argv.slice(2);
if (!issueId) {
  console.error('usage: voice-samples <issue-id> [out-dir] [voice ...]');
  process.exit(2);
}
const row = store.getIssue(issueId);
if (!row) {
  console.error(`no issue ${issueId}`);
  process.exit(1);
}
const membership = Object.values(row.doc.items).find((i) => i.type === 'membership' && i.body?.trim());
const text = speakable(flatten(membership?.body)) ||
  'Supporting Members make the Weekly Thing possible while directing every membership dollar to this year\'s nonprofit partner.';

// "voice", "voice@model", "voice@model:instruction words", any with "*0.92" for speed.
const candidates = voices.length ? voices : [TTS_VOICE, 'nova', 'shimmer', 'fable'];
mkdirSync(outDir, { recursive: true });
for (const spec of candidates) {
  const [main, speedText] = spec.split('*') as [string, string | undefined];
  const speed = speedText ? Number(speedText) : undefined;
  const [voice, rest] = main.split('@') as [string, string | undefined];
  const [model, instructions] = rest ? (rest.split(':') as [string, string | undefined]) : [undefined, undefined];
  const line = voice === TTS_VOICE && !model
    ? `${text}`
    : `Hello, this is Thingy. ${text}`;
  const mp3 = await speak(line, { voice, model, instructions, speed });
  const name = [voice, model, instructions ? 'steered' : '', speed ? `x${speed}` : ''].filter(Boolean).join('-');
  const file = join(outDir, `${name}${voice === TTS_VOICE && !model ? '-current' : ''}.mp3`);
  writeFileSync(file, mp3);
  console.log(`${file}  ${(mp3.length / 1024).toFixed(0)} KB`);
}
