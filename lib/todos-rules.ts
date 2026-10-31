// Placeholder text that must never reach a draft (31 Oct 2026: a draft went out reading "introduce me to Development Director or MD").
const PLACEHOLDER = /(\b(?:development director or md|whoever loses money|tbc name|first name|insert name)\b|head of [a-z ]+\(target role\)|<[^>]+>|\[[A-Z][A-Z _]+\]|\{[a-z_]+\})/i;
export const hasPlaceholder = (s = '') => PLACEHOLDER.test(String(s));

