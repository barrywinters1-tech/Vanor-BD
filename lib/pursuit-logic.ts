// Pure helpers for the pursuit flow (no store access).
const DAY = 864e5;
/** Add working days (Mon–Fri) to a yyyy-mm-dd date. */
export function addWorkingDays(from: string, n: number) {
  let d = new Date(from + 'T00:00:00Z'); let left = n;
  while (left > 0) { d = new Date(d.getTime() + DAY); const wd = d.getUTCDay(); if (wd !== 0 && wd !== 6) left--; }
  return d.toISOString().slice(0, 10);
}
/** Follow-up date after an email: 5 working days, 7 once two chases have gone unanswered. */
export const followUpAfter = (sentAt: string, chases: number) => addWorkingDays(sentAt, chases >= 2 ? 7 : 5);
