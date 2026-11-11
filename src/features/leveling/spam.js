// Message quality analysis for XP eligibility. Rewards real conversation, not spam:
// short/empty, repetitive, copy-pasted and near-duplicate messages earn nothing.

const CJK = /[぀-ヿ㐀-䶿一-鿿가-힯豈-﫿]/u;

export function normalizeContent(raw) {
  return String(raw || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<a?:\w+:\d+>/g, ' ')
    .replace(/<(?:@[!&]?|#)\d+>/g, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{Extended_Pictographic}‍️]/gu, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Length where CJK characters count double (one CJK glyph ≈ one short word). */
export function weightedLength(normalized) {
  let n = 0;
  for (const ch of normalized.replace(/\s/g, '')) n += CJK.test(ch) ? 2 : 1;
  return n;
}

export function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const wa = a.split(' ');
  const wb = b.split(' ');
  if (wa.length <= 2 && wb.length <= 2) return 0; // short different messages are fine
  const sa = new Set(wa);
  const sb = new Set(wb);
  let inter = 0;
  for (const w of sa) if (sb.has(w)) inter += 1;
  return inter / (sa.size + sb.size - inter);
}

/**
 * @param {string} content
 * @param {{ attachments?: number, stickers?: number, minChars?: number, recent?: string[], hasContent?: boolean }} options
 * @returns {{ ok: boolean, reason?: string, normalized?: string|null, quality?: number }}
 */
export function analyzeMessage(content, { attachments = 0, stickers = 0, minChars = 6, recent = [], hasContent = true } = {}) {
  if (!hasContent) return { ok: true, normalized: null, quality: 1 };
  const normalized = normalizeContent(content);
  const length = weightedLength(normalized);
  const media = attachments + stickers > 0;
  if (!normalized && !media) return { ok: false, reason: 'empty' };
  if (length < minChars && !media) return { ok: false, reason: 'too-short' };
  if (normalized) {
    const letters = normalized.replace(/\s/g, '');
    if (letters.length >= 8 && new Set(letters).size <= 3) return { ok: false, reason: 'repetitive' };
    if (/(.{1,4})\1{5,}/u.test(letters)) return { ok: false, reason: 'repetitive' };
    const words = normalized.split(' ');
    if (words.length >= 6 && new Set(words).size / words.length < 0.35) return { ok: false, reason: 'repetitive' };
    for (const prev of recent) if (similarity(prev, normalized) >= 0.8) return { ok: false, reason: 'duplicate' };
  }
  return { ok: true, normalized, quality: media && length < minChars ? 0.6 : 1 };
}
