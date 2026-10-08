// Classifies a market signal the way the lead-intel products do (Glenigan / Barbour ABI / Planning Pipe):
// stage in the project life, sector, development type, size and value, parties, region. Plain regex, no AI.
// Thresholds follow Glenigan's "large project" rule as described to the ONS: 10+ homes or £250k+ non-residential.

export type Stage = 'pre_planning' | 'submitted' | 'granted' | 'refused' | 'appeal' | 'funded' | 'acquired' | 'tender' | 'contractor_appointed' | 'on_site' | 'completed' | 'stalled' | 'distress' | 'leadership' | 'news';
export const STAGE_LABEL: Record<Stage, string> = {
  pre_planning: 'Pre-planning', submitted: 'Plans submitted', granted: 'Plans granted', refused: 'Plans refused', appeal: 'At appeal', funded: 'Funding secured', acquired: 'Site acquired',
  tender: 'Out to tender', contractor_appointed: 'Contractor appointed', on_site: 'On site', completed: 'Completed', stalled: 'Stalled', distress: 'Distress', leadership: 'People move', news: 'News',
};
/** What Vanor offers at each stage, in the founders' words. */
export const STAGE_PLAY: Record<Stage, string> = {
  pre_planning: 'Early: offer a delivery-risk view before the scheme is fixed', submitted: 'Pre-construction: peer review of programme and cost plan before tender', granted: 'Consent in: offer the pre-tender Stress Test, the window is now',
  refused: 'Watch: re-submission likely, keep warm', appeal: 'Watch: decision pending', funded: 'Funder has a monitoring need and the developer has a start date: call both', acquired: 'New owner, new scheme: get in before the team is appointed',
  tender: 'Tender stage: independent review of contractor programmes and bids', contractor_appointed: 'Contract let: offer monitoring or an early-warning review for the client or funder', on_site: 'On site: position finding if it has drifted; monitoring for the funder',
  completed: 'Closing out: final account and claims support', stalled: 'Stalled: position finding and recovery plan', distress: 'Distress: call the employer or funder exposed, not the insolvent party', leadership: 'New decision-maker: introduce Vanor in their first 90 days', news: 'Context only',
};
export type DevType = 'new_build' | 'refurbishment' | 'conversion' | 'extension' | 'demolition' | 'infrastructure' | 'unknown';
export type Sector = 'residential' | 'btr' | 'pbsa' | 'later_living' | 'hotel' | 'leisure' | 'office' | 'retail' | 'mixed_use' | 'industrial' | 'data_centre' | 'life_sciences' | 'education' | 'health' | 'public' | 'infrastructure' | 'heritage' | 'unknown';
export const SECTOR_LABEL: Record<Sector, string> = { residential: 'Residential', btr: 'Build to rent', pbsa: 'Student', later_living: 'Later living', hotel: 'Hotel', leisure: 'Leisure', office: 'Office', retail: 'Retail', mixed_use: 'Mixed use', industrial: 'Industrial & logistics', data_centre: 'Data centre', life_sciences: 'Life sciences', education: 'Education', health: 'Health', public: 'Public', infrastructure: 'Infrastructure', heritage: 'Heritage', unknown: 'Unclassified' };

export type Size = { units?: number; keys?: number; beds?: number; sqft?: number; sqm?: number; storeys?: number; valueM?: number };
export type Parties = { developer?: string; funder?: string; contractor?: string; architect?: string; agent?: string; authority?: string };
export type Lead = { stage: Stage; devType: DevType; sector: Sector; size: Size; valueBand: string; region: string; parties: Parties; isLarge: boolean; tags: string[] };

const STAGES: [Stage, RegExp][] = [
  ['distress', /\b(petition to wind up|winding[- ]up|administrat(ion|ors)|liquidat(ion|ors)|insolven|ceased trading|collapse[ds]?|gone bust|enters? administration|notice of intent)\b/i],
  ['stalled', /\b(stalled|mothball|paused|on hold|halted|suspended|delay(ed|s)? (again|further|by)|behind (schedule|programme)|overrun|dispute|adjudicat|terminat(ed|ion)|walk(s|ed) off|pulls? out|replace[ds]? (the )?contractor|new contractor)\b/i],
  ['contractor_appointed', /\b(scoops?|bags|clinches|appointed to (build|deliver|construct)|appoint(s|ed)? [\w\s&]{0,30}(as )?(main |principal )?contractor|wins? (the |a )?(£[\d.]+[mb]n? )?(contract|deal|job)|contract(or)? (award|signed|let)|awarded (the |a )?(£[\d.]+[mb]n? )?contract|lands? (the |a )?(£[\d.]+[mb]n? )?(contract|job)|secures? (the |a )?(£[\d.]+[mb]n? )?contract|named as contractor|design and build contract)\b/i],
  ['on_site', /\b(start(s|ed)? on site|on site|breaks? ground|ground[- ]breaking|work(s)? (has|have) (begun|started)|construction (has )?(begun|started|underway|under way)|topping[- ]out|tops out|piling|enabling works? (begin|start)|now under construction)\b/i],
  ['completed', /\b(complet(ed|es|ion of)|practical completion|handed over|hands over|opens? (its|their) doors|officially open(ed|s)|reaches? completion)\b/i],
  ['tender', /\b(out to tender|tender(s|ing|ed)? (for|launched|process|list|return)|invites? (bids|tenders)|procurement (begins|launched|process)|shortlist(ed|s)? (for|contractors)|find a tender|contract notice|pre[- ]qualification|pqq)\b/i],
  ['funded', /\b(secures? (a |an )?(£[\d.]+[mb]n? )?(loan|facility|funding|finance|debt|refinanc\w*|investment)|(loan|facility|funding|finance|debt) (of|worth|totalling) £|refinanc(es|ed|ing)|development (loan|finance|facility)|lends? £|provides? (a )?£[\d.]+[mb]n? (loan|facility)|funding (secured|agreed|in place)|closes? (a )?£[\d.]+[mb]n? (loan|facility|financing)|forward[- ]fund(s|ed|ing)?)\b/i],
  ['acquired', /\b(acquir(es|ed|ing)|acquisition of|buys?|bought|purchas(es|ed)|snaps? up|completes? (the )?purchase|exchange[ds]? (contracts )?on|secures? (the )?site|land deal)\b/i],
  ['granted', /\b(planning (permission |consent |approval )?(granted|approved|secured|won|given)|wins? (planning|consent|approval)|approv(ed|es) plans|gets? (the )?(green light|go[- ]ahead|nod)|green[- ]light(ed|s)?|consent(ed)? (for|to)|resolution to grant|committee (approv|back)|councillors (approv|back)|secures? (planning|consent)|granted (planning|consent))\b/i],
  ['refused', /\b(refus(ed|es|al)|reject(ed|s)|turned down|thrown out|planning (committee )?(refus|reject))\b/i],
  ['appeal', /\b(appeal(s|ed)?|planning inspector(ate)?|call(ed|s)?[- ]in|public inquiry)\b/i],
  ['submitted', /\b(submit(s|ted)? (a |its |their |revised |new |fresh |detailed |outline |reserved matters )?(planning |plans|application|proposals?)|plans (submitted|lodged|filed|go in|unveiled|revealed)|lodges? (a |an )?(planning )?(application|plans)|applies? for (planning|permission|consent)|seeks? (planning|permission|consent|approval)|files? (plans|an application)|pending (decision|consideration)|awaiting decision)\b/i],
  ['pre_planning', /\b(pre[- ]app(lication)?|consultation (launched|opens|begins)|public consultation|unveils? (plans|proposals|vision|designs)|reveals? (plans|proposals|designs)|draws? up plans|masterplan|early[- ]stage plans|proposals? for|plans for (a |an )?(new )?)\b/i],
  ['leadership', /\b(appoint(s|ed)? [\w\s]{0,40}(as )?(chief executive|ceo|managing director|development director|head of|director of|chairman|chair)|joins? (as|from)|steps? down|hires?|promot(es|ed)|new (chief executive|ceo|md|managing director|development director))\b/i],
];
const PROPERTY_OBJECT = /\b(site|land|scheme|building|estate|hotel|offices?|portfolio|tower|plot|asset|property|campus|business park|retail park|development|homes|block|warehouse|shed|centre|store|pub|former|hectare|acre|sq ?ft|plc headquarters)\b/i;
const CORPORATE = /\b(firm|company|business|stake|shares|shareholding|subsidiary|turnover|revenue|results|profits?|pre-tax|acquisition of [A-Z][\w ]+ (Ltd|Limited|Group|plc)|buying spree|consultancy|contractor group)\b/i;
const SECTORS: [Sector, RegExp][] = [
  ['data_centre', /\b(?:data ?cent(re|er)s?|hyperscale|colocation)\b/i], ['life_sciences', /\b(?:life[- ]sciences?|laborator(y|ies)|lab space|r&d (space|facility)|science park)\b/i],
  ['pbsa', /\b(?:student (accommodation|housing|beds?|scheme)|pbsa|purpose[- ]built student)\b/i], ['btr', /\b(?:build[- ]to[- ]rent|btr|co[- ]living|rental (homes|apartments|scheme))\b/i],
  ['later_living', /\b(?:later living|retirement (village|living|homes?)|care home|extra care|senior living|assisted living)\b/i],
  ['hotel', /\b(?:hotels?|hospitality|aparthotel|serviced apartments?|resort|inn)\b/i], ['leisure', /\b(?:leisure|cinema|stadium|arena|theatre|gym|spa|restaurant|pub)\b/i],
  ['heritage', /\b(?:listed building|grade (i|ii)\*?|heritage|conservation area|historic)\b/i], ['mixed_use', /\b(?:mixed[- ]use|regeneration|masterplan|town centre|urban quarter)\b/i],
  ['office', /\b(?:offices?|workspace|hq|headquarters|commercial space)\b/i], ['retail', /\b(?:retail|shopping centre|supermarket|store|shops?)\b/i],
  ['industrial', /\b(?:industrial|logistics|warehous(e|ing)|distribution (centre|hub)|sheds?|manufacturing (plant|facility))\b/i],
  ['education', /\b(?:school|academy|college|university|campus)\b/i], ['health', /\b(?:hospital|nhs|health ?care|medical centre|clinic)\b/i],
  ['infrastructure', /\b(?:rail|station|highway|road scheme|bridge|tunnel|airport|port|energy|wind farm|solar|grid|water treatment|sewer)\b/i],
  ['residential', /\b(?:homes?|housing|apartments?|flats?|dwellings?|residential|houses)\b/i],
  ['public', /\b(?:civic (centre|hub)|library|leisure centre|town hall)\b/i],
];
const DEV: [DevType, RegExp][] = [
  ['demolition', /\b(?:demoli(sh|tion))\b/i], ['conversion', /\b(?:conver(sion|t|ted)|change of use|repurpos|office[- ]to[- ]resi)\b/i],
  ['refurbishment', /\b(?:refurb|renovat|retrofit|restor(e|ation)|remodel|upgrade works|fit[- ]out|cat ?[ab])\b/i], ['extension', /\b(?:extension|extend(s|ed)?|additional storeys?|upward extension)\b/i],
  ['infrastructure', /\b(?:infrastructure|civil engineering|highways?|rail)\b/i], ['new_build', /\b(?:new[- ]build|erection of|construction of|build (a |an )?new|development of|scheme of|tower|block)\b/i],
];
const REGIONS: [string, RegExp][] = [
  ['London', /\b(?:london|westminster|camden|southwark|hackney|islington|tower hamlets|canary wharf|croydon|ealing|brent|lambeth|wandsworth|greenwich|lewisham|newham|barnet|hammersmith|kensington|chelsea|city of london|stratford|king'?s cross|shoreditch|battersea|nine elms|docklands|wembley|old oak)\b/i],
  ['South East', /\b(?:surrey|kent|sussex|hampshire|berkshire|oxford|reading|brighton|southampton|portsmouth|milton keynes|guildford|maidstone|slough|crawley|woking)\b/i],
  ['South West', /\b(?:bristol|bath|devon|cornwall|exeter|plymouth|gloucester|swindon|bournemouth|dorset|somerset|cheltenham)\b/i],
  ['East of England', /\b(?:cambridge|norwich|ipswich|essex|chelmsford|peterborough|luton|hertford|watford|stevenage|colchester|southend)\b/i],
  ['West Midlands', /\b(?:birmingham|coventry|wolverhampton|solihull|worcester|warwick|stoke|telford|west midlands)\b/i],
  ['East Midlands', /\b(?:nottingham|leicester|derby|northampton|lincoln|east midlands)\b/i],
  ['North West', /\b(?:manchester|salford|liverpool|chester|preston|lancashire|cumbria|warrington|bolton|stockport|wigan|trafford|north west)\b/i],
  ['Yorkshire', /\b(?:leeds|sheffield|york|bradford|hull|wakefield|doncaster|huddersfield|harrogate|yorkshire)\b/i],
  ['North East', /\b(?:newcastle|sunderland|durham|middlesbrough|gateshead|teesside|north east)\b/i],
  ['Scotland', /\b(?:glasgow|edinburgh|aberdeen|dundee|scotland|scottish|inverness|stirling)\b/i],
  ['Wales', /\b(?:cardiff|swansea|newport|wales|welsh)\b/i], ['Northern Ireland', /\b(?:belfast|northern ireland|derry)\b/i], ['Ireland', /\b(?:dublin|cork|galway|limerick|ireland)\b/i],
];

const num = (s: string) => parseFloat(s.replace(/,/g, ''));
export function sizeOf(text: string): Size {
  const t = text; const out: Size = {};
  for (const m of t.matchAll(/£\s?(\d+(?:[.,]\d+)?)\s?(m|million|bn|billion)\b/gi)) { const v = num(m[1]) * (/^b/i.test(m[2]) ? 1000 : 1); out.valueM = Math.max(out.valueM || 0, v); }
  const units = t.match(/(?<![\/\d.])(\d{1,3}(?:,\d{3})?|\d{1,4})\s?(?:-|\s)?(?:new |affordable |private |rental |student )?(homes?|houses?|dwellings?|apartments?|flats?|units?|residential units)\b/i); if (units && num(units[1]) > 0 && num(units[1]) < 5000) out.units = num(units[1]);
  const keys = t.match(/(\d{2,4})\s?-?\s?(bed(room)?s?|keys?|rooms?)\b/i); if (keys) { const n = num(keys[1]); if (/hotel|aparthotel|resort|inn/i.test(t)) out.keys = n; else out.beds = n; }
  const sqft = t.match(/(\d{1,3}(?:,\d{3})+|\d{4,7})\s?(sq\.? ?ft|square feet|sqft)/i); if (sqft) out.sqft = num(sqft[1]);
  const sqm = t.match(/(\d{1,3}(?:,\d{3})+|\d{3,7})\s?(sq\.? ?m|square metres|sqm|m2|m²)/i); if (sqm) out.sqm = num(sqm[1]);
  const st = t.match(/(\d{1,2})[- ]storey/i); if (st) out.storeys = num(st[1]);
  return out;
}
export function valueBand(s: Size): string {
  const v = s.valueM ?? (s.units ? s.units * 0.25 : s.keys ? s.keys * 0.2 : s.beds ? s.beds * 0.12 : s.sqft ? s.sqft / 1e6 * 350 : s.sqm ? s.sqm / 1e6 * 3800 : undefined);
  if (v == null) return 'Value unknown';
  return v >= 100 ? '£100m+' : v >= 50 ? '£50m–£100m' : v >= 20 ? '£20m–£50m' : v >= 5 ? '£5m–£20m' : v >= 1 ? '£1m–£5m' : 'Under £1m';
}
export function partiesOf(text: string): Parties {
  const p: Parties = {}; const t = text.replace(/\s+/g, ' ');
  const name = '((?:[A-Z][\\w&\'’.-]*\\s?){1,5}(?:Ltd|Limited|plc|PLC|LLP|Group|Holdings|Capital|Partners|Developments?|Properties|Estates|Homes|Living|Investments?|Investors|Management|Trust|REIT|Bank|Fund|Construction|Contractors|Build|Interiors|Engineering|Architects|Studio|Design)?)';
  const grab = (re: RegExp) => { const m = t.match(re); return m ? m[1].trim().replace(/^(the|a|an)\s+/i, '') : undefined; };
  const ci = (words: string) => '(?:' + words.split('|').map(w => w.length ? `[${w[0].toUpperCase()}${w[0]}]${w.slice(1)}` : w).join('|') + ')';
  p.developer = grab(new RegExp(`${ci('developer|developers|development company|housebuilder|house builder|landowner|owner|investor|operator')}\\s+${name}`)) || grab(new RegExp(`${name}\\s+(?:has|have|is|are)?\\s?(?:submitted|submits|lodged|lodges|secured|secures|won|wins|unveiled|unveils|revealed|reveals|acquired|acquires|bought|buys|appointed|appoints|been granted|received|receives|started|starts|begun|begins|completed|completes|plans|seeks|applies)\\b`));
  p.funder = grab(new RegExp(`${ci('funded by|financed by|loan from|facility from|lender|lenders|funder|backed by|finance from|debt from|provided by')}\\s+${name}`)) || grab(new RegExp(`${name}\\s+(?:has|have)\\s+(?:provided|agreed|lent|lends|closed|completed)\\s+(?:a|an|the)?\\s?£`));
  p.contractor = grab(new RegExp(`${ci('contractor|main contractor|principal contractor|builder|appointed|awarded to|won by|delivered by|built by')}\\s+${name}`)) || grab(new RegExp(`${name}\\s+(?:has|have)\\s+(?:won|been appointed|been awarded|landed|secured|started on site|begun work|broken ground)`));
  p.architect = grab(new RegExp(`${ci('designed by|architects|architect')}\\s+${name}`));
  const BARE = /^(the |a )?(construction|developments?|homes|group|holdings|properties|property|estates|capital|partners|living|investments?|management|building|contractors?|limited|ltd|plc)$/i;
  if (p.developer && p.contractor && p.developer.toLowerCase() === p.contractor.toLowerCase()) delete p.developer;
  return Object.fromEntries(Object.entries(p).filter(([, v]) => v && v.length > 3 && v.length < 80 && !BARE.test(v))) as Parties;
}
export function classifyLead(text: string, hint: { applicant?: string; authority?: string; appType?: string; appState?: string; appSize?: string } = {}): Lead {
  const t = `${text} ${hint.appType || ''} ${hint.appState || ''}`;
  let stage: Stage = 'news';
  if (hint.appState) { const s = hint.appState.toLowerCase(); stage = /permitted|granted|approved|conditions/.test(s) ? 'granted' : /refused|rejected/.test(s) ? 'refused' : /appeal/.test(s) ? 'appeal' : /withdrawn/.test(s) ? 'stalled' : 'submitted'; }
  else for (const [k, re] of STAGES) if (re.test(t)) { stage = k; break; }
  if (stage === 'acquired' && !PROPERTY_OBJECT.test(t)) stage = CORPORATE.test(t) ? 'news' : stage;
  if (stage === 'acquired' && CORPORATE.test(t) && !PROPERTY_OBJECT.test(t)) stage = 'news';
  let sector: Sector = 'unknown'; for (const [k, re] of SECTORS) if (re.test(t)) { sector = k; break; }
  let devType: DevType = 'unknown'; for (const [k, re] of DEV) if (re.test(t)) { devType = k; break; }
  let region = ''; for (const [k, re] of REGIONS) if (re.test(t)) { region = k; break; }
  const size = sizeOf(text); const parties = partiesOf(text);
  if (hint.applicant && !parties.developer) parties.developer = hint.applicant;
  if (hint.authority) parties.authority = hint.authority;
  const isLarge = (size.units ?? 0) >= 10 || (size.keys ?? 0) >= 40 || (size.beds ?? 0) >= 50 || (size.valueM ?? 0) >= 0.25 || (size.sqft ?? 0) >= 10000 || (size.sqm ?? 0) >= 1000 || hint.appSize === 'Large' || /major/i.test(hint.appType || '');
  const tags = [STAGE_LABEL[stage], SECTOR_LABEL[sector], devType !== 'unknown' ? devType.replace('_', ' ') : '', region].filter(Boolean);
  return { stage, devType, sector, size, valueBand: valueBand(size), region, parties, isLarge, tags };
}
export function sizeText(s: Size) {
  return [s.units && `${s.units.toLocaleString('en-GB')} homes`, s.keys && `${s.keys} keys`, s.beds && `${s.beds} beds`, s.sqft && `${s.sqft.toLocaleString('en-GB')} sq ft`, !s.sqft && s.sqm && `${s.sqm.toLocaleString('en-GB')} sq m`, s.storeys && `${s.storeys} storeys`, s.valueM && `£${s.valueM >= 1000 ? (s.valueM / 1000).toFixed(1) + 'bn' : s.valueM + 'm'}`].filter(Boolean).join(' · ');
}
/** Is this press item a lead at all? A stage we act on, a sector we serve, and something to size it by or a named party. */
export function isLeadWorthy(l: Lead) {
  if (['news', 'leadership'].includes(l.stage)) return false;
  if (['infrastructure', 'public'].includes(l.sector) && l.stage !== 'distress') return false;
  return l.isLarge || !!l.parties.developer || !!l.parties.funder || l.stage === 'distress';
}

// ---- Sellability: can Vanor sell something off this signal, to whom, for how much, how soon? ----
export type Sellability = { score: number; tier: 'Hot' | 'Warm' | 'Watch'; parts: { moment: number; buyer: number; size: number; access: number; fresh: number; sector: number; complexity: number }; play: string; call: string; why: string };
const MOMENT: Record<Stage, number> = { funded: 1, granted: 0.95, tender: 0.9, stalled: 0.9, contractor_appointed: 0.7, acquired: 0.65, submitted: 0.6, on_site: 0.5, pre_planning: 0.35, distress: 0.3, appeal: 0.3, refused: 0.2, leadership: 0.3, completed: 0.15, news: 0.1 };
const BUYER: Record<string, number> = { developer: 1, hotel_group: 1, owner_occupier: 1, fund: 0.95, family_office: 0.95, lender: 0.95, public_body: 0.6, contractor: 0.3, unknown: 0.35 };
const SIZE_BAND: Record<string, number> = { '£100m+': 1, '£50m–£100m': 0.9, '£20m–£50m': 0.8, '£5m–£20m': 0.6, '£1m–£5m': 0.35, 'Under £1m': 0.15, 'Value unknown': 0.4 };
const OFF_SECTOR: Sector[] = ['infrastructure', 'public', 'industrial', 'retail'];
const COMPLEX = /\blisted|grade (i|ii)|heritage|live (environment|hospital|hotel|campus)|occupied|phased|decant|basement|m&e|mep|mechanical|commissioning|laborator|data ?cent|cut[- ]and[- ]carve|facade|cladding|remediation|gateway 2|higher[- ]risk building|hrb\b/i;
export const CALL_FOR: Record<string, string> = { developer: 'Development Director or MD', hotel_group: 'Group Property Director or Head of Development', fund: 'Head of Asset Management', family_office: 'The principal or their asset manager', lender: 'Director, Real Estate Finance (they have a monitoring need)', owner_occupier: 'Director of Estates or Head of Capital Projects', public_body: 'Head of Capital Projects (framework route)', contractor: 'Not the contractor: the employer or funder they are working for', unknown: 'Whoever loses money if the date moves' };

export function sellability(lead: Lead, buyerType: string, text: string, date: string, opts: { knownContacts?: number; warm?: boolean; today?: Date } = {}): Sellability {
  const today = opts.today || new Date();
  const isContractor = /\b(contractors?|construction|building|interiors|fit[- ]?out|m&e|mechanical|electrical|scaffold|groundwork|civil)\b/i.test(lead.parties.developer || '') && !/develop|homes|propert|estates|capital|living/i.test(lead.parties.developer || '');
  const contractorOnly = !lead.parties.developer && !lead.parties.funder && !!lead.parties.contractor;
  const buyerKey = isContractor || contractorOnly ? 'contractor' : (buyerType in BUYER ? buyerType : 'unknown');
  const exposedParty = !!(lead.parties.funder || (lead.parties.developer && !isContractor));
  let moment = MOMENT[lead.stage];
  if (lead.stage === 'distress') moment = exposedParty ? 0.8 : lead.sector !== 'unknown' && !isContractor ? 0.5 : 0.3;
  const complexity = COMPLEX.test(text) ? 1.12 : 1;
  moment = Math.min(1, moment * complexity);
  const buyer = lead.stage === 'distress' && !exposedParty ? Math.min(BUYER[buyerKey], 0.5) : BUYER[buyerKey];
  const size = lead.valueBand === 'Value unknown' && lead.isLarge ? 0.6 : SIZE_BAND[lead.valueBand] ?? 0.4;
  const named = !!(lead.parties.developer || lead.parties.funder);
  const access = opts.warm ? 1 : (opts.knownContacts || 0) > 0 ? 0.9 : named ? 0.6 : 0.3;
  const days = (today.getTime() - (Date.parse(date) || today.getTime())) / 864e5;
  const fresh = days <= 14 ? 1 : days <= 30 ? 0.8 : days <= 90 ? 0.5 : 0.3;
  const sector = OFF_SECTOR.includes(lead.sector) ? 0.6 : lead.sector === 'unknown' ? 0.85 : 1;
  // A dead moment caps everything else: a famous developer in a news story is not a lead.
  const score = Math.round((30 * moment + (25 * buyer + 20 * size + 15 * access + 10 * fresh) * (0.4 + 0.6 * moment)) * sector);
  const tier: Sellability['tier'] = score >= 65 ? 'Hot' : score >= 45 ? 'Warm' : 'Watch';
  const why = [
    `${STAGE_LABEL[lead.stage]}${lead.stage === 'distress' ? (exposedParty ? ', exposed party named' : ', no exposed party named yet') : ''}`,
    buyerKey === 'contractor' ? 'contractor, not a buyer' : buyerKey === 'unknown' ? 'buyer type unclear' : `${buyerKey.replace('_', ' ')} buys this`,
    lead.valueBand === 'Value unknown' ? (lead.isLarge ? 'large, value unstated' : 'size unknown') : lead.valueBand,
    opts.warm ? 'warm contact on the board' : (opts.knownContacts || 0) > 0 ? `${opts.knownContacts} contact${opts.knownContacts === 1 ? '' : 's'} on the board` : named ? 'company named' : 'nobody named',
    complexity > 1 ? 'complex: our edge' : '',
    sector < 1 && lead.sector !== 'unknown' ? 'off-sector' : '',
  ].filter(Boolean).join(' · ');
  return { score, tier, parts: { moment: +moment.toFixed(2), buyer, size, access, fresh, sector, complexity }, play: STAGE_PLAY[lead.stage], call: CALL_FOR[buyerKey], why };
}
