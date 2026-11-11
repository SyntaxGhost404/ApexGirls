// Environment configuration. Values come from process.env (optionally loaded from .env).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8')).version;

/** Load `.env` (or ENV_FILE) into process.env without overriding existing variables. */
export function loadEnvFile() {
  const file = process.env.ENV_FILE ? path.resolve(process.env.ENV_FILE) : path.join(ROOT_DIR, '.env');
  if (fs.existsSync(file)) process.loadEnvFile(file);
}

function bool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function int(value, fallback) {
  if (value === undefined || value === '') return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

/** Bot tokens start with the base64 encoded bot user id, which equals the application id. */
export function applicationIdFromToken(token) {
  try {
    const id = Buffer.from(token.split('.')[0], 'base64').toString('utf8');
    return /^\d{16,20}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

export function loadConfig(env = process.env) {
  const token = (env.DISCORD_TOKEN || '').trim();
  const errors = [];
  if (!token) errors.push('DISCORD_TOKEN is required.');

  const applicationId = (env.DISCORD_APPLICATION_ID || '').trim() || (token ? applicationIdFromToken(token) : null);
  const scope = (env.COMMAND_SCOPE || 'global').trim().toLowerCase();
  if (!['global', 'guild'].includes(scope)) errors.push('COMMAND_SCOPE must be "global" or "guild".');
  const devGuildId = (env.DEV_GUILD_ID || '').trim() || null;
  if (scope === 'guild' && !devGuildId) errors.push('DEV_GUILD_ID is required when COMMAND_SCOPE=guild.');

  const httpPort = int(env.HTTP_PORT, null);
  const publicKey = (env.DISCORD_PUBLIC_KEY || '').trim() || null;
  if (publicKey && !/^[0-9a-f]{64}$/i.test(publicKey)) errors.push('DISCORD_PUBLIC_KEY must be a 64 character hex string.');

  const config = {
    token,
    applicationId,
    publicKey,
    databasePath: path.resolve(ROOT_DIR, env.DATABASE_PATH || './data/sanctuary.db'),
    commandScope: scope,
    devGuildId,
    syncCommands: bool(env.SYNC_COMMANDS, true),
    intents: {
      messageContent: bool(env.ENABLE_MESSAGE_CONTENT, true),
      guildMembers: bool(env.ENABLE_GUILD_MEMBERS, true),
    },
    gatewayCompression: bool(env.GATEWAY_COMPRESSION, true),
    http: { port: httpPort, host: env.HTTP_HOST || '0.0.0.0' },
    log: { level: (env.LOG_LEVEL || 'info').toLowerCase(), format: (env.LOG_FORMAT || 'pretty').toLowerCase() },
    userAgent: `DiscordBot (https://github.com/SyntaxGhost404/ApexGirls, ${VERSION})`,
    version: VERSION,
  };
  return { config, errors };
}
