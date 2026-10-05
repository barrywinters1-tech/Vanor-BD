export const BUYING_FACTS = [
  'namedProblem',
  'economicBuyer',
  'feeOrBudget',
  'decisionDate',
  'agreedNextStep',
] as const;

export type BuyingFact = typeof BUYING_FACTS[number];
export type BuyingEvidence = Partial<Record<BuyingFact, { confirmed: boolean; evidence: string }>>;
export type LeadRoute = 'partner' | 'approval_draft' | 'nurture' | 'parked';

export function scoreBuyingFacts(evidence: BuyingEvidence | null | undefined) {
  const confirmed = BUYING_FACTS.filter(fact => {
    const item = evidence?.[fact];
    return item?.confirmed === true && Boolean(item.evidence?.trim());
  });
  return { score: confirmed.length, confirmed, missing: BUYING_FACTS.filter(fact => !confirmed.includes(fact)) };
}

export function routeLead(input: {
  buyingEvidence?: BuyingEvidence | null;
  archived?: boolean;
  optedOut?: boolean;
  chaseCount?: number;
  meetingsWithoutProblem?: number;
  proposalWithoutPilotFollowups?: number;
  positiveReply?: boolean;
  meetingRequest?: boolean;
}): { route: LeadRoute; score: number; reason: string } {
  const { score } = scoreBuyingFacts(input.buyingEvidence);
  if (input.archived || input.optedOut) return { route: 'parked', score, reason: input.optedOut ? 'Contact opted out' : 'Lead archived' };
  if ((input.chaseCount || 0) >= 2) return { route: 'parked', score, reason: 'Two unanswered chases' };
  if ((input.meetingsWithoutProblem || 0) >= 2) return { route: 'nurture', score, reason: 'Two meetings without a named problem' };
  if ((input.proposalWithoutPilotFollowups || 0) >= 1) return { route: 'parked', score, reason: 'Proposal follow-up completed without a named pilot' };
  if (input.positiveReply || input.meetingRequest) return { route: 'partner', score, reason: 'Positive reply or meeting request' };
  if (score >= 4) return { route: 'partner', score, reason: 'Four or more evidenced buying facts' };
  if (score >= 2) return { route: 'approval_draft', score, reason: 'Two or three evidenced buying facts' };
  return { route: 'nurture', score, reason: 'Zero or one evidenced buying fact' };
}

export function draftFollowUp(input: {
  firstName?: string;
  company?: string;
  project?: string;
  problem?: string;
  nextAsk?: string;
  senderName: string;
}) {
  const greeting = input.firstName?.trim() ? `Hi ${input.firstName.trim()},` : 'Hello,';
  const context = input.project?.trim() && input.problem?.trim()
    ? `I wanted to follow up on ${input.project.trim()} and the ${input.problem.trim()} issue we discussed.`
    : input.company?.trim()
      ? `I wanted to follow up on our conversation about ${input.company.trim()}.`
      : 'I wanted to follow up on our conversation.';
  const ask = input.nextAsk?.trim() || 'Would a short call next week be useful to agree the next step?';
  return {
    subject: input.project?.trim() ? `Following up: ${input.project.trim()}` : 'Following up',
    body: `${greeting}\n\n${context}\n\n${ask}\n\nBest,\n${input.senderName}`,
  };
}

export function isPotentialReply(body: string) {
  const text = body.toLowerCase();
  if (/unsubscribe|remove me|do not contact|stop emailing/i.test(text)) return 'opt_out' as const;
  if (/let.s (talk|meet)|happy to (talk|meet)|schedule a (call|meeting)|send (me|us) (a|the) proposal|please call/i.test(text))
    return 'positive' as const;
  if (/not interested|no thanks|not relevant|already appointed/i.test(text)) return 'negative' as const;
  return 'unclear' as const;
}
