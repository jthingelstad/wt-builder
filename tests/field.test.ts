/**
 * A field commits on blur only when its text is an edit of the saved value.
 * A missing value reads as '', the way the field shows it, so an untitled
 * post blurred untouched saves nothing and starts no Micro.blog write-back.
 */

import { describe, expect, it } from 'vitest';

import { edited } from '../src/client/components/Field.tsx';

describe('a blur is an edit only when the text changed', () => {
  it('reads a missing value as the empty field it shows', () => {
    expect(edited(undefined, '')).toBe(false);
    expect(edited(null, '')).toBe(false);
    expect(edited('', '')).toBe(false);
  });

  it('an unchanged value is no edit', () => {
    expect(edited('On the boat', 'On the boat')).toBe(false);
  });

  it('typing into an empty field, clearing a full one, or changing it is an edit', () => {
    expect(edited(undefined, 'On the boat')).toBe(true);
    expect(edited('On the boat', '')).toBe(true);
    expect(edited('On the boat', 'Off the boat')).toBe(true);
  });
});
