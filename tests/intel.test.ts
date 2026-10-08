import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, isSignal, score, classify, moneySignal, contractorsIn, leadContext } from '../lib/intel.ts';

const today = new Date('2026-10-06T08:00:00Z');

test('parses RSS with CDATA and entities', () => {
  const xml = `<rss><channel><item><title><![CDATA[Fit-out firm Acme Interiors Ltd falls into administration]]></title>
    <link>https://example.com/a?x=1&amp;y=2</link><pubDate>Mon, 05 Oct 2026 09:00:00 +0000</pubDate>
    <description>&lt;p&gt;Administrators appointed; £12m hotel job in Mayfair stalled&lt;/p&gt;</description></item></channel></rss>`;
  const [item] = parseFeed(xml, 'construction_enquirer');
  assert.equal(item.link, 'https://example.com/a?x=1&y=2');
  assert.match(item.summary, /£12m hotel job/);
  assert.ok(!item.summary.includes('<p>'));
});

test('parses Atom entries (Gazette)', () => {
  const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Appointment of Administrators: BUILDCO CONSTRUCTION LIMITED</title>
    <link rel="alternate" href="https://www.thegazette.co.uk/notice/123"/><updated>2026-10-05T10:00:00Z</updated><content>Construction contractor</content></entry></feed>`;
  const [e] = parseFeed(xml, 'gazette_construction');
  assert.equal(e.link, 'https://www.thegazette.co.uk/notice/123');
  assert.ok(isSignal(e));
});

test('planning: drops small/householder, keeps large sector consents', () => {
  const big = { source: 'planit', title: 'Westminster: Change of use to 180-room hotel', link: 'l1', date: '2026-10-04', summary: 'Grade II listed building, change of use | Size: Large' };
  const small = { ...big, link: 'l2', summary: 'Householder extension | Size: Small' };
  assert.ok(isSignal(big)); assert.ok(!isSignal(small));
});

test('scoring: distress + money + complexity, buyer from applicant', () => {
  const s = score({ source: 'planit', title: 'Camden: refurbishment of Grade II listed hotel, 180 rooms, phased in live building', link: 'x', date: '2026-10-05', summary: '£45m works', applicant: 'Example Hotels Ltd' }, today);
  assert.equal(s.buyerType, 'hotel_group');
  assert.equal(s.money, 20);
  assert.ok(s.complexity >= 30);
  assert.ok(s.score >= 50, `score ${s.score}`);
});

test('old distress decays, consents hold value', () => {
  const base = { source: 'construction_enquirer', title: 'Contractor enters administration', link: 'y', summary: 'Developments stalled' };
  const fresh = score({ ...base, date: '2026-10-05' }, today).score;
  const stale = score({ ...base, date: '2026-07-01' }, today).score;
  assert.ok(stale < fresh);
});

test('helpers', () => {
  assert.equal(classify('Barclays real estate finance'), 'lender');
  assert.equal(moneySignal('a £8.5m scheme'), 6);
  assert.deepEqual(contractorsIn('Work by Smith Brothers Construction Ltd halted'), ['Smith Brothers Construction Ltd']);
  const ctx = leadContext(score({ source: 'planit', title: 'T', link: 'z', date: '2026-10-05', summary: 'hotel' }, today), ['A DIRECTOR (director)'], ['Jane (CEO)']);
  assert.match(ctx, /Directors \(Companies House\)/); assert.match(ctx, /Already on the board/);
});

test('Gazette notice feeds keep built-environment firms and score them as distress', async () => {
  const { gazetteSignals } = await import('../lib/intel.ts');
  const xml = `<feed><entry><id>x</id><title>TRIDENT PROPERTY CONSTRUCTION LIMITED</title><link href="https://www.thegazette.co.uk/notice/5224688"/><updated>2026-10-06T12:02:02+01:00</updated></entry>
    <entry><id>y</id><title>EXHALATION TECHNOLOGY LTD</title><link href="https://www.thegazette.co.uk/notice/2"/><updated>2026-10-06T12:00:00+01:00</updated></entry></feed>`;
  const s = gazetteSignals(xml, '2450');
  assert.equal(s.length, 1);
  assert.match(s[0].title, /^Petition to wind up: TRIDENT/);
  assert.ok(isSignal(s[0]));
  assert.ok(score(s[0], today).distress >= 30);
});

test('gazette: the insolvent company is the subject, not an exposed buyer', () => {
  const r = score({ source: 'gazette_2441', title: 'Appointment of administrators: Z HOTELS STRAND LTD', summary: 'notice', applicant: 'Z HOTELS STRAND LTD', link: 'q', date: '2026-10-05' }, today);
  assert.equal(r.lead.stage, 'distress'); assert.equal(r.lead.parties.developer, undefined); assert.ok(r.score < 50, `score ${r.score}`);
  const f = score({ source: 'property_week', title: 'Watkin Jones secures £65m development loan from OakNorth Bank for 600-bed student scheme in Leeds', summary: '', link: 'w', date: '2026-10-05' }, today);
  assert.ok(f.score > r.score + 30);
});
