/**
 * The drafting paths end to end, with the model and every service stubbed:
 * the Anthropic client, the Librarian, Pinboard, and fetch. Nothing here
 * reaches the network, and no model is ever called.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { IssueDoc } from '../src/shared/types.ts';

const { create, retrieve } = vi.hoisted(() => ({ create: vi.fn(), retrieve: vi.fn() }));

vi.mock('@anthropic-ai/sdk', () => {
  class Anthropic {
    messages = { create };
  }
  return { default: Anthropic };
});

vi.mock('../src/server/integrations/librarian.ts', () => ({
  isConfigured: () => true,
  retrieve,
}));

vi.mock('../src/server/integrations/pinboard.ts', () => ({
  recentCommentary: vi.fn(async () => []),
}));

const { draft, thingySentences } = await import('../src/server/editorial.ts');

const fixture = () =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL('../fixtures/representative-issue.json', import.meta.url)), 'utf8'),
  ) as IssueDoc;

/** A model answer: structured output as one text block. */
const reply = (body: unknown, stop_reason = 'end_turn') => ({
  stop_reason,
  stop_details: null,
  content: [{ type: 'text', text: JSON.stringify(body) }],
});

beforeEach(() => {
  create.mockReset();
  retrieve.mockReset();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Echoes drafts carry their grounding', () => {
  const passages = [
    { issue_number: 221, publish_date: '2023-05-20', url: 'https://weekly.thingelstad.com/archive/221/', text: 'The boat went in.' },
  ];
  const offered = {
    echoes: [
      {
        text: 'The boat went in, as in [WT221](https://weekly.thingelstad.com/archive/221/).',
        archive_references: [{ kind: 'issue', issue: 221, url: 'https://weekly.thingelstad.com/archive/221/' }],
        ask: 'When does the boat go in?',
      },
      {
        text: 'Invented: [WT199](https://weekly.thingelstad.com/archive/199/).',
        archive_references: [{ kind: 'issue', issue: 199, url: 'https://weekly.thingelstad.com/archive/199/' }],
        ask: 'What was in 199?',
      },
    ],
  };

  it('the section wand flags an ungrounded echo and still offers it', async () => {
    retrieve.mockResolvedValue(passages);
    create.mockResolvedValue(reply(offered));
    const out = await draft({ doc: fixture(), nodeId: 'echoes' });
    expect(out.echoes).toHaveLength(2);
    expect(out.echoes![0]!.grounding).toEqual({ flags: [] });
    expect(out.echoes![1]!.grounding!.flags).toEqual(['WT199 is not among the passages the archive returned']);
  });

  it('the per-echo redraft is checked the same way', async () => {
    retrieve.mockResolvedValue(passages);
    create.mockResolvedValue(reply(offered));
    const out = await draft({ doc: fixture(), itemId: 'echo-building' });
    expect(out.echoes).toHaveLength(2);
    expect(out.echoes![1]!.grounding!.flags).toEqual(['WT199 is not among the passages the archive returned']);
  });

  it('the seasonal issue counts as retrieved', async () => {
    retrieve.mockResolvedValue(passages);
    create.mockResolvedValue(reply(offered));
    const out = await draft({
      doc: fixture(), nodeId: 'echoes',
      seasonal: { number: 199, title: 'WT199', publication_date: '2025-05-24', excerpt: 'A year ago.' },
    });
    expect(out.echoes![1]!.grounding).toEqual({ flags: [] });
  });
});

describe('Thingy\'s words never come back as Jamie\'s archive', () => {
  const thingyEcho = "This week's return to building recalls earlier issues about owning the tools that shape your work, most directly WT349.";
  const passages = [
    { issue_number: 351, publish_date: '2026-09-26', url: 'https://weekly.thingelstad.com/archive/351/', text: `Echoes. ${thingyEcho}` },
    { issue_number: 221, publish_date: '2023-05-20', url: 'https://weekly.thingelstad.com/archive/221/', text: 'The boat went in on a grey morning.' },
  ];
  const prompt = () => String(create.mock.calls[0]![0].messages[0].content);

  it('Echoes drafts from the passages minus Thingy\'s', async () => {
    retrieve.mockResolvedValue(passages);
    create.mockResolvedValue(reply({ echoes: [] }));
    const doc = fixture();
    doc.issue.number = 360;
    doc.issue.publication_date = '2026-11-28';
    await draft({ doc, nodeId: 'echoes', thingy: thingySentences([fixture()]) });
    expect(prompt()).toContain('The boat went in on a grey morning.');
    expect(prompt()).not.toContain('owning the tools that shape your work, most directly WT349');
  });

  it('the link wand does not call Thingy\'s words what Jamie has written before', async () => {
    retrieve.mockResolvedValue(passages);
    create.mockResolvedValue(reply({ candidates: ['one', 'two'] }));
    await draft({ doc: fixture(), itemId: 'link-flipcash', thingy: thingySentences([fixture()]) });
    expect(prompt()).toContain('WT221: The boat went in');
    expect(prompt()).not.toContain('owning the tools that shape your work, most directly WT349');
  });
});
