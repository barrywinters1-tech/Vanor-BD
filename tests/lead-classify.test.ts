import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyLead, isLeadWorthy, sizeOf, valueBand } from '../lib/lead-classify.ts';

test('press: planning granted, residential, London, units and value', () => {
  const l = classifyLead('Berkeley wins planning for 450-home Kidbrooke scheme. The £180m development in Greenwich was approved by councillors last night.');
  assert.equal(l.stage, 'granted'); assert.equal(l.sector, 'residential'); assert.equal(l.region, 'London');
  assert.equal(l.size.units, 450); assert.equal(l.size.valueM, 180); assert.equal(l.valueBand, '£100m+'); assert.ok(l.isLarge); assert.ok(isLeadWorthy(l));
});
test('press: funding secured names the funder', () => {
  const l = classifyLead('Watkin Jones secures £65m development loan from OakNorth Bank for 600-bed student scheme in Leeds');
  assert.equal(l.stage, 'funded'); assert.equal(l.sector, 'pbsa'); assert.equal(l.region, 'Yorkshire'); assert.equal(l.size.beds, 600);
  assert.match(l.parties.funder || '', /OakNorth/);
});
test('press: contractor appointed', () => {
  const l = classifyLead('McLaren Construction has been appointed to build a 200-key hotel in Manchester for Dominvs Group');
  assert.equal(l.stage, 'contractor_appointed'); assert.equal(l.sector, 'hotel'); assert.equal(l.size.keys, 200); assert.match(l.parties.contractor || '', /McLaren/);
});
test('press: people move and generic news are not leads', () => {
  assert.equal(isLeadWorthy(classifyLead('Landsec appoints new head of development')), false);
  assert.equal(isLeadWorthy(classifyLead('Why offices are back in fashion: our columnist on the return to work')), false);
});
test('planning hint drives stage', () => {
  const l = classifyLead('Erection of a 12-storey building comprising 140 residential units and ground floor retail', { appState: 'Permitted', authority: 'Southwark', appSize: 'Large' });
  assert.equal(l.stage, 'granted'); assert.equal(l.size.units, 140); assert.equal(l.size.storeys, 12); assert.equal(l.parties.authority, 'Southwark');
});
test('value bands from size when no £', () => {
  assert.equal(valueBand(sizeOf('80 homes')), '£20m–£50m'); assert.equal(valueBand(sizeOf('a new shop')), 'Value unknown');
});
import { sellability } from '../lib/lead-classify.ts';
test('sellability: funded scheme at a named developer beats a winding-up petition against an unknown Ltd', () => {
  const funded = classifyLead('Watkin Jones secures £65m development loan from OakNorth Bank for 600-bed student scheme in Leeds');
  const petition = classifyLead('Petition to wind up: HAZELBY EVANS DEVELOPMENTS LTD. Petition to wind up notice in The Gazette.');
  const a = sellability(funded, 'lender', 'x', new Date().toISOString()), b = sellability(petition, 'developer', 'x', new Date().toISOString());
  assert.ok(a.score > b.score + 30); assert.equal(a.tier, 'Hot'); assert.equal(b.tier, 'Watch');
  const c = sellability(petition, 'developer', 'x', new Date().toISOString(), { knownContacts: 2 });
  assert.ok(c.score > b.score);
});

test('architects named as the actor are not the developer', async () => {
  const { partiesOf, classifyLead } = await import('../lib/lead-classify.ts');
  const p = partiesOf('Gensler unveils towers to replace Birmingham’s House of Fraser store. Gensler has designed two residential towers of 1,000 homes.');
  assert.equal(p.developer, undefined);
  const q = classifyLead('Allies and Morrison adds up to 1,500 more homes to Croydon masterplan');
  assert.equal(q.parties.developer, undefined);
});

test('lanes: one word per person from the shared module', async () => {
  // @ts-ignore plain script that sets a global
  await import('../public/vanor-priority.js');
  const P = (globalThis as any).VanorPriority;
  const now = Date.parse('2026-10-13');
  const buyer = { id: 'a', email: 'x@y.z', fitScore: 2, lastContact: '2026-09-01', companyIntel: { signals: [{ type: 'planning', date: '2026-10-01', text: 'Scheme submitted' }] } };
  const p = P.compute(buyer, {}, [], now);
  assert.equal(P.lane(buyer, {}, [], p, {}, now).lane, 'Now');
  assert.equal(P.lane(buyer, {}, [], p, { lastBack: '2026-10-10', lastSent: '2026-10-08' }, now).reason, 'They replied 3 days ago');
  const quiet = { id: 'b', email: 'q@y.z', fitScore: 2, lastContact: '2026-01-01' };
  assert.equal(P.lane(quiet, {}, [], P.compute(quiet, {}, [], now), {}, now).lane, 'Next');
  const notBuyer = { id: 'c', fitScore: 0 };
  assert.equal(P.lane(notBuyer, {}, [], P.compute(notBuyer, {}, [], now), {}, now).lane, 'Off');
  const noEmail = { id: 'd', fitScore: 2 };
  assert.equal(P.lane(noEmail, {}, [], P.compute(noEmail, {}, [], now), {}, now).lane, 'Later');
});

test('lanes: a fresh send waits, a future meeting is preparation', async () => {
  // @ts-ignore plain script that sets a global
  await import('../public/vanor-priority.js');
  const P = (globalThis as any).VanorPriority; const now = Date.parse('2026-10-13');
  const r = { id: 'e', email: 'e@y.z', fitScore: 2 }; const p = P.compute(r, {}, [], now);
  assert.equal(P.lane(r, {}, [], p, { lastSent: '2026-10-13' }, now).lane, 'Next');
  assert.match(P.lane(r, {}, [], p, { lastBack: '2026-10-20' }, now).reason, /Meeting in 7 days/);
});
