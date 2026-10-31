// Post-event captures (typed, spoken or card photos) waiting for Claude to turn into people and follow-ups.
import { getOne, listScope, updateEntity } from './bd-store';

export async function openCaptures(limit = 10) {
  return (await listScope('work')).filter(w => w.kind === 'capture' && w.status === 'open')
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).slice(0, limit);
}
export async function captureImages(c: { [k: string]: any }) {
  if (c.images && c.images.length) return c.images;
  if (!c.imagesId) return [];
  const row = await getOne('work', c.imagesId);
  return (row?.images as string[]) || [];
}
export async function captureDone(id: string, note: string) {
  let imagesId = '';
  await updateEntity('work', id, cur => {
    if (cur.kind !== 'capture') throw new Error('No capture with id ' + id);
    imagesId = cur.imagesId || '';
    return { ...cur, images: [], status: 'done', processedAt: new Date().toISOString(), processedNote: note.slice(0, 300) };
  });
  if (imagesId) await updateEntity('work', imagesId, cur => ({ ...cur, images: [], clearedAt: new Date().toISOString() })).catch(() => {});
  return { id, status: 'done' };
}
