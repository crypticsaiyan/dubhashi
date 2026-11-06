/** First code point of the digit block for each Indic script used here. */
const DIGIT_ZEROS = [0x0966, 0x09e6, 0x0a66, 0x0ae6, 0x0be6, 0x0c66, 0x0ce6, 0x0d66];

export function normalizeDigits(text: string): string {
  return text.replace(/\p{Nd}/gu, (char) => {
    const code = char.codePointAt(0) ?? 0;
    const zero = DIGIT_ZEROS.find((start) => code >= start && code <= start + 9);
    return zero === undefined ? char : String(code - zero);
  });
}

/** Numbers in the text, with grouping commas removed. */
export function extractNumbers(text: string): string[] {
  const matches = normalizeDigits(text).match(/\d[\d,.]*/g) ?? [];
  return matches.map((value) => value.replace(/,/g, "").replace(/\.+$/, ""));
}

/**
 * Numbers in the source that did not survive translation. This check needs no
 * LLM, so it still catches a dropped dose when the model reports no facts.
 */
export function missingNumbers(source: string, target: string): string[] {
  const remaining = extractNumbers(target);
  return extractNumbers(source).filter((value) => {
    const index = remaining.indexOf(value);
    if (index === -1) return true;
    remaining.splice(index, 1);
    return false;
  });
}

/** Splits text at sentence ends so each TTS request stays short. */
export function splitForTts(text: string, maxChars = 280): string[] {
  const sentences = text.match(/[^.!?।॥\n]+[.!?।॥]*\s*/g) ?? [text];
  const parts: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (current && current.length + sentence.length > maxChars) {
      parts.push(current.trim());
      current = "";
    }
    current += sentence;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}
