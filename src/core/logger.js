// Minimal structured logger with scopes, colours (TTY only), JSON output and secret redaction.

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };
const COLORS = { debug: '\x1b[90m', info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m' };
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';

const redactions = new Set();

/** Register a secret (e.g. the bot token) that must never appear in log output. */
export function addRedaction(secret) {
  if (secret && typeof secret === 'string' && secret.length >= 8) redactions.add(secret);
}

function redact(text) {
  let out = text;
  for (const secret of redactions) {
    if (out.includes(secret)) out = out.split(secret).join('[redacted]');
  }
  return out;
}

function formatValue(value) {
  if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
  } catch {
    return String(value);
  }
}

export class Logger {
  /**
   * @param {{ level?: string, format?: 'pretty'|'json', scope?: string, sink?: (line: string, level: string) => void }} [options]
   */
  constructor({ level = 'info', format = 'pretty', scope = 'core', sink } = {}) {
    this.levelName = LEVELS[level] ? level : 'info';
    this.threshold = LEVELS[this.levelName];
    this.format = format;
    this.scope = scope;
    this.color = format === 'pretty' && process.stdout.isTTY;
    this.sink = sink || ((line, lvl) => (lvl === 'error' || lvl === 'warn' ? process.stderr : process.stdout).write(line + '\n'));
  }

  child(scope) {
    const child = new Logger({ level: this.levelName, format: this.format, scope, sink: this.sink });
    child.color = this.color;
    return child;
  }

  log(level, args) {
    if (LEVELS[level] < this.threshold) return;
    const time = new Date().toISOString();
    if (this.format === 'json') {
      const [first, ...rest] = args;
      const entry = { time, level, scope: this.scope, msg: typeof first === 'string' ? first : formatValue(first) };
      if (rest.length) entry.data = rest.map((v) => (v instanceof Error ? { error: v.message, stack: v.stack } : v));
      this.sink(redact(formatValue(entry)), level);
      return;
    }
    const body = args.map(formatValue).join(' ');
    const tag = level.toUpperCase().padEnd(5);
    const line = this.color
      ? `${DIM}${time}${RESET} ${COLORS[level]}${tag}${RESET} ${DIM}[${this.scope}]${RESET} ${body}`
      : `${time} ${tag} [${this.scope}] ${body}`;
    this.sink(redact(line), level);
  }

  debug(...args) { this.log('debug', args); }
  info(...args) { this.log('info', args); }
  warn(...args) { this.log('warn', args); }
  error(...args) { this.log('error', args); }
}
