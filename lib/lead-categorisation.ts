export const SEGMENTS = [
  'Developer / Asset Owner', 'Lender / Debt Fund', 'Investor / Private Equity',
  'Hotel / Operational Real Estate', 'Data Centre', 'Public Sector', 'PM / QS',
  'Contractor', 'Designer / Consultant', 'Introducer / Professional Network',
  'Other / Unclassified',
] as const;

export const SERVICES = [
  'Project & Development Management', 'Project Recovery & Delivery Assurance',
  'Cost & Commercial Management', 'Fund Monitoring & Technical Due Diligence',
  "Employer's Agent", 'Procurement & Contract Strategy', 'Programme & PMO',
  'Building Safety & Compliance', 'Strategic Advisory / Feasibility', 'To confirm',
] as const;

export const PRIORITIES = ['High', 'Medium', 'Low', 'Review'] as const;

type Lead = Record<string, any>;
type Candidate = { value: string; score: number; probability: number };
const text = (lead: Lead) => [lead.name, lead.company, lead.jobTitle, lead.title, lead.segment, lead.context, lead.notes, lead.sourceStage, lead.route, lead.nextAsk, typeof lead.raw === 'object' ? JSON.stringify(lead.raw) : lead.raw].filter(Boolean).join(' ').toLowerCase();

const patterns: Record<string, RegExp[]> = {
  'Developer / Asset Owner': [/\bdeveloper|development director|property company|asset owner|landowner|housebuilder|housing association|registered provider|estate\b/],
  'Lender / Debt Fund': [/\blend(?:er|ing)|bank\b|credit|loan/, /debt fund|development finance|real estate finance/],
  'Investor / Private Equity': [/\binvestor|investment|private equity|fund manager|capital partner|family office|asset management/],
  'Hotel / Operational Real Estate': [/\bhotel|hospitality|operator|serviced apartment|student accommodation|care home|later living/],
  'Data Centre': [/data cent(re|er)|digital infrastructure|colocation|hyperscale/],
  'Public Sector': [/\bcouncil|local authority|government|nhs|public sector|borough|homes england/],
  'PM / QS': [/project management|quantity survey|cost consultant|\bpm\b|\bqs\b|construction consultant/],
  Contractor: [/\bcontractor|construction group|main contract|design and build|fit.?out contractor/],
  'Designer / Consultant': [/architect|engineer|planning consultant|designer|surveying|consultancy|consultant/],
  'Introducer / Professional Network': [/law firm|solicitor|accountant|broker|agent|recruit|events|network|introduc|referr/],
};

const servicePatterns: Record<string, RegExp[]> = {
  'Project & Development Management': [/project management|development management|client.?side|delivery management|new build|refurbishment/],
  'Project Recovery & Delivery Assurance': [/distress|recovery|stalled|delay|overrun|delivery risk|independent assurance|peer review|rescue/],
  'Cost & Commercial Management': [/cost plan|quantity survey|commercial management|budget|cost overrun|final account|value engineering/],
  'Fund Monitoring & Technical Due Diligence': [/fund monitor|development monitor/, /technical due diligence/, /lender|debt fund|investment committee|acquisition/],
  "Employer's Agent": [/employer.?s agent|design and build|jct|contract administration/],
  'Procurement & Contract Strategy': [/procurement|contract strategy|tender|contractor selection|pre.?construction/],
  'Programme & PMO': [/programme|pmo|portfolio|dashboard|reporting|controls|schedule/],
  'Building Safety & Compliance': [/building safety|gateway|high.?rise|higher.?risk|fire safety|compliance/],
  'Strategic Advisory / Feasibility': [/feasibility|viability|strategy|business plan|options appraisal|site review|development advisory/],
};

function rank(input: string, values: readonly string[], rules: Record<string, RegExp[]>, prior = ''): Candidate[] {
  const scores = values.map(value => { let score = value === prior ? 2 : 0; for (const pattern of rules[value] || []) if (pattern.test(input)) score += 3; return { value, score }; }).sort((a, b) => b.score - a.score);
  const total = scores.reduce((sum, item) => sum + Math.exp(item.score / 3), 0);
  return scores.map(item => ({ ...item, probability: Math.exp(item.score / 3) / total }));
}

export function categoriseLead(lead: Lead) {
  const input = text(lead);
  const segmentRank = rank(input, SEGMENTS.filter(x => x !== 'Other / Unclassified'), patterns, lead.segment || '');
  const serviceRank = rank(input, SERVICES.filter(x => x !== 'To confirm'), servicePatterns);
  const segmentTop = segmentRank[0], serviceTop = serviceRank[0];
  const evidenceCount = [lead.company, lead.jobTitle, lead.context, lead.notes, lead.nextAsk].filter(x => String(x || '').trim()).length;
  const ambiguous = (list: Candidate[]) => list.length > 1 && list[0].score > 0 && list[0].score - list[1].score < 2;
  const reviewReasons: string[] = [];
  if (evidenceCount < 2) reviewReasons.push('Insufficient information');
  if (!segmentTop || segmentTop.score < 2) reviewReasons.push('Sector is unclear'); else if (ambiguous(segmentRank)) reviewReasons.push('More than one sector is plausible');
  if (!serviceTop || serviceTop.score < 2) reviewReasons.push('Required Vanor service is unclear'); else if (ambiguous(serviceRank)) reviewReasons.push('More than one Vanor service is plausible');
  const urgency = /urgent|immediate|live project|tender|proposal|fee|appointment|decision|deadline|this week|overdue/.test(input);
  const buyer = /director|chief|head of|partner|founder|owner|investor|lender|client/.test(input);
  const warm = /meeting|replied|introduced|referral|prior work|known contact|conversation|catch.?up/.test(input);
  const priorityScore = (urgency ? 3 : 0) + (buyer ? 2 : 0) + (warm ? 2 : 0) + (evidenceCount >= 4 ? 1 : 0);
  const priority = reviewReasons.includes('Insufficient information') ? 'Review' : priorityScore >= 6 ? 'High' : priorityScore >= 3 ? 'Medium' : 'Low';
  const confidence = Math.round(100 * Math.min(segmentTop?.probability || 0, serviceTop?.probability || 0));
  return { segment: segmentTop?.score >= 2 ? segmentTop.value : 'Other / Unclassified', service: serviceTop?.score >= 2 ? serviceTop.value : 'To confirm', priority, confidence, needsReview: reviewReasons.length > 0 || confidence < 45, reviewReasons: confidence < 45 && !reviewReasons.length ? ['Low classification confidence'] : reviewReasons, alternatives: { segments: segmentRank.slice(0, 3).map(({ value, probability }) => ({ value, confidence: Math.round(probability * 100) })), services: serviceRank.slice(0, 3).map(({ value, probability }) => ({ value, confidence: Math.round(probability * 100) })) }, version: 'vanor-structured-v1' };
}
