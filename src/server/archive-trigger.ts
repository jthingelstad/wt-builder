/** The operator supplies a real workflow run receipt before the nudge can retire.
 * This validates its shape, not its history: Jamie verifies the linked natural
 * send and destination arrival before setting either variable. Default is nudge.
 */
export function archiveTrigger(mode: string | undefined, proof: string | undefined, bus: string, repo: string): 'bus' | 'nudge' {
  if (mode !== 'bus' || !bus || !proof) return 'nudge';
  try {
    const url = new URL(proof);
    return url.origin === 'https://github.com' && !url.username && !url.password && !url.search && !url.hash &&
      new RegExp(`^/${repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/actions/runs/[1-9][0-9]*$`).test(url.pathname)
      ? 'bus' : 'nudge';
  } catch { return 'nudge'; }
}

/** A bus command is the archive leg's delivery, so its acknowledgement is
 * required before recording success. Other legs' announcements remain optional.
 * Never retry a timed-out published command here; the archive round is idempotent.
 */
export async function deliverArchiveTrigger(mode: 'bus' | 'nudge', number: number, deps: {
  dispatch: () => Promise<void>;
  publish: () => Promise<string | null>;
}): Promise<string> {
  if (mode === 'nudge') {
    await deps.dispatch();
    return `issue-sent ${number}`;
  }
  const eventId = await deps.publish();
  if (!eventId) throw new Error('The publishing bus did not acknowledge the archive trigger; check the bus before sending this leg again.');
  return `publishing-bus ${eventId}`;
}
