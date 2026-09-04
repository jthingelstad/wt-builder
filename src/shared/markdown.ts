/**
 * Small, deliberately bounded Markdown renderer for the editing canvas.
 *
 * The server still owns canonical Markdown output. This exists only so the
 * Website and Email lenses show links and images as a reader will see them.
 * Raw HTML is escaped except for sanitized img, anchor, and br elements.
 */

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

export function markdownInlineToSafeHtml(source: string): string {
  const { text, tokens } = protectRichElements(String(source ?? ''));
  let html = escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/(^|\s)_([^_]+)_(?=\s|$|[.,!?])/g, '$1<em>$2</em>')
    .replace(/  \n/g, '<br>')
    .replace(/\n/g, ' ');
  html = html.replace(/\uE000(\d+)\uE001/g, (_all, index) => tokens[Number(index)] ?? '');
  return html;
}

export function markdownToSafeHtml(source: string): string {
  const lines = String(source ?? '').replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  let ordered: string[] = [];
  let orderedStart = 1;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    out.push(`<p>${markdownInlineToSafeHtml(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!list.length) return;
    out.push(`<ul>${list.map((line) => `<li>${markdownInlineToSafeHtml(line)}</li>`).join('')}</ul>`);
    list = [];
  };
  const flushOrdered = () => {
    if (!ordered.length) return;
    const start = orderedStart === 1 ? '' : ` start="${orderedStart}"`;
    out.push(`<ol${start}>${ordered.map((line) => `<li>${markdownInlineToSafeHtml(line)}</li>`).join('')}</ol>`);
    ordered = [];
  };

  for (const line of lines) {
    if (!line.trim()) {
      flushParagraph();
      flushList();
      flushOrdered();
      continue;
    }
    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    const bullet = /^[-*]\s+(.+)$/.exec(line);
    const numbered = /^(\d{1,9})[.)]\s+(.+)$/.exec(line);
    const quote = /^>\s?(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      flushOrdered();
      const level = Math.min(4, heading[1]!.length + 1);
      out.push(`<h${level}>${markdownInlineToSafeHtml(heading[2]!)}</h${level}>`);
    } else if (bullet) {
      flushParagraph();
      flushOrdered();
      list.push(bullet[1]!);
    } else if (numbered && (!paragraph.length || numbered[1] === '1')) {
      // As in CommonMark, only "1." may interrupt a paragraph — a line
      // beginning "2003." mid-prose is a sentence, not a list.
      flushParagraph();
      flushList();
      if (!ordered.length) orderedStart = Number(numbered[1]!);
      ordered.push(numbered[2]!);
    } else if (quote) {
      flushParagraph();
      flushList();
      flushOrdered();
      out.push(`<blockquote>${markdownInlineToSafeHtml(quote[1]!)}</blockquote>`);
    } else {
      flushList();
      flushOrdered();
      paragraph.push(line.trim());
    }
  }
  flushParagraph();
  flushList();
  flushOrdered();
  return out.join('');
}

