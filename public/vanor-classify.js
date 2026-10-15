/* Vanor classification: the same five labels on every lead and contact, however it arrived.
   Type (who they are) · Sector (what they build) · Stage (where the scheme is) · Region (where) · Size (how big).
   Shared by the board (browser) and the Claude connector (server). Plain script: sets globalThis.VanorClassify. */
(function (root) {
  'use strict';
  var REGIONS = ['London', 'South East', 'South West', 'East of England', 'Midlands', 'North West', 'North East', 'Yorkshire', 'Scotland', 'Wales', 'Northern Ireland', 'Ireland', 'UK-wide', 'International', 'Unknown'];
  var TYPES = ['Developer / Owner', 'Funder / Investor', 'Operator', 'Consultancy', 'Contractor', 'Introducer', 'Public body', 'Other'];

  // Postcode area → region. Outward code letters only.
  var PC = {
    London: 'E EC N NW SE SW W WC BR CR DA EN HA IG KT RM SM TW UB WD',
    'South East': 'BN CT GU ME MK OX PO RG RH SL SO SS TN CM LU HP AL SG',
    'South West': 'BA BH BS DT EX GL PL SN SP TA TQ TR',
    'East of England': 'CB CO IP NR PE',
    Midlands: 'B CV DE DY LE NG NN ST WS WV WR HR TF LN',
    'North West': 'BB BL CA CH CW FY L LA M OL PR SK WA WN',
    'North East': 'DH DL NE SR TS',
    Yorkshire: 'BD DN HD HG HU HX LS S WF YO',
    Scotland: 'AB DD DG EH FK G HS IV KA KW KY ML PA PH TD ZE',
    Wales: 'CF LD LL NP SA SY',
    'Northern Ireland': 'BT'
  };
  var PC_MAP = {}; Object.keys(PC).forEach(function (reg) { PC[reg].split(' ').forEach(function (a) { PC_MAP[a] = reg; }); });

  var TOWNS = {
    London: 'london westminster camden islington hackney southwark lambeth croydon ealing hammersmith kensington chelsea greenwich lewisham wandsworth richmond kingston bromley barnet brent harrow hounslow redbridge newham tower hamlets haringey enfield waltham forest sutton merton hillingdon havering bexley barking dagenham mayfair soho shoreditch canary wharf stratford wembley wimbledon holborn clerkenwell farringdon battersea vauxhall nine elms kings cross paddington',
    'South East': 'brighton reading oxford milton keynes southampton portsmouth guildford maidstone canterbury crawley slough basingstoke woking bracknell winchester chichester eastbourne hastings dover ashford tunbridge wells chelmsford luton watford hemel st albans stevenage',
    'South West': 'bristol bath bournemouth poole exeter plymouth gloucester cheltenham swindon salisbury taunton torquay truro',
    'East of England': 'cambridge norwich ipswich colchester peterborough',
    Midlands: 'birmingham coventry derby nottingham leicester northampton stoke wolverhampton worcester hereford telford lincoln solihull warwick leamington',
    'North West': 'manchester liverpool salford bolton blackburn preston chester warrington stockport wigan oldham lancaster carlisle crewe trafford altrincham',
    'North East': 'newcastle sunderland durham darlington middlesbrough gateshead',
    Yorkshire: 'leeds sheffield bradford york hull huddersfield halifax harrogate doncaster wakefield',
    Scotland: 'glasgow edinburgh aberdeen dundee inverness perth stirling',
    Wales: 'cardiff swansea newport wrexham bangor',
    'Northern Ireland': 'belfast derry londonderry lisburn',
    Ireland: 'dublin cork galway limerick',
    International: 'dubai abu dhabi riyadh doha paris berlin frankfurt madrid milan amsterdam new york singapore hong kong sydney uae saudi qatar europe'
  };
  var TOWN_LIST = []; Object.keys(TOWNS).forEach(function (reg) { TOWNS[reg].split(' ').forEach(function (t) { TOWN_LIST.push([t, reg]); }); });
  // Longer names first so "tower hamlets" beats "hamlets", "st albans" beats "albans".
  TOWN_LIST.sort(function (a, b) { return b[0].length - a[0].length; });

  function regionFromText(text) {
    var t = ' ' + String(text || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ') + ' ';
    for (var i = 0; i < TOWN_LIST.length; i++) if (t.indexOf(' ' + TOWN_LIST[i][0] + ' ') >= 0) return TOWN_LIST[i][1];
    var m = String(text || '').toUpperCase().match(/\b([A-Z]{1,2})\d[A-Z\d]?\s*\d[A-Z]{2}\b/);
    if (m && PC_MAP[m[1]]) return PC_MAP[m[1]];
    return '';
  }
  function normRegion(s) {
    var v = String(s || '').trim(); if (!v) return '';
    var low = v.toLowerCase();
    // A named region beats "UK-wide": "London / UK-wide" is a London firm that will travel.
    if (/greater london|m25|^london/.test(low)) return 'London';
    for (var i = 0; i < REGIONS.length; i++) if (REGIONS[i] !== 'UK-wide' && low.indexOf(REGIONS[i].toLowerCase()) === 0) return REGIONS[i];
    if (/^ni\b/.test(low)) return 'Northern Ireland';
    if (/^(uae|dubai|international|overseas|europe|middle east)/.test(low)) return 'International';
    if (/uk[- ]wide|^uk$|national|nationwide/.test(low)) return 'UK-wide';
    return regionFromText(v);
  }
  /** Region of a record: stated region, then the lead's own classification, then anything that looks like a place in the record. */
  function regionOf(r) {
    if (!r) return 'Unknown';
    var v = normRegion(r.region); if (v) return v;
    if (r.intel && r.intel.region) { v = normRegion(r.intel.region); if (v) return v; }
    if (r.companyIntel && r.companyIntel.locality) { v = regionFromText(r.companyIntel.locality); if (v) return v; }
    v = regionFromText([r.title, r.context, r.notes].filter(Boolean).join(' ').slice(0, 600)); if (v) return v;
    return 'Unknown';
  }

  // Company names and job titles are evidence; imported segments are often wrong ("Other / Unclassified", or an architect filed as a developer).
  var CO_CONSULT = /\b(architects?|architecture|studio|design|engineers?|engineering|consultants?|consultancy|consulting|surveyors?|partnership|llp|planning|cost|costplan|project management|quantity|steel|structures?|lighting|nulty)\b|tillett/i;
  var CO_FUND = /\b(capital|partners|fund|funds|investments?|investors|asset management|equity|bank|lending|finance|credit|debt|reit|trust)\b/i;
  var CO_CONTRACT = /\b(construction|contractors?|contracting|building services|build|builders|fit[- ]?out|interiors|m ?& ?e|mechanical|electrical|scaffold|groundworks|civils?)\b/i;
  var CO_OPER = /\b(hotels?|hospitality|resorts?|inns?|living|student|co-?living|serviced)\b/i;
  var CO_DEV = /\b(developments?|properties|property|estates|homes|housing|regeneration|land|realty|places|portfolio)\b/i;
  var CO_INTRO = /\b(solicitors|law|legal|agents|recruitment|insurance|accountants|brokers?)\b/i;
  var TITLE_FUND = /loan|monitoring|debt|lending|credit|investment|fund|portfolio|asset manag/i;
  var TITLE_DEV = /development director|head of development|land director|development manager|head of construction|construction director|project director/i;
  function typeFromNames(r) {
    var co = String(r.company || ''); var t = String(r.jobTitle || '');
    if (CO_CONSULT.test(co) && !CO_DEV.test(co)) return 'Consultancy';
    if (CO_CONTRACT.test(co)) return 'Contractor';
    if (CO_FUND.test(co) || TITLE_FUND.test(t)) return 'Funder / Investor';
    if (CO_OPER.test(co)) return 'Operator';
    if (CO_DEV.test(co) || TITLE_DEV.test(t)) return 'Developer / Owner';
    if (CO_INTRO.test(co)) return 'Introducer';
    return '';
  }
  function typeOf(r, d) {
    var seg = String((d && d.segment) || r.segment || r.fitSector || '').toLowerCase();
    var bt = r.intel && r.intel.buyer ? String(r.intel.buyer) : '';
    var byName = typeFromNames(r);
    // A founder-set segment wins; an imported one yields to clear evidence in the company name.
    if (!(d && d.segment) && byName && (byName === 'Consultancy' || byName === 'Contractor' || /other|unclassified|unknown|supplier/.test(seg) || !seg)) return byName;
    if (/developer|asset owner|landlord|housebuilder|regeneration/.test(seg) || bt === 'developer') return 'Developer / Owner';
    if (/investor|private equity|fund|lender|bank|debt|finance|family office/.test(seg) || /fund|lender|family_office/.test(bt)) return 'Funder / Investor';
    if (/hotel|operational|operator|hospitality|student|bts|btr/.test(seg) || bt === 'hotel_group') return 'Operator';
    if (/pm ?\/ ?qs|consultan|architect|designer|engineer|surveyor/.test(seg) || bt === 'consultancy') return 'Consultancy';
    if (/contractor|builder|subcontract|m&e|fit[- ]?out/.test(seg) || bt === 'contractor') return 'Contractor';
    if (/introducer|legal|agent|network|broker|recruit|insurance|accountant/.test(seg)) return 'Introducer';
    if (/public|housing association|council|nhs|university/.test(seg) || /public_body|owner_occupier/.test(bt)) return 'Public body';
    return byName || 'Other';
  }
  var SECTORS = { residential: 'Residential', btr: 'BTR', pbsa: 'PBSA', hotel: 'Hotel', hospitality: 'Hospitality', office: 'Office', mixed_use: 'Mixed use', data_centre: 'Data centre', industrial: 'Industrial', retail: 'Retail', leisure: 'Leisure', education: 'Education', health: 'Health', heritage: 'Heritage', later_living: 'Later living', life_sciences: 'Life sciences', infrastructure: 'Infrastructure', public: 'Public', unknown: '' };
  var SECTOR_RX = [['data_centre', /data ?cent|hyperscale|colocation/i], ['pbsa', /\bpbsa\b|student accommodation|student beds/i], ['btr', /\bbtr\b|build[- ]to[- ]rent|co-?living/i], ['hotel', /\bhotels?\b|aparthotel|serviced apartment/i], ['hospitality', /hospitality|restaurant|members.? club|leisure/i], ['later_living', /later living|retirement|care home|extra care/i], ['life_sciences', /life science|laborator/i], ['office', /\boffices?\b|workplace|hq\b/i], ['mixed_use', /mixed[- ]use/i], ['residential', /residential|\bhomes\b|apartments|\bflats\b|housing/i], ['industrial', /industrial|logistics|warehouse/i], ['retail', /\bretail\b|shopping/i], ['education', /school|university|college|campus/i], ['health', /hospital|clinic|healthcare|nhs/i], ['heritage', /listed|heritage|grade (i|ii)/i]];
  function sectorOf(r, d) {
    if (r.intel && r.intel.sector && SECTORS[r.intel.sector]) return SECTORS[r.intel.sector];
    var seg = String((d && d.segment) || r.segment || '').toLowerCase();
    if (/hotel|hospitality/.test(seg)) return 'Hotel';
    if (/student/.test(seg)) return 'PBSA';
    var text = [r.title, r.context, r.notes, r.fitReason].filter(Boolean).join(' ').slice(0, 800);
    for (var i = 0; i < SECTOR_RX.length; i++) if (SECTOR_RX[i][1].test(text)) return SECTORS[SECTOR_RX[i][0]];
    return '';
  }
  var STAGE_LABEL = { pre_planning: 'Pre-planning', submitted: 'Plans submitted', granted: 'Plans granted', refused: 'Refused', appeal: 'At appeal', funded: 'Funding secured', acquired: 'Site acquired', tender: 'Out to tender', contractor_appointed: 'Contractor appointed', on_site: 'On site', completed: 'Completed', stalled: 'Stalled', distress: 'Distress', leadership: 'People move', news: '', hiring: 'Hiring' };
  var SIG_STAGE = { property: 'Funding secured', lending: 'Funding secured', planning: 'Plans submitted', new_spv: 'New vehicle', new_director: 'People move', distress: 'Distress' };
  function stageOf(r) {
    if (r.intel && r.intel.stage && STAGE_LABEL[r.intel.stage]) return STAGE_LABEL[r.intel.stage];
    var sigs = (r.companyIntel && r.companyIntel.signals) || []; var best = null;
    for (var i = 0; i < sigs.length; i++) if (sigs[i].type !== 'inactive' && (!best || String(sigs[i].date) > String(best.date))) best = sigs[i];
    return best ? (SIG_STAGE[best.type] || '') : '';
  }
  function sizeOf(r) { return (r.intel && r.intel.valueBand && r.intel.valueBand !== 'Value unknown') ? r.intel.valueBand : ''; }

  function classify(r, d) {
    return { type: typeOf(r, d), sector: sectorOf(r, d), stage: stageOf(r), region: regionOf(r), size: sizeOf(r) };
  }
  /* Jev-style routing of a signal: fixed questions, typed answers, one action.
       verdict    approach | watch | ignore
       who        the role to contact
       offer      the one Vanor service this signal sells
       when       this week | this month | when it moves
       confidence high | medium | low
     Pure function of the record's intel block, so it applies to every lead the scanner ever added. */
  var ROLE = { developer: 'Development Director or MD', hotel_group: 'Group Property Director or Head of Development', fund: 'Head of Asset Management', family_office: 'The principal or their asset manager', lender: 'Director, Real Estate Finance', owner_occupier: 'Director of Estates or Head of Capital Projects', public_body: 'Head of Capital Projects', consultancy: 'Managing Director', contractor: 'the employer or funder behind the job', unknown: 'whoever loses money if the date moves' };
  var OFFER = { funded: 'peer review of the contractor\'s programme and cost before it starts', granted: 'peer review of programme and procurement before tender', tender: 'independent review of tender returns and programme', contractor_appointed: 'peer review of the contractor\'s programme before mobilisation', on_site: 'position finding on progress and cost', stalled: 'position finding: where the job really is and the options', distress: 'position finding and recovery for the exposed party', acquired: 'delivery assurance for the new owner', hiring: 'senior capacity while they recruit', submitted: 'watch until planning is decided', pre_planning: 'watch until it is submitted', appeal: 'watch until the appeal is decided', refused: 'watch', completed: 'none', news: 'none', leadership: 'none' };
  var APPROACH = { funded: 1, granted: 1, tender: 1, contractor_appointed: 1, on_site: 1, stalled: 1, distress: 1, acquired: 1, hiring: 1 };
  var WATCH = { submitted: 1, pre_planning: 1, appeal: 1, refused: 1 };
  function route(r, ctx) {
    ctx = ctx || {}; var i = (r && r.intel) || null;
    if (!i) return null;
    var stage = i.stage || 'news', buyer = i.buyerType || 'unknown', tier = i.tier || 'Watch', score = i.score || 0;
    var parties = i.parties || {}; var named = !!(parties.developer || parties.funder);
    var funderOnly = buyer === 'lender' || buyer === 'fund';
    var offer = OFFER[stage] || 'none'; if (funderOnly && APPROACH[stage]) offer = 'monitoring for the funder: programme, cost and drawdown';
    var out = function (verdict, when, conf, reason) { return { verdict: verdict, who: ROLE[buyer] || ROLE.unknown, offer: offer, when: when, confidence: conf, reason: reason, stage: stage, buyer: buyer }; };
    if (buyer === 'contractor') return out('ignore', 'never', 'high', 'Contractor, not a buyer');
    if (stage === 'news' || stage === 'leadership' || stage === 'completed') return out('ignore', 'never', 'high', 'Nothing to sell off this');
    if ((i.sector === 'infrastructure' || i.sector === 'public') && stage !== 'distress') return out('ignore', 'never', 'medium', 'Off-sector');
    if (stage === 'distress' && !named) return out('watch', 'when it moves', 'medium', 'Distress, but no exposed party named yet');
    if (WATCH[stage]) return out('watch', 'when it moves', named ? 'high' : 'medium', 'Too early: ' + stage.replace('_', ' '));
    if (!APPROACH[stage] || score < 35) return out('watch', 'when it moves', 'low', 'Weak signal');
    var conf = (tier === 'Hot' && named && buyer !== 'unknown') ? 'high' : (tier === 'Hot' || (named && buyer !== 'unknown')) ? 'medium' : 'low';
    var when = tier === 'Hot' ? 'this week' : tier === 'Warm' ? 'this month' : 'when it moves';
    if (conf === 'low' && tier === 'Watch') return out('watch', when, conf, 'Right stage, but nobody named and buyer unclear');
    return out('approach', when, conf, (i.why || '').split(' · ').slice(0, 2).join(', '));
  }
  function actionLine(r, ctx) { var x = route(r, ctx); if (!x) return ''; if (x.verdict === 'ignore') return 'Ignore: ' + x.reason; if (x.verdict === 'watch') return 'Watch: ' + x.reason; return 'Email the ' + x.who + ' at ' + (r.company || 'the company') + ': ' + x.offer + ' (' + x.when + ', confidence ' + x.confidence + ')'; }
  root.VanorClassify = { route: route, actionLine: actionLine, classify: classify, regionOf: regionOf, typeOf: typeOf, sectorOf: sectorOf, stageOf: stageOf, sizeOf: sizeOf, normRegion: normRegion, regionFromText: regionFromText, REGIONS: REGIONS, TYPES: TYPES };
})(typeof globalThis !== 'undefined' ? globalThis : this);
