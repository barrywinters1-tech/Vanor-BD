// Daily JSON snapshot of the whole workspace into the private Supabase "backups" bucket; keeps the last 30.
import { fullBackup } from './bd-store';
import { serviceClient } from './supabase/server';

export async function runBackup(keep = 30) {
  const backup = await fullBackup();
  const name = `vanor-bd-${backup.exportedAt.slice(0, 10)}.json`;
  const storage = serviceClient().storage.from('backups');
  const { error } = await storage.upload(name, JSON.stringify(backup), { contentType: 'application/json', upsert: true });
  if (error) throw error;
  const { data: files } = await storage.list('', { limit: 1000, sortBy: { column: 'name', order: 'desc' } });
  const old = (files || []).filter(f => f.name.startsWith('vanor-bd-')).slice(keep).map(f => f.name);
  if (old.length) await storage.remove(old);
  return { saved: name, records: backup.records.length, work: backup.work.length, pruned: old.length };
}
