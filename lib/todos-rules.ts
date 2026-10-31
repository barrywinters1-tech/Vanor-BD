// Placeholder text that must never reach a draft (31 Oct 2026: a draft went out reading "introduce me to Development Director or MD").
const PLACEHOLDER_WORDS = /\b(?:development director or md|whoever loses money|tbc name|insert name|\[first name\]|first_name)\b|head of [a-z ]+\(target role\)/i;
const PLACEHOLDER_MARKS = /<[a-z_ ]{2,30}>|\[[A-Z][A-Z _]{2,30}\]|\{[a-z_]{2,30}\}/;
export const hasPlaceholder = (s = '') => PLACEHOLDER_WORDS.test(String(s)) || PLACEHOLDER_MARKS.test(String(s));

