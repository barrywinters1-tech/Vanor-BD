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
  if (t === 'Interaction: note') {
    const n = String(e.note || '').toLowerCase();
    if (n.startsWith('meeting booked')) return 'meeting_booked';
    if (n.startsWith('proposal sent')) return 'proposal';
    if (n.startsWith('won:')) return 'won';
  }
  return null;
}

/** What the numbers say, in plain lines. Only speaks when there is enough data (5+ sends in a bucket); says so otherwise. Never auto-tunes: the founders decide. */
export function lessons(byTemplate: Array<{ template: string; sent: number; replies: number; replyRate: number | null }>, byTrigger: Array<{ trigger: string; sent: number; replies: number; replyRate: number | null }>): string[] {
  const out: string[] = [];
  const enough = <R extends { sent: number; replyRate: number | null }>(rows: R[]) => rows.filter(r => r.sent >= 5 && r.replyRate !== null);
  const t = enough(byTemplate).sort((a, b) => (b.replyRate! - a.replyRate!));
  if (t.length >= 2) out.push(`Templates: "${t[0].template}" is replying at ${t[0].replyRate}% (${t[0].sent} sent) against "${t[t.length - 1].template}" at ${t[t.length - 1].replyRate}% (${t[t.length - 1].sent} sent). Use more of the first; rewrite or retire the second.`);
  else if (byTemplate.length) out.push(`Templates: too few sends per template to judge yet (need 5+). ${byTemplate.map(x => `${x.template} ${x.sent}`).join(', ')}.`);
  const g = enough(byTrigger).sort((a, b) => (b.replyRate! - a.replyRate!));
  if (g.length >= 2) out.push(`Triggers: "${g[0].trigger}" replies at ${g[0].replyRate}%, "${g[g.length - 1].trigger}" at ${g[g.length - 1].replyRate}%. Weight the Signals feed towards the first.`);
  const zero = byTemplate.filter(x => x.sent >= 8 && x.replies === 0);
  for (const z of zero) out.push(`"${z.template}" has ${z.sent} sends and no reply: stop using it until it is rewritten.`);
  return out;
}
