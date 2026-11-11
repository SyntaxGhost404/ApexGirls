// Supply Depot (/shop) and Inventory (/inventory) UI, purchase flow and cosmetics.
import { UserError } from '../../core/interactions.js';
import { button, container, label, modal, row, section, separator, stringSelect, text, textInput, v2, ButtonStyle } from '../../core/components.js';
import { canAssignRole } from '../../core/permissions.js';
import { COLORS, ICON } from '../../content/theme.js';
import { ITEM_KINDS } from '../../content/defaults.js';
import { RELICS } from '../../content/lore.js';
import { discordTime } from '../../util/time.js';
import { sanitizeInline } from '../../util/format.js';
import { levelFor } from '../leveling/curve.js';
import { pager, requireGuild } from '../common.js';
import { banner, success } from '../../ui.js';
import { Catalog } from './catalog.js';
import { setupRequisitions, REQUISITION_STATUS } from './requisitions.js';
import { SHIELD_KEY } from '../daily.js';

const PAGE = 5;
const CATEGORIES = { all: { label: 'Everything', emoji: '🛒' }, ...ITEM_KINDS };

function windowLabel(period) {
  return { daily: 'today', weekly: 'this week', monthly: 'this month', lifetime: 'in total', none: '' }[period] || '';
}

export default function setup(bot) {
  const catalog = new Catalog(bot);
  bot.services.catalog = catalog;
  const reqs = setupRequisitions(bot);

  function itemMeta(guildId, userId, item, level) {
    const bits = [];
    if (item.min_level) bits.push(level >= item.min_level ? `Lv ${item.min_level}+` : `${ICON.lock} Lv ${item.min_level}`);
    if (item.limit_count && item.limit_period !== 'none') bits.push(`limit ${catalog.boughtBy(guildId, userId, item)}/${item.limit_count} ${windowLabel(item.limit_period)}`);
    const sold = catalog.sold(guildId, item);
    if (sold !== null) bits.push(sold >= item.stock ? 'sold out' : `${item.stock - sold} left${item.stock_period !== 'none' ? ` ${windowLabel(item.stock_period)}` : ''}`);
    if (catalog.owns(guildId, userId, item)) bits.push('owned');
    if (item.kind === 'role' && item.data.days) bits.push(`${item.data.days}-day role`);
    if (item.kind === 'fulfillment') bits.push('staff-fulfilled');
    return bits.join(' · ');
  }

  function renderCatalog(guildId, userId, category = 'all', page = 0) {
    const settings = bot.settings.get(guildId);
    const currency = bot.settings.currency(guildId);
    const rec = bot.members.ensure(guildId, userId);
    const level = levelFor(rec.xp, settings.leveling.curveScale);
    const items = catalog.list(guildId, { kind: category === 'all' ? null : category });
    const pages = Math.max(1, Math.ceil(items.length / PAGE));
    const p = Math.min(Math.max(0, page), pages - 1);
    const parts = [
      banner(settings),
      text(`## ${ICON.shop} Supply Depot\n-# Noah Industries logistics · trade ${currency.name} for cosmetics, perks and in-game rewards`),
      text(`Balance ${currency.long(rec.shards)} · Level **${level}**`),
      row(stringSelect({
        id: 'shop:cat',
        placeholder: 'Filter by category',
        options: Object.entries(CATEGORIES).map(([k, c]) => ({ label: c.label, value: k, emoji: c.emoji, description: c.hint?.slice(0, 100), default: k === category })),
      })),
      separator(),
    ];
    const slice = items.slice(p * PAGE, p * PAGE + PAGE);
    if (!slice.length) parts.push(text('*Nothing stocked in this category right now. Check back after the next supply run.*'));
    for (const item of slice) {
      const meta = itemMeta(guildId, userId, item, level);
      parts.push(section(
        [`**${item.emoji ? `${item.emoji} ` : ''}${sanitizeInline(item.name, 80)}** — ${currency.fmt(item.price)}`, `${sanitizeInline(item.description, 140) || ITEM_KINDS[item.kind]?.hint || ''}${meta ? `\n-# ${meta}` : ''}`],
        button({ id: `shop:item:${item.id}:${category}:${p}`, label: 'View', style: ButtonStyle.Secondary }),
      ));
    }
    if (pages > 1) parts.push(pager(`shop:pg:${category}`, p, pages));
    parts.push(row(
      button({ id: 'inv:open', label: 'Inventory', emoji: ICON.inventory }),
      button({ id: 'inv:reqs', label: 'My requisitions', emoji: ICON.requisition }),
      button({ id: 'daily:claim', label: 'Supply Airdrop', emoji: ICON.airdrop }),
    ));
    return v2([container({ accent: COLORS.primary }, ...parts)], { ephemeral: true });
  }

  function renderItem(guildId, userId, item, { category = 'all', page = 0, memberRoles = [] } = {}) {
    const currency = bot.settings.currency(guildId);
    const settings = bot.settings.get(guildId);
    const rec = bot.members.ensure(guildId, userId);
    const level = levelFor(rec.xp, settings.leveling.curveScale);
    const blocker = catalog.blocker(guildId, userId, item, 1, { memberRoles });
    const lines = [
      `## ${item.emoji ? `${item.emoji} ` : ''}${sanitizeInline(item.name, 80)}`,
      sanitizeInline(item.description, 300) || ITEM_KINDS[item.kind]?.hint || '',
      '',
      `**Price** ${currency.long(item.price)}`,
      `**Type** ${ITEM_KINDS[item.kind]?.emoji || ''} ${ITEM_KINDS[item.kind]?.label || item.kind}`,
    ];
    if (item.kind === 'role' && item.role_id) lines.push(`**Role** <@&${item.role_id}>${item.data.days ? ` for ${item.data.days} days` : ''}`);
    if (item.kind === 'title') lines.push(`**Title** 「${sanitizeInline(item.data.title || item.name, 40)}」`);
    if (item.kind === 'consumable' && item.data.effect === 'xp_boost') lines.push(`**Effect** +${(item.data.percent || 125) - 100}% XP for ${item.data.minutes || 60} minutes`);
    const meta = itemMeta(guildId, userId, item, level);
    if (meta) lines.push(`-# ${meta}`);
    lines.push('');
    lines.push(blocker ? `${ICON.lock} ${blocker}` : `${ICON.ok} You can buy this. Balance after purchase: ${currency.fmt(rec.shards - item.price)}`);
    const stackable = item.kind === 'consumable';
    return v2([container({ accent: blocker ? COLORS.steel : COLORS.success },
      text(lines.join('\n')),
      separator(),
      row(
        button({ id: `shop:buy:${item.id}:${category}:${page}`, label: item.kind === 'fulfillment' ? 'Request reward' : stackable ? 'Buy…' : 'Buy', emoji: ICON.shop, style: ButtonStyle.Success, disabled: Boolean(blocker) }),
        button({ id: `shop:back:${category}:${page}`, label: 'Back to depot', emoji: ICON.back }),
      ),
    )], { ephemeral: true });
  }

  function confirmView(guildId, item, qty, category, page) {
    const currency = bot.settings.currency(guildId);
    return v2([container({ accent: COLORS.warning },
      text(`### ${ICON.shop} Confirm purchase\n**${qty}× ${sanitizeInline(item.name, 80)}** for ${currency.long(item.price * qty)}?`),
      row(
        button({ id: `shop:confirm:${item.id}:${qty}:${category}:${page}`, label: 'Confirm', emoji: ICON.ok, style: ButtonStyle.Success }),
        button({ id: `shop:item:${item.id}:${category}:${page}`, label: 'Cancel', emoji: ICON.back }),
      ),
    )], { ephemeral: true });
  }

  /** Execute a purchase and deliver it. Returns a result payload. */
  async function execute(ctx, guildId, itemId, qty, details = null) {
    const result = catalog.purchase(guildId, ctx.userId, itemId, qty, { memberRoles: ctx.memberRoles });
    const { item } = result;
    const currency = bot.settings.currency(guildId);
    let detail = '';
    if (item.kind === 'role') {
      const check = canAssignRole(bot.cache, guildId, item.role_id);
      try {
        if (!check.ok) throw new Error(check.reason);
        await bot.api.addRole(guildId, ctx.userId, item.role_id, `Supply Depot purchase: ${item.name}`);
        if (item.data.days) {
          const expires = Date.now() + item.data.days * 86_400_000;
          bot.db.run('INSERT INTO timed_roles (guild_id, user_id, role_id, expires_at) VALUES (?, ?, ?, ?) ON CONFLICT(guild_id, user_id, role_id) DO UPDATE SET expires_at = excluded.expires_at', guildId, ctx.userId, item.role_id, expires);
          bot.scheduler.schedule(`role:${guildId}:${ctx.userId}:${item.role_id}`, 'role.expire', expires, { guildId, userId: ctx.userId, roleId: item.role_id });
          detail = `<@&${item.role_id}> is yours until ${discordTime(expires, 'f')}.`;
        } else detail = `<@&${item.role_id}> has been added to your profile.`;
      } catch (err) {
        catalog.refund(guildId, result.purchaseId, 'Role could not be granted');
        await bot.services.audit.warn(guildId, `shoprole:${item.role_id}`, `Supply Depot role item **${item.name}** could not be granted: ${err.message}`);
        throw new UserError(`The role could not be granted, so your ${currency.name} were refunded. The staff team has been notified.`, { title: 'Delivery failed' });
      }
    } else if (item.kind === 'fulfillment') {
      const r = await reqs.file(guildId, ctx.userId, { source: 'shop', itemId: item.id, purchaseId: result.purchaseId, title: item.name, quantity: qty, cost: result.total, ...details });
      detail = `Requisition **#${r.id}** filed for the staff team. You will get a DM when it ships (keep DMs from server members open). Rejected requests are refunded automatically.`;
      bot.members.update(guildId, ctx.userId, { game_region: details.region, game_server: details.server, game_uid: details.uid });
    } else if (item.kind === 'title' || item.kind === 'accent') {
      detail = `Added to your inventory — equip it from \`/inventory\`.`;
    } else if (item.kind === 'consumable') {
      detail = item.data.effect === 'streak_shield' ? 'Streak Shields are used automatically when you miss one day.' : 'Activate it from `/inventory` whenever you are ready to grind.';
    }
    bot.activity({ type: 'purchase', guildId, userId: ctx.userId, key: String(item.id) });
    await bot.services.audit.log(guildId, { title: `${ICON.shop} Purchase · ${item.name}`, userId: ctx.userId, color: COLORS.info, fields: [{ name: 'Quantity', value: String(qty) }, { name: 'Total', value: String(result.total) }, { name: 'Balance', value: String(result.balance) }] });
    const extra = [];
    if (item.kind === 'title' || item.kind === 'accent') extra.push(row(button({ id: 'inv:open', label: 'Open inventory', emoji: ICON.inventory, style: ButtonStyle.Primary }), button({ id: 'shop:back:all:0', label: 'Keep shopping', emoji: ICON.shop })));
    else extra.push(row(button({ id: 'shop:back:all:0', label: 'Keep shopping', emoji: ICON.shop })));
    return success('Purchase complete', `**${qty}× ${sanitizeInline(item.name, 80)}** for ${currency.fmt(result.total)}. Balance: ${currency.fmt(result.balance)}.\n${detail}`, { extra });
  }

  // ── Inventory ────────────────────────────────────────────────────────────
  function inventoryRows(guildId, userId) {
    return bot.db.all('SELECT * FROM inventory WHERE guild_id = ? AND user_id = ? AND quantity > 0 ORDER BY acquired_at', guildId, userId).map((r) => ({ ...r, data: JSON.parse(r.data || '{}') }));
  }

  function renderInventory(guildId, userId, { note } = {}) {
    const rec = bot.members.ensure(guildId, userId);
    const inv = inventoryRows(guildId, userId);
    const titles = inv.filter((i) => i.item_key.startsWith('title:'));
    const accents = inv.filter((i) => i.item_key.startsWith('accent:'));
    const shields = inv.find((i) => i.item_key === SHIELD_KEY);
    const boosts = inv.filter((i) => i.item_key.startsWith('boost:'));
    const relics = inv.filter((i) => i.item_key.startsWith('relic:'));
    const parts = [text(`## ${ICON.inventory} Inventory\n-# Equip cosmetics and use perks bought in the Supply Depot`)];
    if (note) parts.push(text(note));
    parts.push(separator());
    parts.push(text(`### 🏷️ Titles\n${rec.title ? `Equipped: 「${sanitizeInline(rec.title, 40)}」` : 'No title equipped.'}${titles.length ? '' : '\n-# Buy titles in the Supply Depot.'}`));
    if (titles.length) {
      parts.push(row(stringSelect({
        id: 'inv:title',
        placeholder: 'Equip a title',
        options: [{ label: 'No title', value: 'none', emoji: '➖' }, ...titles.slice(0, 24).map((t) => ({ label: t.data.title || t.data.name || 'Title', value: t.item_key, emoji: t.data.emoji || '🏷️', default: rec.title === t.data.title }))],
      })));
    }
    parts.push(text(`### 🎨 Card accents\n${rec.accent !== null && rec.accent !== undefined ? `Equipped: \`#${rec.accent.toString(16).padStart(6, '0')}\`` : 'Default (faction colour).'}`));
    if (accents.length) {
      parts.push(row(stringSelect({
        id: 'inv:accent',
        placeholder: 'Equip a card accent',
        options: [{ label: 'Default (faction colour)', value: 'none', emoji: '➖' }, ...accents.slice(0, 24).map((a) => ({ label: a.data.name || 'Accent', value: a.item_key, emoji: a.data.emoji || '🎨', default: rec.accent === a.data.color }))],
      })));
    }
    const boostActive = rec.boost_until && rec.boost_until > Date.now();
    const consumables = [];
    consumables.push(`${ICON.shield} Streak Shield ×${shields?.quantity || 0} *(used automatically)*`);
    for (const b of boosts) consumables.push(`${b.data.emoji || ICON.boost} ${b.data.name || 'Booster'} ×${b.quantity}`);
    if (boostActive) consumables.push(`${ICON.boost} **Booster active** — +${(rec.boost_mult || 100) - 100}% XP until ${discordTime(rec.boost_until, 't')} (${discordTime(rec.boost_until, 'R')})`);
    parts.push(text(`### 🧪 Consumables\n${consumables.join('\n')}`));
    if (boosts.length && !boostActive) {
      parts.push(row(stringSelect({
        id: 'inv:boost',
        placeholder: 'Activate a booster',
        options: boosts.slice(0, 25).map((b) => ({ label: `${b.data.name || 'Booster'} (×${b.quantity})`, value: b.item_key, emoji: b.data.emoji || ICON.boost, description: `+${(b.data.percent || 125) - 100}% XP for ${b.data.minutes || 60} min` })),
      })));
    }
    parts.push(text(`### ${ICON.relic} Relics\n${relics.length}/${RELICS.length} discovered on expeditions.`));
    parts.push(separator());
    parts.push(row(
      button({ id: 'exp:relics', label: 'Relic archive', emoji: ICON.relic }),
      button({ id: 'inv:reqs', label: 'Requisitions', emoji: ICON.requisition }),
      button({ id: 'shop:back:all:0', label: 'Supply Depot', emoji: ICON.shop }),
    ));
    return v2([container({ accent: COLORS.accent }, ...parts)], { ephemeral: true });
  }

  function requisitionsPanel(guildId, userId) {
    const list = reqs.forUser(guildId, userId, 8);
    const parts = [text(`## ${ICON.requisition} Your requisitions\n-# In-game rewards are delivered by the staff team to the UID you provided`)];
    if (!list.length) parts.push(text('*No requisitions yet. In-game rewards from the Supply Depot, giveaways and season prizes appear here.*'));
    for (const r of list) {
      const s = REQUISITION_STATUS[r.status];
      const line = `**#${r.id} · ${sanitizeInline(r.title, 60)}**${r.quantity > 1 ? ` ×${r.quantity}` : ''}\n${s.emoji} ${s.label} · filed ${discordTime(r.created_at, 'R')}${r.staff_note && r.status === 'rejected' ? `\n-# ${sanitizeInline(r.staff_note, 120)}` : ''}`;
      parts.push(r.status === 'pending' && r.source === 'shop'
        ? section(line, button({ id: `req:cancel:${r.id}`, label: 'Cancel', emoji: '↩️', style: ButtonStyle.Danger }))
        : text(line));
    }
    parts.push(row(button({ id: 'inv:open', label: 'Inventory', emoji: ICON.inventory }), button({ id: 'shop:back:all:0', label: 'Supply Depot', emoji: ICON.shop })));
    return v2([container({ accent: COLORS.info }, ...parts)], { ephemeral: true });
  }

  bot.services.shopUi = { renderCatalog, renderInventory, requisitionsPanel };

  // ── Commands ────────────────────────────────────────────────────────────
  bot.router.command({
    name: 'shop',
    description: 'Open the Supply Depot — spend Core Shards on titles, perks and in-game rewards.',
    async run(ctx) {
      await ctx.reply(renderCatalog(requireGuild(ctx), ctx.userId));
    },
  });

  bot.router.command({
    name: 'inventory',
    description: 'Equip titles and card accents, activate boosters, track requisitions.',
    async run(ctx) {
      await ctx.reply(renderInventory(requireGuild(ctx), ctx.userId));
    },
  });

  const respond = (ctx, payload) => (ctx.message?.flags & 64 ? ctx.update(payload) : ctx.reply(payload));

  bot.router.component('shop', async (ctx, action, a, b, c) => {
    const guildId = requireGuild(ctx);
    switch (action) {
      case 'open':
        return ctx.reply(renderCatalog(guildId, ctx.userId));
      case 'cat':
        return respond(ctx, renderCatalog(guildId, ctx.userId, ctx.values[0] || 'all', 0));
      case 'pg':
        return respond(ctx, renderCatalog(guildId, ctx.userId, a, Number(b) || 0));
      case 'back':
        return respond(ctx, renderCatalog(guildId, ctx.userId, a || 'all', Number(b) || 0));
      case 'item': {
        const item = catalog.get(guildId, a);
        if (!item || !item.enabled) return respond(ctx, renderCatalog(guildId, ctx.userId, b || 'all', Number(c) || 0));
        return respond(ctx, renderItem(guildId, ctx.userId, item, { category: b, page: Number(c) || 0, memberRoles: ctx.memberRoles }));
      }
      case 'buy': {
        const item = catalog.get(guildId, a);
        const why = catalog.blocker(guildId, ctx.userId, item, 1, { memberRoles: ctx.memberRoles });
        if (why) throw new UserError(why, { title: 'Purchase unavailable', tone: 'warning' });
        if (item.kind === 'fulfillment') {
          const rec = bot.members.ensure(guildId, ctx.userId);
          return ctx.showModal(reqs.detailsModal(`shop:req:${item.id}`, `Request: ${item.name}`, rec));
        }
        if (item.kind === 'consumable') {
          return ctx.showModal(modal({
            id: `shop:qty:${item.id}:${b}:${c}`,
            title: `Buy ${item.name}`.slice(0, 45),
            components: [label('Quantity', textInput({ id: 'qty', max: 3, value: '1', placeholder: '1' }), `${bot.settings.currency(guildId).fmt(item.price).replace(/\*/g, '')} each`)],
          }));
        }
        return respond(ctx, confirmView(guildId, item, 1, b, c));
      }
      case 'confirm': {
        const qty = Math.max(1, Math.min(99, Number(b) || 1));
        return respond(ctx, await execute(ctx, guildId, a, qty));
      }
      default:
        return undefined;
    }
  });

  bot.router.modal('shop', async (ctx, action, id, category = 'all', page = '0') => {
    const guildId = requireGuild(ctx);
    const item = catalog.get(guildId, id);
    if (!item) throw new UserError('That item is no longer stocked.', { title: 'Unavailable', tone: 'warning' });
    if (action === 'qty') {
      const qty = Number.parseInt(String(ctx.field('qty', '1')).trim(), 10);
      if (!Number.isFinite(qty) || qty < 1 || qty > 99) throw new UserError('Quantity must be between 1 and 99.', { title: 'Invalid quantity', tone: 'warning' });
      const why = catalog.blocker(guildId, ctx.userId, item, qty, { memberRoles: ctx.memberRoles });
      if (why) throw new UserError(why, { title: 'Purchase unavailable', tone: 'warning' });
      return respond(ctx, confirmView(guildId, item, qty, category, page));
    }
    if (action === 'req') {
      const details = reqs.readDetails(ctx);
      return respond(ctx, await execute(ctx, guildId, item.id, 1, details));
    }
    return undefined;
  });

  bot.router.component('inv', async (ctx, action) => {
    const guildId = requireGuild(ctx);
    const inv = inventoryRows(guildId, ctx.userId);
    let note;
    if (action === 'open') return ctx.reply(renderInventory(guildId, ctx.userId));
    if (action === 'reqs') return respond(ctx, requisitionsPanel(guildId, ctx.userId));
    if (action === 'title') {
      const pick = ctx.values[0];
      const owned = inv.find((i) => i.item_key === pick);
      bot.members.update(guildId, ctx.userId, { title: pick === 'none' || !owned ? null : (owned.data.title || owned.data.name) });
      note = pick === 'none' ? '> Title removed.' : `> Title equipped: 「${sanitizeInline(owned?.data.title || owned?.data.name, 40)}」`;
    } else if (action === 'accent') {
      const pick = ctx.values[0];
      const owned = inv.find((i) => i.item_key === pick);
      bot.members.update(guildId, ctx.userId, { accent: pick === 'none' || !owned ? null : owned.data.color });
      note = pick === 'none' ? '> Card accent reset to your faction colour.' : `> Card accent equipped: ${owned.data.name}`;
    } else if (action === 'boost') {
      const pick = ctx.values[0];
      const rec = bot.members.ensure(guildId, ctx.userId);
      if (rec.boost_until && rec.boost_until > Date.now()) throw new UserError(`A booster is already running until ${discordTime(rec.boost_until, 't')}.`, { title: 'Booster active', tone: 'warning' });
      const owned = inv.find((i) => i.item_key === pick);
      if (!owned) throw new UserError('You no longer have that booster.', { title: 'Not found', tone: 'warning' });
      const minutes = owned.data.minutes || 60;
      const until = Date.now() + minutes * 60_000;
      bot.db.tx(() => {
        bot.db.run('UPDATE inventory SET quantity = quantity - 1 WHERE guild_id = ? AND user_id = ? AND item_key = ? AND quantity > 0', guildId, ctx.userId, pick);
        bot.members.update(guildId, ctx.userId, { boost_mult: owned.data.percent || 125, boost_until: until });
      });
      note = `> ${ICON.boost} Booster engaged: +${(owned.data.percent || 125) - 100}% XP until ${discordTime(until, 't')}.`;
    }
    return respond(ctx, renderInventory(guildId, ctx.userId, { note }));
  });

  // Timed role rewards expire through the persistent scheduler.
  bot.scheduler.register('role.expire', async ({ guildId, userId, roleId }) => {
    const row = bot.db.get('SELECT * FROM timed_roles WHERE guild_id = ? AND user_id = ? AND role_id = ?', guildId, userId, roleId);
    if (!row || row.expires_at > Date.now() + 1_000) return;
    await bot.api.removeRole(guildId, userId, roleId, 'Timed Supply Depot role expired').catch(() => null);
    bot.db.run('DELETE FROM timed_roles WHERE guild_id = ? AND user_id = ? AND role_id = ?', guildId, userId, roleId);
  });

}
