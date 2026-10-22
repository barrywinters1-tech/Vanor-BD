// Vanor's price list and the first-step offer for a lead. Figures come from the pricing workbook (Vanor_Pricing_Workbook_v1.xlsx, 16 Oct 2026):
// partner days × £1,200 (fixed) or £1,000 (monthly), rounded. All prices are drafts until a client pays them.
import { addWorkingDays } from './pursuit-logic.ts';

export type Product = { key: string; name: string; fee: number; unit: 'fixed' | 'month'; weeks?: number; days: number; gets: string; forStage: string[]; forType: string[] };

export const PRICE_LIST: Product[] = [
  { key: 'review', name: 'Programme Review', fee: 3000, unit: 'fixed', weeks: 1, days: 2.5, gets: 'an independent read of the programme and a one-page view of the real completion date', forStage: ['on_site', 'contractor_appointed', 'completed'], forType: ['Developer / Owner', 'Operator', 'Public body'] },
  { key: 'stress_test', name: 'Project Stress Test', fee: 9500, unit: 'fixed', weeks: 2, days: 8, gets: 'a two-week snapshot: whether the plan is real and the true position on time, cost and risk', forStage: ['stalled', 'distress', 'contractor_appointed', 'on_site', 'funded', 'granted', 'submitted'], forType: ['Developer / Owner', 'Operator', 'Public body', 'Funder / Investor'] },
  { key: 'position_finding', name: 'Position Finding & Plan', fee: 25000, unit: 'fixed', weeks: 5, days: 21, gets: 'full position finding and an agreed recovery or delivery plan', forStage: ['stalled', 'distress'], forType: ['Developer / Owner', 'Funder / Investor', 'Operator'] },
  { key: 'startup', name: 'Project Start-Up Pack', fee: 12000, unit: 'fixed', weeks: 3, days: 10, gets: 'roles, governance, reporting, first programme, risk register and a 30/60/90 plan', forStage: ['granted', 'funded', 'acquired', 'pre_planning'], forType: ['Developer / Owner', 'Operator'] },
  { key: 'procurement', name: 'Procurement & Tender Review', fee: 11000, unit: 'fixed', weeks: 3, days: 10, gets: 'procurement route, tender plan, evaluation model and a recommendation', forStage: ['granted', 'submitted', 'funded'], forType: ['Developer / Owner', 'Public body'] },
  { key: 'lender_report', name: 'Lender Initial Monitoring Report', fee: 9000, unit: 'fixed', weeks: 2, days: 8, gets: 'day-one due diligence on cost, programme, contracts and risk', forStage: ['funded', 'contractor_appointed', 'on_site', 'stalled', 'distress'], forType: ['Funder / Investor'] },
  { key: 'oversight', name: 'Oversight, problem scheme', fee: 4000, unit: 'month', days: 4, gets: 'monthly independent oversight for the owner or lender, reported by exception', forStage: ['stalled', 'distress', 'on_site'], forType: ['Funder / Investor', 'Developer / Owner'] },
  { key: 'health_check', name: 'Programme Health Check', fee: 5000, unit: 'fixed', weeks: 1, days: 4, gets: 'a planner-led review of the contractor\'s programme, logic and critical path', forStage: ['contractor_appointed', 'on_site'], forType: ['Developer / Owner', 'Operator', 'Public body', 'Funder / Investor'] },
];

export const RULES = {
  partnerDayFixed: 1200, partnerDayMonthly: 1000, creditDays: 30, validityDays: 30, decisionWorkingDays: 10,
  note: 'Fixed fees 50% on instruction, 50% on findings. Monthly fees invoiced monthly in advance. First-step fee credited against the next stage if instructed within 30 days. Prices exclude VAT; expenses outside the M25 at cost.',
};

export const BUYER_TYPES = ['Developer / Owner', 'Funder / Investor', 'Operator', 'Public body'];
export const isBuyerType = (type: string) => BUYER_TYPES.includes(String(type || ''));

export const fmt = (n: number) => '£' + Math.round(n).toLocaleString('en-GB');

/** The first step to put to a buyer, from the record's type and stage. Lenders get the monitoring report; distress gets the Stress Test; otherwise the smallest product that fits, with the Stress Test as the default. */
export function firstStep(rec: { type?: string; stage?: string; sector?: string } = {}): Product {
  const type = String(rec.type || ''); const stage = String(rec.stage || '').toLowerCase().replace(/\s+/g, '_');
  if (type === 'Funder / Investor') return PRICE_LIST.find(p => p.key === 'lender_report')!;
  if (/stall|distress|admin|insolv/.test(stage)) return PRICE_LIST.find(p => p.key === 'stress_test')!;
  const fits = PRICE_LIST.filter(p => p.unit === 'fixed' && p.forType.includes(type) && p.forStage.includes(stage)).sort((a, b) => a.fee - b.fee);
  return fits[0] || PRICE_LIST.find(p => p.key === 'stress_test')!;
}

/** The three options to quote: the first step, the next size up, and the monthly follow-on. */
export function options(rec: { type?: string; stage?: string } = {}) {
  const a = firstStep(rec);
  const fixed = PRICE_LIST.filter(p => p.unit === 'fixed' && p.fee > a.fee && (p.forType.includes(String(rec.type || '')) || p.key === 'position_finding')).sort((x, y) => x.fee - y.fee);
  const b = fixed[0] || PRICE_LIST.find(p => p.key === 'position_finding')!;
  const c = PRICE_LIST.find(p => p.key === 'oversight')!;
  return { A: a, B: b, C: c };
}

/** Decision date to ask for: ten working days from today unless the client has a deadline of their own. */
export const decisionDateFrom = (from = new Date().toISOString().slice(0, 10), days = RULES.decisionWorkingDays) => addWorkingDays(from, days);

/** The two sentences that go in the follow-up email. Barry's voice: plain, one offer, one date. */
export function offerLines(rec: { type?: string; stage?: string } = {}, decisionDate = decisionDateFrom()) {
  const p = firstStep(rec);
  const when = new Date(decisionDate + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const price = p.unit === 'month' ? `${fmt(p.fee)} a month` : `a fixed fee of ${fmt(p.fee)}`;
  const span = p.unit === 'month' ? '' : ` over ${p.weeks === 1 ? 'a week' : `${p.weeks} weeks`}`;
  return [
    `As a first step we'd suggest a ${p.name}: ${p.gets}, for ${price}${span}. If you go on to anything bigger within 30 days, that comes off the fee.`,
    `Could you let me know by ${when} whether you'd like to go ahead? Happy to talk it through before then.`,
  ];
}
