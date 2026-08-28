/** Splitting Micro.blog bodies into editable prose and their images. */

import { describe, expect, it } from 'vitest';
import { rejoinBody, splitBody } from '../src/shared/body.ts';

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
