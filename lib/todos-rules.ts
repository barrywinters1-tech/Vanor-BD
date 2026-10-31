// Placeholder text that must never reach a draft (31 Oct 2026: a draft went out reading "introduce me to Development Director or MD").
const PLACEHOLDER = /\b(development director or md|head of [a-z ]+ \(target role\)|whoever loses money|<[^>]+>|\[[A-Z][A-Z ]+\]|\{[a-z_]+\}|TBC name|first name)\b/i;
export const hasPlaceholder = (s = '') => PLACEHOLDER.test(String(s));

