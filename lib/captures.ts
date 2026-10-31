// Post-event captures (typed, spoken or card photos) waiting for Claude to turn into people and follow-ups.
import { listScope, updateEntity } from './bd-store';

export async function openCaptures(limit = 10) {
  return (await listScope('work')).filter(w => w.kind === 'capture' && w.status === 'open')
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).slice(0, limit);
}
export async function captureDone(id: string, note: string) {
  await updateEntity('work', id, cur => {
    if (cur.kind !== 'capture') throw new Error('No capture with id ' + id);
    return { ...cur, status: 'done', processedAt: new Date().toISOString(), processedNote: note.slice(0, 300) };
  });
  return { id, status: 'done' };
}
