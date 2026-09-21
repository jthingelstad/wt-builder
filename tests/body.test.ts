/** Splitting Micro.blog bodies into editable prose and their images. */

import { describe, expect, it } from 'vitest';
import { imageTags, imagesWithoutAlt, rejoinBody, splitBody, withImageAlts } from '../src/shared/body.ts';

const POST = 'Great coffee this morning at [Johnson Public House](https://www.johnsonpublichouse.com). \n\n<img src="https://www.thingelstad.com/uploads/2026/bbe1d53fe0.jpg" width="600" height="450" alt="">';

describe('splitting a post body', () => {
  it('splits a trailing image off the prose', () => {
    const s = splitBody(POST);
    expect(s.prose).toBe('Great coffee this morning at [Johnson Public House](https://www.johnsonpublichouse.com).');
    expect(s.images).toEqual([{ src: 'https://www.thingelstad.com/uploads/2026/bbe1d53fe0.jpg', alt: '' }]);
    expect(s.inline).toBe(false);
  });

  it('round-trips an unedited body', () => {
    const s = splitBody(POST);
    expect(rejoinBody(s.prose, s.tail)).toBe(
      'Great coffee this morning at [Johnson Public House](https://www.johnsonpublichouse.com).\n\n'
      + '<img src="https://www.thingelstad.com/uploads/2026/bbe1d53fe0.jpg" width="600" height="450" alt="">',
    );
  });

  it('keeps the image when the prose is rewritten', () => {
    const s = splitBody(POST);
    expect(rejoinBody('Coffee in Madison.', s.tail)).toContain('<img src=');
  });

  it('reads alt text when the post has it', () => {
    const s = splitBody('Look.\n\n<img src="a.jpg" alt="A boat on the lake">');
    expect(s.images[0]).toEqual({ src: 'a.jpg', alt: 'A boat on the lake' });
  });

  it('splits several trailing images', () => {
    const s = splitBody('Two.\n\n<img src="a.jpg">\n<img src="b.jpg">');
    expect(s.images.map((i) => i.src)).toEqual(['a.jpg', 'b.jpg']);
    expect(s.prose).toBe('Two.');
  });

  it('leaves an inline image alone rather than moving it to the end', () => {
    const s = splitBody('Before <img src="a.jpg"> after.');
    expect(s.inline).toBe(true);
    expect(s.prose).toBe('Before <img src="a.jpg"> after.');
    expect(s.images).toEqual([]);
  });

  it('reports inline when only some images trail', () => {
    const s = splitBody('Mid <img src="a.jpg"> text.\n\n<img src="b.jpg">');
    expect(s.inline).toBe(true);
  });

  it('handles a body with no images', () => {
    expect(splitBody('Just words.')).toEqual({
      prose: 'Just words.', images: [], tail: '', inline: false,
    });
  });

  it('handles an image-only post', () => {
    const s = splitBody('<img src="a.jpg">');
    expect(s.prose).toBe('');
    expect(s.images).toEqual([{ src: 'a.jpg', alt: '' }]);
    expect(rejoinBody('', s.tail)).toBe('<img src="a.jpg">');
  });
});

describe('alt text on the post\'s own image tags', () => {
  const post = [
    'Kicking off the 8th annual Team SPS Kubb Tournament with a quick rules rundown and a 100-person selfie!',
    '',
    '<img src="https://www.thingelstad.com/uploads/2026/a.jpg" width="600" height="450" alt="">',
    "<img src='https://www.thingelstad.com/uploads/2026/b.jpg' alt='Rules on the mic' />",
    '<img src="https://www.thingelstad.com/uploads/2026/c.jpg" loading="lazy">',
  ].join('\n');

  it('reads every tag, inline or trailing, and knows which lack alt text', () => {
    expect(imageTags(post).map((i) => [i.src.slice(-5), i.alt])).toEqual([['a.jpg', ''], ['b.jpg', 'Rules on the mic'], ['c.jpg', '']]);
    expect(imagesWithoutAlt(post).map((i) => i.src.slice(-5))).toEqual(['a.jpg', 'c.jpg']);
    expect(imageTags('no pictures here')).toEqual([]);
    expect(imagesWithoutAlt('Before <img src="x.jpg" alt=""> after.')).toHaveLength(1);
  });

  it('sets the alt inside the exact tag and changes nothing else', () => {
    const out = withImageAlts(post, {
      'https://www.thingelstad.com/uploads/2026/a.jpg': 'Jamie holds a microphone in front of about a hundred people on a plaza',
      'https://www.thingelstad.com/uploads/2026/c.jpg': 'Four winning teams hold wooden kubb batons',
    });
    expect(out).toContain('<img src="https://www.thingelstad.com/uploads/2026/a.jpg" width="600" height="450" alt="Jamie holds a microphone in front of about a hundred people on a plaza">');
    expect(out).toContain("<img src='https://www.thingelstad.com/uploads/2026/b.jpg' alt='Rules on the mic' />");
    expect(out).toContain('<img src="https://www.thingelstad.com/uploads/2026/c.jpg" loading="lazy" alt="Four winning teams hold wooden kubb batons">');
    expect(out.startsWith('Kicking off')).toBe(true);
  });

  it('escapes what an attribute cannot hold, replaces single-quoted alts, and leaves unnamed images alone', () => {
    expect(withImageAlts('<img src="x.jpg" alt="">', { 'x.jpg': 'He said "kubb" & <smiled>' }))
      .toBe('<img src="x.jpg" alt="He said &quot;kubb&quot; &amp; &lt;smiled&gt;">');
    expect(withImageAlts("<img src='x.jpg' alt='old'/>", { 'x.jpg': 'new' })).toBe("<img src='x.jpg' alt=\"new\"/>");
    expect(withImageAlts('<img src="x.jpg">', {})).toBe('<img src="x.jpg">');
    expect(withImageAlts('<img src="x.jpg" alt="keep">', { 'y.jpg': 'other' })).toBe('<img src="x.jpg" alt="keep">');
    expect(withImageAlts('<img src="x.jpg" alt="gone">', { 'x.jpg': '' })).toBe('<img src="x.jpg" alt="">');
  });

  it('round-trips through split and rejoin unchanged', () => {
    const withAlts = withImageAlts(post, { 'https://www.thingelstad.com/uploads/2026/a.jpg': 'A crowd' });
    const split = splitBody(withAlts);
    expect(split.images[0]!.alt).toBe('A crowd');
    expect(rejoinBody(split.prose, split.tail)).toBe(withAlts);
  });
});
