import type { Channel, IssueDoc } from '../types.ts';
import { renderWebsite } from './website.ts';
import { renderEmail } from './email.ts';
import { renderAudio } from './audio.ts';
import { renderSource } from './source.ts';

export * from './plan.ts';
export * from './website.ts';
export * from './email.ts';
export * from './audio.ts';
export * from './source.ts';

export type Lens = Channel | 'source';

/** Render any lens from the same canonical items. */
export function render(doc: IssueDoc, lens: Lens): string {
  switch (lens) {
    case 'website': return renderWebsite(doc);
    case 'email': return renderEmail(doc);
    case 'audio': return renderAudio(doc);
    case 'source': return renderSource(doc);
  }
}
