import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeDraft, templateMap, renderTemplate, DEFAULT_TEMPLATES } from '../lib/outreach-logic.ts';

const r = { id: 'r1', name: 'Jane Smith', company: 'Acme Developments', email: 'jane@acme.com', kind: 'contact' } as any;

test('renderTemplate fills placeholders and blanks unknown ones', () => {
  const out = renderTemplate({ subject: 'Hi {first}', body: 'At {company}. {missing}\n\n\n\nEnd' }, { first: 'Jane', company: 'Acme' });
  assert.equal(out.subject, 'Hi Jane'); assert.equal(out.body, 'At Acme. \n\nEnd');
});
test('founder override replaces default body, keeps label', () => {
  const m = templateMap([{ key: 'chase1', body: 'Hi {first}, nudge.' }]);
  assert.equal(m.get('chase1')!.body, 'Hi {first}, nudge.'); assert.equal(m.get('chase1')!.label, DEFAULT_TEMPLATES.find(t => t.key === 'chase1')!.label);
  const d = composeDraft({ r, warm: false, cell: 'A1', lastSentDaysAgo: 5, touches: 1, segment: 'developer', templates: m });
  assert.equal(d!.body, 'Hi Jane, nudge.'); assert.equal(d!.template, 'chase1');
});
test('touch windows: chase1 day 4+, chase2 day 9-20 after two sends, nothing after three', () => {
  assert.equal(composeDraft({ r, warm: false, cell: 'A1', lastSentDaysAgo: 2, touches: 1, segment: 'developer' }), null);
  assert.equal(composeDraft({ r, warm: false, cell: 'A1', lastSentDaysAgo: 5, touches: 1, segment: 'developer' })!.template, 'chase1');
  assert.equal(composeDraft({ r, warm: false, cell: 'A1', lastSentDaysAgo: 5, touches: 2, segment: 'developer' }), null);
  assert.equal(composeDraft({ r, warm: false, cell: 'A1', lastSentDaysAgo: 12, touches: 2, segment: 'developer' })!.template, 'chase2');
  assert.equal(composeDraft({ r, warm: false, cell: 'A1', lastSentDaysAgo: 12, touches: 3, segment: 'developer' }), null);
});
test('first approach uses template and week commencing', () => {
  const d = composeDraft({ r, warm: false, cell: 'A1', segment: 'developer' })!;
  assert.equal(d.template, 'first_approach'); assert.match(d.body, /w\/c \d+/); assert.match(d.body, /Hi Jane/);
});

test('a hiring lead with an email gets the capacity template with the role named', async () => {
  const { composeDraft } = await import('../lib/outreach-logic.ts');
  const r = { id: 'x', name: 'Managing Director', company: 'Cast Consultancy', email: 'md@cast.example', title: 'Cast Consultancy hiring: Associate Director Project Management', intel: { stage: 'hiring' }, fitSector: 'developer' };
  const d = composeDraft({ r, warm: false, cell: 'A2', segment: 'consultancy' });
  assert.ok(d && d.template === 'capacity');
  assert.match(d!.body, /looking for an Associate Director Project Management/);
  assert.match(d!.subject, /senior capacity while you recruit/);
});
