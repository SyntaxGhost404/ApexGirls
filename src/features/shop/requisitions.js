// Requisitions: in-game rewards (shop purchases, giveaway prizes, season prizes) that staff fulfil
// by hand. Each one becomes a ticket (classic embed + buttons) in the requisition queue channel.
import { button, label, modal, radioGroup, row, textInput, ButtonStyle, TextInputStyle } from '../../core/components.js';
import { canPost } from '../../core/permissions.js';
import { UserError } from '../../core/interactions.js';
import { COLORS, REGIONS } from '../../content/theme.js';
import { sanitizeInline } from '../../util/format.js';
import { requireStaff, requireGuild } from '../common.js';

const STATUS = {
  pending: { label: 'Pending', color: COLORS.warning, emoji: '🕒' },
  fulfilled: { label: 'Fulfilled', color: COLORS.success, emoji: '✅' },
  rejected: { label: 'Rejected · refunded', color: COLORS.danger, emoji: '❌' },
  cancelled: { label: 'Cancelled by Commander · refunded', color: COLORS.steel, emoji: '↩️' },
};

export class Requisitions {
  constructor(bot) {
    this.bot = bot;
  }

  get(guildId, id) {
    return this.bot.db.get('SELECT * FROM requisitions WHERE guild_id = ? AND id = ?', guildId, Number(id));
  }

  forUser(guildId, userId, limit = 10) {
    return this.bot.db.all('SELECT * FROM requisitions WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT ?', guildId, userId, limit);
  }

  pending(guildId, limit = 25) {
    return this.bot.db.all("SELECT * FROM requisitions WHERE guild_id = ? AND status = 'pending' ORDER BY id LIMIT ?", guildId, limit);
  }

  ticket(r) {
    const s = STATUS[r.status] || STATUS.pending;
    const region = REGIONS[r.region];
    const embed = {
      title: `📮 Requisition #${r.id} · ${r.title}`.slice(0, 256),
      color: s.color,
      description: `**Commander:** <@${r.user_id}> \`${r.user_id}\`\n**Source:** ${r.source === 'shop' ? 'Supply Depot purchase' : r.source === 'giveaway' ? 'Giveaway prize' : r.source === 'season' ? 'Season prize' : r.source}`,
      fields: [
        { name: 'Quantity', value: String(r.quantity), inline: true },
        { name: 'Cost', value: r.cost ? `${r.cost.toLocaleString('en-US')} shards` : '—', inline: true },
        { name: 'Status', value: `${s.emoji} ${s.label}`, inline: true },
        { name: 'Game version', value: region ? `${region.emoji} ${region.label}` : 'Not given', inline: true },
        { name: 'Server', value: r.server ? sanitizeInline(r.server, 32) : '—', inline: true },
        { name: 'UID', value: r.uid ? `\`${sanitizeInline(r.uid, 32)}\`` : '—', inline: true },
      ],
      footer: { text: 'Sanctuary Core · requisition queue' },
      timestamp: new Date(r.created_at).toISOString(),
    };
    if (r.note) embed.fields.push({ name: 'Commander note', value: sanitizeInline(r.note, 500), inline: false });
    if (r.staff_id) embed.fields.push({ name: 'Handled by', value: `<@${r.staff_id}>${r.staff_note ? ` — ${sanitizeInline(r.staff_note, 400)}` : ''}`, inline: false });
    const components = r.status === 'pending'
      ? [row(
        button({ id: `req:ok:${r.id}`, label: 'Mark fulfilled', emoji: '✅', style: ButtonStyle.Success }),
        button({ id: `req:no:${r.id}`, label: 'Reject & refund', emoji: '❌', style: ButtonStyle.Danger }),
      )]
      : [];
    return { embeds: [embed], components, allowed_mentions: { parse: [] } };
  }

  queueChannel(guildId) {
    const s = this.bot.settings.get(guildId);
    return s.shop.requisitionChannelId || s.general.logChannelId || null;
  }

  /** File a requisition and post its ticket. Returns the row. */
  async file(guildId, userId, { source, itemId = null, purchaseId = null, title, quantity = 1, cost = 0, region, server, uid, note }) {
    const now = Date.now();
    const res = this.bot.db.run(
      `INSERT INTO requisitions (guild_id, user_id, source, item_id, purchase_id, title, quantity, cost, region, server, uid, note, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      guildId, userId, source, itemId, purchaseId, title, quantity, cost, region || null, server || null, uid || null, note || null, now, now,
    );
    const r = this.get(guildId, Number(res.lastInsertRowid));
    const channelId = this.queueChannel(guildId);
    if (channelId && canPost(this.bot.cache, guildId, channelId, { embeds: true }).ok) {
      try {
        const msg = await this.bot.api.send(channelId, this.ticket(r));
        this.bot.db.run('UPDATE requisitions SET channel_id = ?, message_id = ? WHERE id = ?', channelId, msg.id, r.id);
      } catch (err) {
        this.bot.log.warn(`could not post requisition #${r.id}: ${err.message}`);
      }
    } else {
      await this.bot.services.audit.warn(guildId, 'req-channel', 'A requisition was filed but no requisition queue channel is configured (or the bot cannot post there). Set one in `/setup` → Channels.');
    }
    return this.get(guildId, r.id);
  }

  async #refreshTicket(r) {
    if (!r.channel_id || !r.message_id) return;
    await this.bot.api.edit(r.channel_id, r.message_id, this.ticket(r)).catch((err) => this.bot.log.debug(`ticket edit failed: ${err.message}`));
  }

  async #notify(r, text) {
    const s = STATUS[r.status];
    const guild = this.bot.cache.guild(r.guild_id);
    await this.bot.api.dm(r.user_id, {
      embeds: [{
        title: `${s.emoji} Requisition #${r.id} · ${s.label}`,
        description: `${text}\n\n**Item:** ${r.title}${r.quantity > 1 ? ` ×${r.quantity}` : ''}`,
        color: s.color,
        footer: { text: guild ? `${guild.name} · Sanctuary Core` : 'Sanctuary Core' },
        timestamp: new Date().toISOString(),
      }],
    });
  }

  /** Change status (fulfil / reject / cancel). Rejections and cancellations refund the cost. */
  async resolve(guildId, id, status, { staffId = null, note = null } = {}) {
    const r = this.get(guildId, id);
    if (!r) throw new UserError('That requisition no longer exists.', { title: 'Not found', tone: 'warning' });
    if (r.status !== 'pending') throw new UserError(`Requisition #${r.id} is already **${STATUS[r.status]?.label || r.status}**.`, { title: 'Already handled', tone: 'warning' });
    this.bot.db.tx(() => {
      this.bot.db.run('UPDATE requisitions SET status = ?, staff_id = ?, staff_note = ?, updated_at = ? WHERE id = ?', status, staffId, note, Date.now(), r.id);
      if ((status === 'rejected' || status === 'cancelled') && r.cost > 0) {
        if (r.purchase_id) this.bot.services.catalog.refund(guildId, r.purchase_id, `Requisition #${r.id} ${status}`);
        else this.bot.economy.credit(guildId, r.user_id, r.cost, 'refund', { reason: `Requisition #${r.id} ${status}` });
      } else if ((status === 'rejected' || status === 'cancelled') && r.purchase_id) {
        this.bot.db.run("UPDATE purchases SET status = 'refunded' WHERE id = ?", r.purchase_id);
      }
    });
    const updated = this.get(guildId, r.id);
    await this.#refreshTicket(updated);
    if (status === 'fulfilled') await this.#notify(updated, 'Your reward has been sent. Check your in-game mailbox, Commander!');
    else if (status === 'rejected') await this.#notify(updated, `Staff could not fulfil this request${note ? `: *${sanitizeInline(note, 300)}*` : '.'}${r.cost ? ' Your Core Shards were refunded.' : ''}`);
    await this.bot.services.audit.log(guildId, {
      title: `📮 Requisition #${r.id} ${STATUS[status].label.toLowerCase()}`,
      userId: r.user_id,
      actorId: staffId || r.user_id,
      color: STATUS[status].color,
      fields: [{ name: 'Item', value: r.title }, { name: 'Cost', value: String(r.cost) }],
    });
    return updated;
  }

  /** Modal collecting the delivery details, prefilled from the Commander's ID card. */
  detailsModal(id, title, rec) {
    return modal({
      id,
      title: title.slice(0, 45),
      components: [
        label('Game version', radioGroup({
          id: 'region',
          options: [
            { value: 'global', label: 'Global — Apex Girls: 3650-Pull Giveaway', default: rec.game_region !== 'sea' },
            { value: 'sea', label: 'Southeast Asia — Scarlet Girls: Elite Edition', default: rec.game_region === 'sea' },
          ],
        })),
        label('Server', textInput({ id: 'server', max: 16, value: rec.game_server || '', placeholder: 'e.g. S12' })),
        label('UID', textInput({ id: 'uid', max: 20, value: rec.game_uid || '', placeholder: 'Your in-game UID' }), 'Double-check it — rewards go to this account.'),
        label('Note for staff', textInput({ id: 'note', style: TextInputStyle.Paragraph, max: 300, required: false, placeholder: 'Optional' })),
      ],
    });
  }

  /** Validate delivery details from a details modal. */
  readDetails(ctx) {
    const region = String(ctx.field('region', '') || '').trim().toLowerCase();
    const server = String(ctx.field('server', '') || '').trim().slice(0, 16);
    const uid = String(ctx.field('uid', '') || '').replace(/\s+/g, '');
    const note = String(ctx.field('note', '') || '').trim().slice(0, 300);
    if (!['global', 'sea'].includes(region)) throw new UserError('Choose the game version your account is on.', { title: 'Check your details', tone: 'warning' });
    if (!/^[A-Za-z0-9-]{4,20}$/.test(uid)) throw new UserError('Enter the UID exactly as shown on your in-game profile.', { title: 'Check your UID', tone: 'warning' });
    if (!server) throw new UserError('Enter the in-game server you play on (for example S12).', { title: 'Check your server', tone: 'warning' });
    return { region, server, uid, note };
  }
}

export function setupRequisitions(bot) {
  const reqs = new Requisitions(bot);
  bot.services.requisitions = reqs;

  bot.router.component('req', async (ctx, action, id) => {
    const guildId = requireGuild(ctx);
    if (action === 'cancel') {
      const r = reqs.get(guildId, id);
      if (!r || r.user_id !== ctx.userId) throw new UserError('You can only cancel your own requisitions.', { title: 'Not yours', tone: 'warning' });
      await reqs.resolve(guildId, id, 'cancelled', { note: 'Cancelled by the Commander' });
      await ctx.reply({ ...bot.services.shopUi.requisitionsPanel(guildId, ctx.userId), ephemeral: true });
      return;
    }
    requireStaff(bot, ctx);
    if (action === 'ok') {
      const r = await reqs.resolve(guildId, id, 'fulfilled', { staffId: ctx.userId });
      await ctx.update(reqs.ticket(r));
    } else if (action === 'no') {
      await ctx.showModal(modal({
        id: `req:reject:${id}`,
        title: `Reject requisition #${id}`,
        components: [label('Reason (sent to the Commander)', textInput({ id: 'reason', style: TextInputStyle.Paragraph, max: 300, placeholder: 'e.g. UID not found on that server' }))],
      }));
    }
  });

  bot.router.modal('req', async (ctx, action, id) => {
    const guildId = requireGuild(ctx);
    requireStaff(bot, ctx);
    if (action !== 'reject') return;
    const r = await reqs.resolve(guildId, id, 'rejected', { staffId: ctx.userId, note: String(ctx.field('reason', '') || '').trim() || null });
    if (ctx.message) await ctx.update(reqs.ticket(r));
    else await ctx.reply({ content: `Requisition #${r.id} rejected and refunded.`, ephemeral: true });
  });

  return reqs;
}

export { STATUS as REQUISITION_STATUS };
