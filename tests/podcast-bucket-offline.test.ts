/**
 * Offline (every test), the audio bucket is refused by construction, as the
 * CDN bucket is: config.ts blanks the AWS credentials and points the SDK's
 * files at /dev/null, so an S3 call nobody stubbed fails while it looks for
 * credentials, before a request is signed or sent. This file stubs nothing.
 */

import { describe, expect, it } from 'vitest';

const { OFFLINE } = await import('../src/server/config.ts');
const { headAudio, placeAudio } = await import('../src/server/podcast/bucket.ts');

describe('the audio bucket, offline', () => {
  it('is offline here', () => {
    expect(OFFLINE).toBe(true);
  });

  it('refuses a read and a write for want of credentials', async () => {
    await expect(headAudio('uploads/2025/another-thing-1.mp3')).rejects.toMatchObject({ name: 'CredentialsProviderError' });
    await expect(placeAudio('uploads/2099/another-thing-999.mp3', Buffer.from('x'), true)).rejects.toMatchObject({ name: 'CredentialsProviderError' });
  });
});
