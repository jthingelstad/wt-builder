/**
 * Micro.blog post bodies are Markdown with raw `<img>` tags embedded — that is
 * what the Micropub source endpoint returns, and it is what write-back has to
 * hand back. The tags are content, not markup we control.
 *
 * The canvas has to show the words as editable text and the picture as a
 * picture. Putting the raw tag in a `contenteditable` shows angle brackets to
 * Jamie; dropping it loses the image on write-back. So the two are split for
 * display and rejoined on commit.
 */

const IMG = /<img\b[^>]*>/gi;
const SRC = /\bsrc=["']([^"']+)["']/i;
const ALT = /\balt=["']([^"']*)["']/i;

export interface SplitBody {
  /** The prose, with trailing image tags removed. What Jamie edits. */
  prose: string;
  /** The images that were split off, in document order. */
  images: { src: string; alt: string }[];
  /**
   * The exact trailing text that was removed, so `rejoin` restores the body
   * byte-for-byte when the prose is unchanged.
   */
  tail: string;
  /**
   * True when an image sits inside the prose rather than after it. Splitting
   * would move it, so the caller leaves the body alone and edits it raw.
   */
  inline: boolean;
}

/**
 * Split trailing `<img>` tags off a body.
 *
 * Only *trailing* images are split. A Micro.blog photo post is prose, a blank
 * line, then the image — the shape this handles. An image in the middle of a
 * sentence would be moved to the end by a naive split, so that case is left
 * intact and reported as `inline`.
 */
export function splitBody(body: string | undefined): SplitBody {
  const text = String(body ?? '');
  const matches = [...text.matchAll(IMG)];
  if (!matches.length) return { prose: text, images: [], tail: '', inline: false };

  // Walk back from the end over image tags and whitespace.
  let cut = text.length;
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i]!;
    const start = m.index!;
    const end = start + m[0].length;
    if (text.slice(end, cut).trim() !== '') break;
    cut = start;
  }

  const tail = text.slice(cut);
  const trailing = [...tail.matchAll(IMG)];
  if (!trailing.length) return { prose: text, images: [], tail: '', inline: true };

  return {
    prose: text.slice(0, cut).trimEnd(),
    images: trailing.map((m) => ({
      src: SRC.exec(m[0])?.[1] ?? '',
      alt: ALT.exec(m[0])?.[1] ?? '',
    })),
    tail,
    inline: trailing.length < matches.length,
  };
}

/** Put an edited prose run back together with the images it was split from. */
export function rejoinBody(prose: string, tail: string): string {
  if (!tail) return prose;
  const trimmed = prose.trimEnd();
  return trimmed ? `${trimmed}\n\n${tail.trim()}` : tail.trim();
}

// ── alt text ──────────────────────────────────────────────────────────────
//
// Micro.blog stores a photo post's pictures as `<img src … alt="">` — the
// alt is empty unless Jamie typed one at posting time, and he rarely does
// from the phone. WT350 shipped 11 of 12 Journal images without alt text
// (Buttondown said so). The wand writes an alt per image from the picture
// itself; these helpers read the tags and put the alt back into the exact
// tag so the body — the source mirror — carries it to the blog on write-back,
// and the site and the email get it through the same body (2026-09-20).

export interface ImageTag {
  /** The tag as it appears in the body. */
  tag: string;
  src: string;
  alt: string;
}

/** Every `<img>` in a body, in document order — inline or trailing. */
export function imageTags(body: string | undefined): ImageTag[] {
  return [...String(body ?? '').matchAll(IMG)].map((m) => ({
    tag: m[0],
    src: SRC.exec(m[0])?.[1] ?? '',
    alt: ALT.exec(m[0])?.[1] ?? '',
  }));
}

/** The images in a body that have no alt text — what the reader who cannot see them is missing. */
export function imagesWithoutAlt(body: string | undefined): ImageTag[] {
  return imageTags(body).filter((i) => i.src && !i.alt.trim());
}

function attrValue(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * The body with each image's alt set, by src. A tag with an `alt` gets its
 * value replaced; one without gets ` alt="…"` before its close. Every other
 * byte of the tag — width, height, loading, the quoting style — is kept, so
 * the blog gets its own markup back with one attribute changed. Images not
 * named in `alts` are untouched; an empty alt is written as empty.
 */
export function withImageAlts(body: string | undefined, alts: Record<string, string>): string {
  return String(body ?? '').replace(IMG, (tag) => {
    const src = SRC.exec(tag)?.[1];
    if (!src || !(src in alts)) return tag;
    const value = attrValue(String(alts[src] ?? '').replace(/\s+/g, ' ').trim());
    if (/\balt=/i.test(tag)) {
      return tag.replace(/\balt=(?:"[^"]*"|'[^']*'|[^\s>]*)/i, `alt="${value}"`);
    }
    return tag.replace(/\s*(\/?)>$/, ` alt="${value}"$1>`);
  });
}
