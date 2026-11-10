/** 받침 유무에 따라 목적격 조사(을/를)를 붙인다. 한글이 아니면 "를"을 쓴다. */
export function withObjectParticle(word: string): string {
  const last = word.trim().at(-1);
  if (!last) return word;
  const code = last.charCodeAt(0);
  const isHangul = code >= 0xac00 && code <= 0xd7a3;
  const hasFinal = isHangul && (code - 0xac00) % 28 !== 0;
  return `${word}${hasFinal ? "을" : "를"}`;
}
