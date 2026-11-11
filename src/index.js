// Sanctuary Core — entry point.
import { loadEnvFile, loadConfig } from './config.js';
import { Logger, addRedaction } from './core/logger.js';
import { Bot } from './bot.js';
import { registerFeatures } from './features/index.js';

loadEnvFile();
const { config, errors } = loadConfig();
const log = new Logger({ level: config.log.level, format: config.log.format, scope: 'core' });
addRedaction(config.token);

if (errors.length) {
  for (const e of errors) log.error(e);
  log.error('Copy .env.example to .env and fill in the required values.');
  process.exit(1);
}
config.debugValidate = config.log.level === 'debug';

const bot = new Bot(config, log);
registerFeatures(bot);

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info(`${signal} received — shutting down (session kept resumable for a quick restart)`);
  try {
    await bot.stop({ resumable: true });
  } finally {
    process.exit(0);
  }
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => log.error('unhandled rejection', err));
process.on('uncaughtException', (err) => log.error('uncaught exception', err));

bot.start().catch((err) => {
  log.error('startup failed', err);
  process.exit(1);
});
