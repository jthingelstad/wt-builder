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
