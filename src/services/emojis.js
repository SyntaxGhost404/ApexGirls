// Application emoji registry: uses the app's own uploaded emojis when present, Unicode otherwise.

export class EmojiRegistry {
  constructor(bot) {
    this.bot = bot;
    this.byName = new Map();
  }

  async load() {
    try {
      const res = await this.bot.rest.get(`/applications/${this.bot.applicationId}/emojis`);
      const items = Array.isArray(res) ? res : res?.items || [];
      for (const e of items) this.byName.set(e.name, `<${e.animated ? 'a' : ''}:${e.name}:${e.id}>`);
      this.bot.log.info(`loaded ${items.length} application emojis`);
    } catch (err) {
      this.bot.log.warn(`could not load application emojis: ${err.message}`);
    }
  }

  get(name, fallback) {
    return this.byName.get(name) || fallback;
  }

  get hasBar() {
    return ['HEAD', 'BETWEEN', 'LAST'].every((part) => ['EMPTY', 'FULL', 'HALF'].every((state) => this.byName.has(`PROGRESS_BAR_${state}_${part}`)));
  }

  /** Progress bar using the app's PROGRESS_BAR_* emojis when uploaded, otherwise ▰▱ blocks. */
  bar(value, max, size = 8) {
    const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
    if (!this.hasBar) {
      const filled = Math.round(ratio * size);
      return '▰'.repeat(filled) + '▱'.repeat(size - filled);
    }
    const units = ratio * size;
    const full = Math.floor(units);
    const half = units - full >= 0.5;
    const out = [];
    for (let i = 0; i < size; i += 1) {
      const part = i === 0 ? 'HEAD' : i === size - 1 ? 'LAST' : 'BETWEEN';
      const state = i < full ? 'FULL' : i === full && half ? 'HALF' : 'EMPTY';
      out.push(this.byName.get(`PROGRESS_BAR_${state}_${part}`));
    }
    return out.join('');
  }
}
