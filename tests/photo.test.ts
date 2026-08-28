/** Reading what the camera recorded off a dropped photo. */

import { describe, expect, it } from 'vitest';
import sharp from 'sharp';

import { dms, readExif } from '../src/server/integrations/images.ts';

/** A JPEG carrying the fields a phone camera actually writes. */
async function photo() {
  return sharp({ create: { width: 2400, height: 1600, channels: 3, background: '#3a6ea5' } })
    .withExif({
      IFD0: { Make: 'Apple', Model: 'iPhone 15 Pro' },
      IFD2: { DateTimeOriginal: '2026:08:24 17:31:22' },
      IFD3: {
        GPSLatitude: '44/1 21/1 3204/100',
        GPSLatitudeRef: 'N',
        GPSLongitude: '93/1 22/1 1800/100',
        GPSLongitudeRef: 'W',
      },
    })
    .jpeg()
    .toBuffer();
}

describe('degrees, minutes, seconds', () => {
  it('converts a northern latitude', () => {
    expect(dms([44, 21, 32.04], 'N')).toBeCloseTo(44.3589, 4);
  });

  it('makes west and south negative', () => {
    expect(dms([93, 22, 18], 'W')).toBeCloseTo(-93.37167, 4);
    expect(dms([44, 21, 32.04], 'S')).toBeCloseTo(-44.3589, 4);
  });

  it('returns null rather than a wrong coordinate', () => {
    expect(dms(undefined, 'N')).toBeNull();
    expect(dms([44, 21], 'N')).toBeNull();
    expect(dms(['x', 'y', 'z'], 'N')).toBeNull();
  });
});

describe('reading a photo', () => {
  it('takes the time from the camera, not the file', async () => {
    const meta = await sharp(await photo()).metadata();
    const read = readExif(meta.exif!);
    // The file's modified time is when it was copied; this is when it was taken.
    expect(read.takenAt).toBe('2026-08-24T17:31:22');
  });

  it('reads coordinates, and does not invent a place name', async () => {
    const meta = await sharp(await photo()).metadata();
    const read = readExif(meta.exif!);
    // Cannon Lake, Minnesota — but naming it needs a geocoder this service
    // does not have, and a wrong place name in print is worse than none.
    expect(read.coordinates).toBe('44.35890, -93.37167');
  });

  it('survives a photo with no readable EXIF', () => {
    expect(readExif(Buffer.from('not exif'))).toEqual({});
  });
});
