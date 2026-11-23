// Vanor Live calendar (23 Nov 2026): a mirror of the partners' Outlook calendars, written by Claude (MCP calendar_sync)
// because the site itself has no mailbox access. One record per partner (calendar:<owner>), replaced on every sync.
// Released holds and other "free" placeholders are dropped; tentative holds stay, marked as holds.
import { updateEntity } from './bd-store';

export type CalEvent = { id: string; subject: string; start: string; end?: string; location?: string; attendees?: { name?: string; email?: string }[]; showAs?: string; link?: string; organizer?: string; allDay?: boolean };
const keepable = (e: CalEvent) => e.showAs !== 'free' && !/hold released/i.test(e.subject || '') && !Number.isNaN(Date.parse(e.start));

export function cleanEvents(events: CalEvent[]) {
  const seen = new Set<string>();
  return events.filter(keepable).filter(e => (seen.has(e.id) ? false : (seen.add(e.id), true))).map(e => ({
    id: String(e.id).slice(0, 300), subject: String(e.subject || '(no title)').trim().slice(0, 200), start: e.start, end: e.end || '',
    location: String(e.location || '').slice(0, 200), showAs: e.showAs || 'busy', link: /^https:\/\//.test(e.link || '') ? String(e.link).slice(0, 600) : '',
    organizer: String(e.organizer || '').slice(0, 160), allDay: !!e.allDay,
    hold: /^(vanor )?hold\b/i.test(String(e.subject || '').trim()) || e.showAs === 'tentative',
    attendees: (e.attendees || []).slice(0, 20).map(a => ({ name: String(a.name || '').slice(0, 120), email: String(a.email || '').toLowerCase().slice(0, 160) })),
  })).sort((a, b) => a.start.localeCompare(b.start)).slice(0, 300);
}

/** Replace one partner's calendar mirror for the window [from, to]. */
export async function syncCalendar(owner: 'Barry' | 'Graeme', from: string, to: string, events: CalEvent[]) {
  const clean = cleanEvents(events);
  await updateEntity('work', 'calendar:' + owner.toLowerCase(), cur => ({ ...cur, kind: 'calendar', owner, from, to, events: clean, syncedAt: new Date().toISOString() }), true);
  return { owner, kept: clean.length, dropped: events.length - clean.length };
}
