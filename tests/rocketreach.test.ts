import test from 'node:test';
import assert from 'node:assert/strict';
import { lookupPerson } from '../lib/rocketreach.ts';

test('polls until complete and prefers valid professional email', async () => {
  const calls: string[] = [];
  const fetcher = (async (url: string) => {
    calls.push(url);
    if (url.includes('/person/lookup')) return Response.json({ id: 7, status: 'searching' });
    return Response.json([{ id: 7, status: 'complete', emails: [{ email: 'j@gmail.com', type: 'personal' }, { email: 'jane@acme.com', type: 'professional', smtp_valid: 'valid' }], phones: [{ number: '+44 20 0000 0000' }] }]);
  }) as typeof fetch;
  const r = await lookupPerson({ name: 'Jane Smith', company: 'Acme' }, { fetcher, apiKey: 'k', pollMs: 1 });
  assert.equal(r.status, 'found');
  assert.equal(r.emails[0].email, 'jane@acme.com');
  assert.match(calls[0], /name=Jane\+Smith&current_employer=Acme/);
});

test('reports a missing key instead of throwing', async () => {
  const r = await lookupPerson({ name: 'A' }, { apiKey: '' });
  assert.equal(r.status, 'error');
});
