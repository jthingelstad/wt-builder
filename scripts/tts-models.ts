/** Which speech models this account can call, newest first. Ids only; nothing secret printed. */
import { credentials } from '../src/server/config.ts';

const res = await fetch('https://api.openai.com/v1/models', {
  headers: { Authorization: `Bearer ${credentials.openaiKey ?? ''}` },
});
const j = (await res.json()) as { data?: { id: string; created: number }[] };
for (const m of (j.data ?? []).filter((x) => /tts|speech/i.test(x.id)).sort((a, b) => b.created - a.created)) {
  console.log(new Date(m.created * 1000).toISOString().slice(0, 10), m.id);
}
