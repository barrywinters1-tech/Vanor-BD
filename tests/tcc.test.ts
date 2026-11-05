import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, isSignal, score } from '../lib/intel.ts';
// @ts-ignore
import '../public/vanor-classify.js';

test('a TCC judgment entry survives parse, signal, score and the bar', () => {
  const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Acme Developments Limited v Bolt Construction Ltd [2026] EWHC 1234 (TCC)</title><link rel="alternate" href="https://caselaw.nationalarchives.gov.uk/ewhc/tcc/2026/1234"/><updated>2026-11-03T10:00:00+00:00</updated><summary>Adjudication enforcement; extension of time dispute on a hotel refurbishment.</summary></entry></feed>`;
  const items = parseFeed(atom, 'tcc_judgments');
  assert.equal(items.length, 1);
  assert.ok(isSignal(items[0]));
  const sc = score(items[0], new Date('2026-11-05T00:00:00Z'));
  assert.equal(sc.lead.stage, 'dispute');
  assert.equal(sc.lead.parties.claimant, 'Acme Developments Limited');
  assert.equal(sc.lead.parties.defendant, 'Bolt Construction Ltd');
  const C = (globalThis as any).VanorClassify;
  const b = C.bar({ origin: 'intel', title: sc.title, context: sc.summary, region: sc.lead.region, createdAt: sc.date, intel: { stage: sc.lead.stage, buyerType: sc.buyerType, parties: sc.lead.parties, signalDate: C.isoDate(sc.date), region: sc.lead.region } });
  assert.ok(!b || b.pass, 'bar: ' + (b && b.reason));
});
