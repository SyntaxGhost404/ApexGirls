// Component & message builders (Components V2 + legacy) and a validator for Discord's documented limits.

export const ComponentType = {
  ActionRow: 1,
  Button: 2,
  StringSelect: 3,
  TextInput: 4,
  UserSelect: 5,
  RoleSelect: 6,
  MentionableSelect: 7,
  ChannelSelect: 8,
  Section: 9,
  TextDisplay: 10,
  Thumbnail: 11,
  MediaGallery: 12,
  File: 13,
  Separator: 14,
  Container: 17,
  Label: 18,
  FileUpload: 19,
  RadioGroup: 21,
  CheckboxGroup: 22,
  Checkbox: 23,
};
const T = ComponentType;

export const ButtonStyle = { Primary: 1, Secondary: 2, Success: 3, Danger: 4, Link: 5, Premium: 6 };
export const TextInputStyle = { Short: 1, Paragraph: 2 };
export const MessageFlags = {
  SuppressEmbeds: 1 << 2,
  Ephemeral: 1 << 6,
  SuppressNotifications: 1 << 12,
  IsComponentsV2: 1 << 15,
};
export const ChannelTypes = { GuildText: 0, GuildVoice: 2, GuildCategory: 4, GuildAnnouncement: 5, AnnouncementThread: 10, PublicThread: 11, PrivateThread: 12, GuildStage: 13, GuildForum: 15, GuildMedia: 16 };

export function clip(text, max) {
  const s = String(text ?? '');
  return s.length <= max ? s : `${s.slice(0, Math.max(0, max - 1))}…`;
}

/** Accepts '🔥', '<:name:id>', '<a:name:id>' or an emoji object and returns a partial emoji object. */
export function parseEmoji(emoji) {
  if (!emoji) return undefined;
  if (typeof emoji === 'object') return emoji;
  const m = String(emoji).match(/^<(a)?:(\w{2,32}):(\d{16,20})>$/);
  if (m) return { id: m[3], name: m[2], animated: Boolean(m[1]) };
  return { name: String(emoji) };
}

// ── Content & layout ─────────────────────────────────────────────────────────
export const text = (content) => ({ type: T.TextDisplay, content: String(content) });
export const separator = ({ divider = true, spacing = 1 } = {}) => ({ type: T.Separator, divider, spacing });
export const spacer = (large = false) => separator({ divider: false, spacing: large ? 2 : 1 });
export const thumbnail = (url, description) => ({ type: T.Thumbnail, media: { url }, ...(description ? { description: clip(description, 1024) } : {}) });
export const gallery = (...items) => ({
  type: T.MediaGallery,
  items: items.flat().filter(Boolean).slice(0, 10).map((i) => (typeof i === 'string' ? { media: { url: i } } : { media: { url: i.url }, ...(i.description ? { description: clip(i.description, 1024) } : {}), ...(i.spoiler ? { spoiler: true } : {}) })),
});

/** Section: 1–3 text blocks plus a button or thumbnail accessory. */
export function section(texts, accessory) {
  const list = (Array.isArray(texts) ? texts : [texts]).filter((t) => t !== null && t !== undefined && t !== '').slice(0, 3);
  return { type: T.Section, components: list.map((t) => (typeof t === 'string' ? text(t) : t)), accessory };
}

export function container(options, ...children) {
  const opts = options && !options.type && !Array.isArray(options) ? options : {};
  const kids = (options && (options.type || Array.isArray(options)) ? [options, ...children] : children).flat(Infinity).filter(Boolean);
  const out = { type: T.Container, components: kids.map((k) => (typeof k === 'string' ? text(k) : k)) };
  if (opts.accent !== undefined && opts.accent !== null) out.accent_color = opts.accent;
  if (opts.spoiler) out.spoiler = true;
  return out;
}

export function row(...components) {
  const list = components.flat().filter(Boolean);
  return list.length ? { type: T.ActionRow, components: list } : null;
}

// ── Interactive ──────────────────────────────────────────────────────────────
export function button({ id, label, style = ButtonStyle.Secondary, emoji, disabled = false, url }) {
  const b = { type: T.Button, style: url ? ButtonStyle.Link : style };
  if (label) b.label = clip(label, 80);
  if (emoji) b.emoji = parseEmoji(emoji);
  if (url) b.url = url;
  else b.custom_id = id;
  if (disabled) b.disabled = true;
  return b;
}
export const linkButton = (label, url, emoji) => button({ label, url, emoji });

export function stringSelect({ id, placeholder, options, min, max, disabled = false, required }) {
  const s = {
    type: T.StringSelect,
    custom_id: id,
    options: options.slice(0, 25).map((o) => ({
      label: clip(o.label, 100),
      value: String(o.value).slice(0, 100),
      ...(o.description ? { description: clip(o.description, 100) } : {}),
      ...(o.emoji ? { emoji: parseEmoji(o.emoji) } : {}),
      ...(o.default ? { default: true } : {}),
    })),
  };
  if (placeholder) s.placeholder = clip(placeholder, 150);
  if (min !== undefined) s.min_values = min;
  if (max !== undefined) s.max_values = Math.min(max, s.options.length);
  if (disabled) s.disabled = true;
  if (required !== undefined) s.required = required;
  return s;
}

function autoSelect(type, defaultType) {
  return ({ id, placeholder, min, max, defaults = [], disabled = false, required, channelTypes }) => {
    const s = { type, custom_id: id };
    if (placeholder) s.placeholder = clip(placeholder, 150);
    if (min !== undefined) s.min_values = min;
    if (max !== undefined) s.max_values = max;
    const defs = defaults.filter(Boolean).map((d) => (typeof d === 'string' ? { id: d, type: defaultType } : d));
    if (defs.length) s.default_values = defs.slice(0, max ?? 1);
    if (channelTypes) s.channel_types = channelTypes;
    if (disabled) s.disabled = true;
    if (required !== undefined) s.required = required;
    return s;
  };
}
export const userSelect = autoSelect(T.UserSelect, 'user');
export const roleSelect = autoSelect(T.RoleSelect, 'role');
export const channelSelect = autoSelect(T.ChannelSelect, 'channel');
export const mentionableSelect = autoSelect(T.MentionableSelect, 'user');

// ── Modal components ─────────────────────────────────────────────────────────
export function label(labelText, component, description) {
  return { type: T.Label, label: clip(labelText, 45), ...(description ? { description: clip(description, 100) } : {}), component };
}
export function textInput({ id, style = TextInputStyle.Short, min, max, required = true, value, placeholder }) {
  const t = { type: T.TextInput, custom_id: id, style, required };
  if (min !== undefined) t.min_length = min;
  if (max !== undefined) t.max_length = max;
  if (value !== undefined && value !== null && value !== '') t.value = String(value).slice(0, max ?? 4000);
  if (placeholder) t.placeholder = clip(placeholder, 100);
  return t;
}
export function radioGroup({ id, options, required = true }) {
  return {
    type: T.RadioGroup,
    custom_id: id,
    required,
    options: options.slice(0, 10).map((o) => ({ value: String(o.value), label: clip(o.label, 100), ...(o.description ? { description: clip(o.description, 100) } : {}), ...(o.default ? { default: true } : {}) })),
  };
}
export function checkboxGroup({ id, options, min, max, required = true }) {
  const c = {
    type: T.CheckboxGroup,
    custom_id: id,
    required,
    options: options.slice(0, 10).map((o) => ({ value: String(o.value), label: clip(o.label, 100), ...(o.description ? { description: clip(o.description, 100) } : {}), ...(o.default ? { default: true } : {}) })),
  };
  if (min !== undefined) c.min_values = min;
  if (max !== undefined) c.max_values = max;
  return c;
}
export const checkbox = ({ id, checked = false }) => ({ type: T.Checkbox, custom_id: id, ...(checked ? { default: true } : {}) });
export function fileUpload({ id, min, max, required = true, fileTypes }) {
  const f = { type: T.FileUpload, custom_id: id, required };
  if (min !== undefined) f.min_values = min;
  if (max !== undefined) f.max_values = max;
  if (fileTypes) f.file_types = fileTypes;
  return f;
}
export function modal({ id, title, components }) {
  return { custom_id: id, title: clip(title, 45), components: components.filter(Boolean) };
}

// ── Message helpers ──────────────────────────────────────────────────────────
/** Build a Components V2 message payload. */
export function v2(components, { ephemeral = false, mentions = [], silent = false } = {}) {
  let flags = MessageFlags.IsComponentsV2;
  if (ephemeral) flags |= MessageFlags.Ephemeral;
  if (silent) flags |= MessageFlags.SuppressNotifications;
  return { flags, components: components.flat().filter(Boolean), allowed_mentions: { parse: [], users: mentions } };
}

/** Build a classic (embeds + action rows) message payload. */
export function classic({ content, embeds = [], components = [], ephemeral = false, mentions = [] } = {}) {
  const payload = { embeds, components: components.filter(Boolean), allowed_mentions: { parse: [], users: mentions } };
  if (content) payload.content = content;
  if (ephemeral) payload.flags = MessageFlags.Ephemeral;
  return payload;
}

export function isV2(payload) {
  return Boolean(payload && typeof payload.flags === 'number' && payload.flags & MessageFlags.IsComponentsV2);
}

// ── Validation ───────────────────────────────────────────────────────────────
const TOP_LEVEL_V2 = new Set([T.ActionRow, T.Section, T.TextDisplay, T.MediaGallery, T.File, T.Separator, T.Container]);
const CONTAINER_CHILDREN = new Set([T.ActionRow, T.TextDisplay, T.Section, T.MediaGallery, T.Separator, T.File]);
const SELECTS = new Set([T.StringSelect, T.UserSelect, T.RoleSelect, T.MentionableSelect, T.ChannelSelect]);
const LABEL_CHILDREN = new Set([T.TextInput, T.StringSelect, T.UserSelect, T.RoleSelect, T.MentionableSelect, T.ChannelSelect, T.FileUpload, T.RadioGroup, T.CheckboxGroup, T.Checkbox]);

function checkCustomId(c, path, ids, errors) {
  if (typeof c.custom_id !== 'string' || c.custom_id.length < 1 || c.custom_id.length > 100) errors.push(`${path}: custom_id must be 1-100 chars (got ${c.custom_id?.length ?? 'none'})`);
  else if (ids.has(c.custom_id)) errors.push(`${path}: duplicate custom_id "${c.custom_id}"`);
  else ids.add(c.custom_id);
}

function checkSelect(c, path, ids, errors, inModal) {
  checkCustomId(c, path, ids, errors);
  if (c.placeholder && c.placeholder.length > 150) errors.push(`${path}: placeholder > 150`);
  const max = c.max_values ?? 1;
  const min = c.min_values ?? 1;
  if (min < 0 || min > 25 || max < 1 || max > 25 || min > max) errors.push(`${path}: invalid min/max values (${min}/${max})`);
  if (inModal && c.disabled) errors.push(`${path}: selects in modals cannot be disabled`);
  if (c.type === T.StringSelect) {
    if (!Array.isArray(c.options) || c.options.length < 1 || c.options.length > 25) errors.push(`${path}: string select needs 1-25 options`);
    else {
      if (max > c.options.length) errors.push(`${path}: max_values exceeds option count`);
      const values = new Set();
      c.options.forEach((o, i) => {
        if (!o.label || o.label.length > 100) errors.push(`${path}.options[${i}]: label must be 1-100 chars`);
        if (o.value === undefined || String(o.value).length > 100 || String(o.value).length < 1) errors.push(`${path}.options[${i}]: value must be 1-100 chars`);
        if (o.description && o.description.length > 100) errors.push(`${path}.options[${i}]: description > 100`);
        checkEmoji(o.emoji, `${path}.options[${i}].emoji`, errors);
        if (values.has(o.value)) errors.push(`${path}.options[${i}]: duplicate value "${o.value}"`);
        values.add(o.value);
      });
    }
  }
  if (c.default_values && (c.default_values.length < min || c.default_values.length > max)) errors.push(`${path}: default_values count outside min/max`);
}

/** Unicode emoji used on components must be real emoji (Discord rejects dingbats like ✦ or ✚). */
const EMOJI_RE = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[#*0-9]\uFE0F?\u20E3)/u;
function checkEmoji(emoji, path, errors) {
  if (!emoji || emoji.id) return;
  if (!emoji.name || !EMOJI_RE.test(emoji.name)) errors.push(`${path}: "${emoji?.name}" is not a Discord-supported emoji`);
}

function checkButton(c, path, ids, errors) {
  checkEmoji(c.emoji, `${path}.emoji`, errors);
  if (c.label && c.label.length > 80) errors.push(`${path}: button label > 80`);
  if (!c.label && !c.emoji && c.style !== ButtonStyle.Premium) errors.push(`${path}: button needs a label or emoji`);
  if (c.style === ButtonStyle.Link) {
    if (!c.url || c.url.length > 512) errors.push(`${path}: link button needs url ≤ 512`);
    if (c.custom_id) errors.push(`${path}: link button cannot have custom_id`);
  } else if (c.style !== ButtonStyle.Premium) {
    checkCustomId(c, path, ids, errors);
    if (c.url) errors.push(`${path}: non-link button cannot have url`);
  }
}

function checkActionRow(c, path, ids, errors, counter) {
  const kids = c.components || [];
  if (!kids.length) errors.push(`${path}: action row is empty`);
  const selects = kids.filter((k) => SELECTS.has(k.type));
  const buttons = kids.filter((k) => k.type === T.Button);
  if (selects.length && (selects.length > 1 || buttons.length)) errors.push(`${path}: an action row holds one select OR up to 5 buttons`);
  if (buttons.length > 5) errors.push(`${path}: more than 5 buttons in a row`);
  kids.forEach((k, i) => {
    counter.count += 1;
    const p = `${path}.components[${i}]`;
    if (k.type === T.Button) checkButton(k, p, ids, errors);
    else if (SELECTS.has(k.type)) checkSelect(k, p, ids, errors, false);
    else errors.push(`${p}: type ${k.type} not allowed in a message action row`);
  });
}

function walkV2(c, path, ids, errors, counter, depth) {
  counter.count += 1;
  switch (c.type) {
    case T.TextDisplay:
      if (typeof c.content !== 'string' || !c.content.length) errors.push(`${path}: empty text display`);
      counter.text += c.content?.length || 0;
      break;
    case T.Separator:
      if (c.spacing !== undefined && ![1, 2].includes(c.spacing)) errors.push(`${path}: separator spacing must be 1 or 2`);
      break;
    case T.MediaGallery:
      if (!Array.isArray(c.items) || c.items.length < 1 || c.items.length > 10) errors.push(`${path}: media gallery needs 1-10 items`);
      (c.items || []).forEach((it, i) => {
        if (!it.media?.url) errors.push(`${path}.items[${i}]: missing media url`);
        if (it.description && it.description.length > 1024) errors.push(`${path}.items[${i}]: description > 1024`);
      });
      break;
    case T.File:
      if (!String(c.file?.url || '').startsWith('attachment://')) errors.push(`${path}: file component requires attachment:// url`);
      break;
    case T.Section: {
      const kids = c.components || [];
      if (kids.length < 1 || kids.length > 3) errors.push(`${path}: section needs 1-3 text displays`);
      kids.forEach((k, i) => {
        if (k.type !== T.TextDisplay) errors.push(`${path}.components[${i}]: sections only hold text displays`);
        walkV2(k, `${path}.components[${i}]`, ids, errors, counter, depth + 1);
      });
      const acc = c.accessory;
      if (!acc) errors.push(`${path}: section requires an accessory`);
      else if (acc.type === T.Button) {
        counter.count += 1;
        checkButton(acc, `${path}.accessory`, ids, errors);
      } else if (acc.type === T.Thumbnail) {
        counter.count += 1;
        if (!acc.media?.url) errors.push(`${path}.accessory: thumbnail needs media url`);
        if (acc.description && acc.description.length > 1024) errors.push(`${path}.accessory: description > 1024`);
      } else errors.push(`${path}.accessory: must be a button or thumbnail`);
      break;
    }
    case T.ActionRow:
      checkActionRow(c, path, ids, errors, counter);
      break;
    case T.Container:
      if (depth > 0) errors.push(`${path}: containers cannot be nested`);
      if (c.accent_color !== undefined && c.accent_color !== null && (c.accent_color < 0 || c.accent_color > 0xffffff)) errors.push(`${path}: accent_color out of range`);
      (c.components || []).forEach((k, i) => {
        if (!CONTAINER_CHILDREN.has(k.type)) errors.push(`${path}.components[${i}]: type ${k.type} not allowed in container`);
        walkV2(k, `${path}.components[${i}]`, ids, errors, counter, depth + 1);
      });
      if (!(c.components || []).length) errors.push(`${path}: container is empty`);
      break;
    default:
      errors.push(`${path}: unsupported component type ${c.type}`);
  }
}

function checkEmbeds(embeds, errors) {
  if (embeds.length > 10) errors.push('more than 10 embeds');
  let total = 0;
  embeds.forEach((e, i) => {
    const p = `embeds[${i}]`;
    const len = (s) => (s ? String(s).length : 0);
    if (len(e.title) > 256) errors.push(`${p}.title > 256`);
    if (len(e.description) > 4096) errors.push(`${p}.description > 4096`);
    if ((e.fields || []).length > 25) errors.push(`${p}: more than 25 fields`);
    (e.fields || []).forEach((f, j) => {
      if (!f.name || len(f.name) > 256) errors.push(`${p}.fields[${j}].name must be 1-256`);
      if (!f.value || len(f.value) > 1024) errors.push(`${p}.fields[${j}].value must be 1-1024`);
      total += len(f.name) + len(f.value);
    });
    if (len(e.footer?.text) > 2048) errors.push(`${p}.footer > 2048`);
    if (len(e.author?.name) > 256) errors.push(`${p}.author.name > 256`);
    total += len(e.title) + len(e.description) + len(e.footer?.text) + len(e.author?.name);
  });
  if (total > 6000) errors.push(`embeds exceed 6000 total characters (${total})`);
}

/** Validate a message payload. Returns an array of human-readable problems (empty when valid). */
export function validateMessage(payload) {
  const errors = [];
  const ids = new Set();
  const counter = { count: 0, text: 0 };
  const comps = payload.components || [];
  if (isV2(payload)) {
    if (payload.content) errors.push('content is not allowed with IS_COMPONENTS_V2');
    if (payload.embeds?.length) errors.push('embeds are not allowed with IS_COMPONENTS_V2');
    if (!comps.length) errors.push('a components v2 message needs at least one component');
    comps.forEach((c, i) => {
      if (!TOP_LEVEL_V2.has(c.type)) errors.push(`components[${i}]: type ${c.type} not allowed at top level`);
      walkV2(c, `components[${i}]`, ids, errors, counter, 0);
    });
    if (counter.count > 40) errors.push(`too many components (${counter.count} > 40)`);
    if (counter.text > 4000) errors.push(`text displays exceed 4000 characters (${counter.text})`);
  } else {
    if (payload.content && payload.content.length > 2000) errors.push('content > 2000');
    checkEmbeds(payload.embeds || [], errors);
    if (comps.length > 5) errors.push('legacy messages allow at most 5 action rows');
    comps.forEach((c, i) => {
      if (c.type !== T.ActionRow) errors.push(`components[${i}]: legacy messages only allow action rows at top level`);
      else checkActionRow(c, `components[${i}]`, ids, errors, counter);
    });
  }
  return errors;
}

/** Validate a modal payload (the `data` of a MODAL callback). */
export function validateModal(m) {
  const errors = [];
  const ids = new Set();
  if (!m.custom_id || m.custom_id.length > 100) errors.push('modal custom_id must be 1-100 chars');
  if (!m.title || m.title.length > 45) errors.push('modal title must be 1-45 chars');
  const comps = m.components || [];
  if (comps.length < 1 || comps.length > 5) errors.push(`modal needs 1-5 top-level components (got ${comps.length})`);
  comps.forEach((c, i) => {
    const p = `components[${i}]`;
    if (c.type === T.TextDisplay) {
      if (!c.content) errors.push(`${p}: empty text display`);
      return;
    }
    if (c.type !== T.Label) {
      errors.push(`${p}: top-level modal components must be labels or text displays`);
      return;
    }
    if (!c.label || c.label.length > 45) errors.push(`${p}: label must be 1-45 chars`);
    if (c.description && c.description.length > 100) errors.push(`${p}: description > 100`);
    const k = c.component;
    const kp = `${p}.component`;
    if (!k || !LABEL_CHILDREN.has(k.type)) {
      errors.push(`${kp}: invalid label child`);
      return;
    }
    if (k.type === T.TextInput) {
      checkCustomId(k, kp, ids, errors);
      if (k.label) errors.push(`${kp}: text inputs inside labels must not set label`);
      if (![1, 2].includes(k.style)) errors.push(`${kp}: invalid text input style`);
      if (k.min_length !== undefined && (k.min_length < 0 || k.min_length > 4000)) errors.push(`${kp}: min_length out of range`);
      if (k.max_length !== undefined && (k.max_length < 1 || k.max_length > 4000)) errors.push(`${kp}: max_length out of range`);
      if (k.value && k.value.length > (k.max_length ?? 4000)) errors.push(`${kp}: value longer than max_length`);
      if (k.placeholder && k.placeholder.length > 100) errors.push(`${kp}: placeholder > 100`);
    } else if (SELECTS.has(k.type)) {
      checkSelect(k, kp, ids, errors, true);
    } else if (k.type === T.RadioGroup) {
      checkCustomId(k, kp, ids, errors);
      if (!Array.isArray(k.options) || k.options.length < 2 || k.options.length > 10) errors.push(`${kp}: radio group needs 2-10 options`);
      if ((k.options || []).filter((o) => o.default).length > 1) errors.push(`${kp}: only one radio option can be default`);
    } else if (k.type === T.CheckboxGroup) {
      checkCustomId(k, kp, ids, errors);
      if (!Array.isArray(k.options) || k.options.length < 1 || k.options.length > 10) errors.push(`${kp}: checkbox group needs 1-10 options`);
      const min = k.min_values ?? 1;
      const max = k.max_values ?? (k.options || []).length;
      if (min < 0 || min > 10 || max < 1 || max > 10 || min > max) errors.push(`${kp}: invalid min/max`);
      if (k.required !== false && k.min_values === 0) errors.push(`${kp}: min_values must be ≥1 when required`);
    } else if (k.type === T.Checkbox) {
      checkCustomId(k, kp, ids, errors);
    } else if (k.type === T.FileUpload) {
      checkCustomId(k, kp, ids, errors);
      const min = k.min_values ?? 1;
      const max = k.max_values ?? 1;
      if (min < 0 || min > 10 || max < 1 || max > 10 || min > max) errors.push(`${kp}: invalid min/max`);
    }
  });
  return errors;
}
