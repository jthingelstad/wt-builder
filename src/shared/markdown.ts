/**
 * Markdown to safe HTML for the canvas, the draft-share page, and the HTML
 * inside Thingy's email frame.
 *
 * CommonMark, via markdown-it: the website (Hugo) and Buttondown both render
 * the issue's Markdown as CommonMark, so this does too, and a structure that
 * reads one way to a reader reads the same way on the canvas. It replaced a
 * hand-rolled renderer that disagreed with both — it ran a quoted list into
 * one paragraph (WT351).
 *
 * Raw HTML is escaped, except img, anchor, and br elements, which are
 * sanitized and kept (Micro.blog bodies carry their photos as <img>).
 */

import MarkdownIt from 'markdown-it';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeUrl(value: string, image = false): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.href;
    if (!image && url.protocol === 'mailto:') return url.href;
  } catch { /* escaped text is safer than a guessed URL */ }
  return null;
}

function attribute(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function sanitizedImage(src: string, alt = '', tag = ''): string {
  const url = safeUrl(src, true);
  if (!url) return escapeHtml(tag || `![${alt}](${src})`);
  const width = attribute(tag, 'width');
  const height = attribute(tag, 'height');
  const dimensions = [
    width && /^\d+$/.test(width) ? ` width="${width}"` : '',
    height && /^\d+$/.test(height) ? ` height="${height}"` : '',
  ].join('');
  return `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}"${dimensions}>`;
}

function protectRichElements(source: string): { text: string; tokens: string[] } {
  const tokens: string[] = [];
  const keep = (html: string) => {
    const token = `\uE000${tokens.length}\uE001`;
    tokens.push(html);
    return token;
  };

  let text = source.replace(/<img\b[^>]*>/gi, (tag) =>
    keep(sanitizedImage(attribute(tag, 'src') ?? '', attribute(tag, 'alt') ?? '', tag)));
  text = text.replace(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/gi, (_all, alt, src) =>
    keep(sanitizedImage(src, alt)));
  text = text.replace(/<a\b[^>]*href\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>(.*?)<\/a>/gis,
    (tag, double, single, label) => {
      const url = safeUrl(double ?? single ?? '');
      return url
        ? keep(`<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(label.replace(/<[^>]*>/g, ''))}</a>`)
        : escapeHtml(tag);
    });
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|mailto:[^)\s]+)\)/gi, (_all, label, href) => {
    const url = safeUrl(href);
    return url
      ? keep(`<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`)
      : escapeHtml(_all);
  });
  text = text.replace(/<br\s*\/?\s*>/gi, () => keep('<br>'));
  return { text, tokens };
}

const md = new MarkdownIt('commonmark', { html: false, linkify: false, typographer: false });

// Links open outside the editor; only http(s) and mailto survive.
md.validateLink = (url) => safeUrl(url) !== null || safeUrl(url, true) !== null;
md.renderer.rules.link_open = (tokens, i, options, _env, self) => {
  tokens[i]!.attrSet('target', '_blank');
  tokens[i]!.attrSet('rel', 'noreferrer');
  return self.renderToken(tokens, i, options);
};
// A soft line break is a space, as it is to a reader. The canvas shows
// rendered prose under white-space: pre-wrap, where "\n" would be a line.
md.renderer.rules.softbreak = () => ' ';

/** The protected elements go back in after rendering; the placeholders are plain text to markdown-it. */
const restore = (html: string, tokens: string[]) =>
  html.replace(/\uE000(\d+)\uE001/g, (_all, index) => tokens[Number(index)] ?? '');

export function markdownInlineToSafeHtml(source: string): string {
  const { text, tokens } = protectRichElements(String(source ?? ''));
  return restore(md.renderInline(text), tokens);
}

export function markdownToSafeHtml(source: string): string {
  const { text, tokens } = protectRichElements(String(source ?? '').replace(/\r\n/g, '\n'));
  const html = md.render(text)
    // Between block tags only: the newlines markdown-it writes for source
    // readability would show as blank lines in a pre-wrap container.
    .replace(/>\n+(?=<)/g, '>')
    .replace(/\n+(?=<\/?(?:ul|ol|li|p|blockquote|h[1-6]|pre|hr)\b)/g, '')
    .trim();
  return restore(html, tokens);
}
