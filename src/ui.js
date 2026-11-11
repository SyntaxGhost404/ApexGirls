// Themed building blocks shared by every feature.
import { container, text, gallery, v2, separator } from './core/components.js';
import { BRAND, COLORS, ICON } from './content/theme.js';

export const TONES = { danger: COLORS.danger, warning: COLORS.warning, success: COLORS.success, info: COLORS.info, primary: COLORS.primary, accent: COLORS.accent, gold: COLORS.gold };

export const heading = (title, sub) => text(`## ${title}${sub ? `\n-# ${sub}` : ''}`);
export const subheading = (title, sub) => text(`### ${title}${sub ? `\n-# ${sub}` : ''}`);
export const footnote = (t) => text(`-# ${t}`);
export const divider = (large = false) => separator({ divider: true, spacing: large ? 2 : 1 });

/** A compact one-container notice (ephemeral by default). */
export function notice(title, body, { tone = 'info', ephemeral = true, extra = [], mentions = [] } = {}) {
  return v2([container({ accent: TONES[tone] ?? COLORS.info }, text(`### ${title}\n${body}`), ...extra)], { ephemeral, mentions });
}

export function errorNotice(err) {
  const icon = err.tone === 'warning' ? ICON.warn : ICON.no;
  return notice(`${icon} ${err.title || 'Request denied'}`, err.message, { tone: err.tone || 'danger' });
}

export const success = (title, body, opts = {}) => notice(`${ICON.ok} ${title}`, body, { tone: 'success', ...opts });

/** Optional staff-configured banner image (official art, uploaded by the server team). */
export function banner(settings) {
  const url = settings?.branding?.bannerUrl;
  return url && /^https:\/\//.test(url) ? gallery(url) : null;
}

export const brandFooter = (extra) => footnote(extra ? `${BRAND.system} · ${extra}` : BRAND.footer);
