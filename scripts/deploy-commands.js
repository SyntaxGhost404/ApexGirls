// Register (bulk overwrite) the application commands.
//   npm run deploy-commands                 → uses COMMAND_SCOPE / DEV_GUILD_ID from .env
//   npm run deploy-commands -- --global     → force global registration
//   npm run deploy-commands -- --guild <id> → register to one guild (instant, for development)
//   npm run deploy-commands -- --clear-guild <id> → remove guild-scoped commands from a guild
import { loadEnvFile, loadConfig } from '../src/config.js';
import { Logger, addRedaction } from '../src/core/logger.js';
import { Bot } from '../src/bot.js';
import { registerFeatures } from '../src/features/index.js';

loadEnvFile();
const { config, errors } = loadConfig();
const log = new Logger({ level: 'info', scope: 'deploy' });
addRedaction(config.token);
if (errors.length) {
  errors.forEach((e) => log.error(e));
  process.exit(1);
}

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1] || true;
};

const bot = new Bot(config, log);
registerFeatures(bot);
try {
  const clear = flag('--clear-guild');
  if (clear) {
    await bot.rest.put(`/applications/${config.applicationId}/guilds/${clear}/commands`, []);
    log.info(`cleared guild commands in ${clear}`);
  } else {
    if (flag('--global')) config.commandScope = 'global';
    const guild = flag('--guild');
    if (guild) {
      config.commandScope = 'guild';
      config.devGuildId = guild;
    }
    const res = await bot.syncCommands({ force: true });
    log.info(`registered ${res.count} ${config.commandScope} command(s)`);
  }
} catch (err) {
  log.error('command registration failed', err);
  process.exitCode = 1;
} finally {
  bot.db.close();
}
