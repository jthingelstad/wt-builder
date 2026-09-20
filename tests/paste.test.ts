/**
 * Rich text into an editable, Markdown out. No DOM under test, so the tree is
 * a hand-built stand-in with the four properties the walker reads.
 */

import { describe, expect, it } from 'vitest';

import { domToMarkdown } from '../src/client/components/Row.tsx';

type Fake = { nodeType: number; textContent?: string; tagName?: string; childNodes: Fake[]; attrs?: Record<string, string>; getAttribute?: (n: string) => string | null };
const text = (t: string): Fake => ({ nodeType: 3, textContent: t, childNodes: [] });
const el = (tag: string, children: Fake[], attrs: Record<string, string> = {}): Fake => ({
  nodeType: 1, tagName: tag.toUpperCase(), childNodes: children, attrs,
  getAttribute: (n) => attrs[n] ?? null,
});
const md = (n: Fake) => domToMarkdown(n as unknown as Node);

describe('a paste from Safari or Notes keeps its links', () => {
  it('turns anchors into Markdown links', () => {
    const tree = el('div', [
      text('I listened to '),
      el('a', [text('this interview')], { href: 'https://www.dwarkesh.com/p/ajeya-cotra' }),
      text(' and found it fascinating.'),
    ]);
    expect(md(tree)).toBe('I listened to [this interview](https://www.dwarkesh.com/p/ajeya-cotra) and found it fascinating.');
  });

  it('keeps emphasis and code, drops images, and flattens Apple\'s non-breaking spaces', () => {
    const tree = el('p', [
      el('b', [text('Bold')]), text('\u00a0and '), el('i', [text('italic')]), text(' and '),
      el('code', [text('x')]), el('img', [], { src: 'https://x/y.jpg' }),
    ]);
    expect(md(tree)).toBe('**Bold** and _italic_ and `x`');
  });

  it('separates paragraphs and honours line breaks', () => {
    const tree = el('div', [el('p', [text('One')]), el('p', [text('Two'), el('br', []), text('three')])]);
    expect(md(tree)).toBe('One\n\nTwo\nthree');
  });

  it('drops a link with no real destination but keeps its words', () => {
    const tree = el('span', [el('a', [text('here')], { href: 'javascript:void(0)' })]);
    expect(md(tree)).toBe('here');
  });
});
