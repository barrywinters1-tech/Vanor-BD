// Pure funnel definitions (no database imports) so tests and the browser share one mapping.
export const STEPS = ['sent', 'reply', 'meeting_booked', 'meeting_held', 'proposal', 'won'] as const;
export type Step = typeof STEPS[number];
export const STEP_LABEL: Record<Step, string> = { sent: 'Outreach sent', reply: 'Reply received', meeting_booked: 'Meeting booked', meeting_held: 'Meeting held', proposal: 'Proposal sent', won: 'Won' };
const TYPE_PREFIX = 'Outcome: ';


/** Board events that count as funnel steps: Claude-logged outcomes plus the founders' own "Record outcome" entries. */
export function stepOf(e: { type?: unknown; [key: string]: unknown }): Step | null {
  const t = String(e.type || '');
  if (t.startsWith(TYPE_PREFIX)) return STEPS.includes(t.slice(TYPE_PREFIX.length) as Step) ? t.slice(TYPE_PREFIX.length) as Step : null;
  if (t === 'Meeting held') return 'meeting_held';
  if (t === 'Meeting arranged') return 'meeting_booked';
  if (t === 'Commercial discussion') return 'proposal';
  if (t === 'Interaction: email out') return 'sent';
  if (t === 'Interaction: email in') return 'reply';
  if (t === 'Interaction: meeting') return 'meeting_held';
  return null;
}
