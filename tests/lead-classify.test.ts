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
