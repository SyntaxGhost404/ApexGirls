// Feature registry. Order matters only where one feature uses another's service at setup time.
import { Audit } from '../services/audit.js';
import leveling from './leveling/index.js';
import profile from './profile.js';
import leaderboard from './leaderboard.js';
import daily from './daily.js';
import quests from './quests.js';
import shop from './shop/index.js';
import factions from './factions.js';
import events from './events.js';
import giveaways from './giveaways.js';
import expeditions from './expeditions.js';
import duels from './duels.js';
import info from './info.js';
import seasons from './seasons.js';
import staff from './staff.js';
import setupPanel from './setup.js';

export function registerFeatures(bot) {
  bot.services.audit = new Audit(bot);
  for (const feature of [leveling, profile, leaderboard, daily, quests, shop, factions, events, giveaways, expeditions, duels, info, seasons, staff, setupPanel]) {
    feature(bot);
  }
}
