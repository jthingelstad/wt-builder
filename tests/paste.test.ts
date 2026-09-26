/**
 * Rich text into an editable, Markdown out. No DOM under test, so the tree is
 * a hand-built stand-in with the four properties the walker reads.
 */

import { describe, expect, it } from 'vitest';

import { domToMarkdown, readEditable } from '../src/client/components/Row.tsx';

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

  it('keeps a pasted list as a list and a quote as a quote', () => {
    const tree = el('div', [
      el('p', [text('Three things:')]),
      el('ul', [el('li', [text('One')]), el('li', [text('Two ')]), el('li', [el('a', [text('Three')], { href: 'https://x.test/3' })])]),
      el('ol', [el('li', [text('First')]), el('li', [text('Second')])]),
      el('blockquote', [el('p', [text('Said')]), el('p', [text('twice')])]),
      el('p', [text('After.')]),
    ]);
    expect(md(tree)).toBe('Three things:\n\n- One\n- Two\n- [Three](https://x.test/3)\n\n1. First\n2. Second\n\n> Said\n>\n> twice\n\nAfter.');
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

describe('reading a contenteditable back keeps its paragraphs', () => {
  // Safari wraps every Enter in a <div>; an empty one is the blank line.
  const typed = el('div', [
    text('First paragraph.'),
    el('div', [el('br', [])]),
    el('div', [text('Second paragraph.')]),
  ]);
  const flat = (n: Fake): string => n.nodeType === 3 ? (n.textContent ?? '') : n.childNodes.map(flat).join('');
  const withQuery = (node: Fake) => Object.assign(node, {
    querySelector: () => null,
    textContent: flat(node),
  }) as unknown as HTMLElement;

  it('turns the browser\'s divs into newlines, blank div into a blank line', () => {
    expect(readEditable(withQuery(typed), true)).toBe('First paragraph.\n\nSecond paragraph.');
  });

  // The first line stays a bare text node; only the lines after Enter get a
  // <div>. WT351's numbered list read back as "1. Deep knowledge:2. Wide…".
  it('keeps the line break before the first div Enter made', () => {
    const list = el('div', [
      text('1. Deep knowledge:'),
      el('div', [text('2. Wide knowledge:')]),
      el('div', [text('3. Taste:')]),
    ]);
    expect(readEditable(withQuery(list), true)).toBe('1. Deep knowledge:\n2. Wide knowledge:\n3. Taste:');
  });

  it('a pasted paragraph after loose text is still a paragraph', () => {
    expect(md(el('div', [text('Intro'), el('p', [text('Body')])]))).toBe('Intro\n\nBody');
  });

  it('a single-line field reads as plain text', () => {
    expect(readEditable(withQuery(el('span', [text('one line')])), false)).toBe('one line');
  });
});
