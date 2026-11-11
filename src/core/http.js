// Optional HTTP server: GET /health for uptime monitors and, when DISCORD_PUBLIC_KEY is set,
// POST /interactions for Discord's signed HTTP interactions (Ed25519 verification).
import http from 'node:http';
import crypto from 'node:crypto';

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export function createVerifier(publicKeyHex) {
  const key = crypto.createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKeyHex, 'hex')]), format: 'der', type: 'spki' });
  return (signatureHex, timestamp, body) => {
    try {
      if (!signatureHex || !timestamp) return false;
      return crypto.verify(null, Buffer.concat([Buffer.from(timestamp), Buffer.from(body)]), key, Buffer.from(signatureHex, 'hex'));
    } catch {
      return false;
    }
  };
}

function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('payload too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export function startHttpServer(bot, { port, host }) {
  const verify = bot.config.publicKey ? createVerifier(bot.config.publicKey) : null;
  const log = bot.log.child('http');

  const server = http.createServer(async (req, res) => {
    const url = req.url?.split('?')[0];
    if (req.method === 'GET' && (url === '/health' || url === '/')) {
      const body = JSON.stringify({ status: bot.gateway?.ready ? 'ok' : 'degraded', uptime: Math.round(process.uptime()), shards: bot.gateway?.status() ?? [], guilds: bot.cache.guilds.size, version: bot.config.version });
      res.writeHead(bot.gateway?.ready ? 200 : 503, { 'Content-Type': 'application/json' }).end(body);
      return;
    }
    if (req.method === 'POST' && url === '/interactions' && verify) {
      let body;
      try {
        body = await readBody(req);
      } catch {
        res.writeHead(413).end();
        return;
      }
      const signature = req.headers['x-signature-ed25519'];
      const timestamp = req.headers['x-signature-timestamp'];
      if (!verify(signature, timestamp, body) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) {
        res.writeHead(401).end('invalid request signature');
        return;
      }
      let raw;
      try {
        raw = JSON.parse(body.toString('utf8'));
      } catch {
        res.writeHead(400).end();
        return;
      }
      if (raw.type === 1) {
        res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"type":1}');
        return;
      }
      // Respond through the callback endpoint, then acknowledge the HTTP request with 202.
      let ctxRef = null;
      const done = bot.router.dispatch(raw, { onContext: (ctx) => { ctxRef = ctx; } }).catch((err) => log.error('http interaction failed', err));
      const firstAck = new Promise((resolve) => {
        const check = () => (ctxRef ? ctxRef.firstAck.then(resolve) : setTimeout(check, 5));
        check();
      });
      await Promise.race([firstAck, done, new Promise((r) => setTimeout(r, 2_900))]);
      res.writeHead(202).end();
      return;
    }
    res.writeHead(404).end();
  });

  server.listen(port, host, () => log.info(`listening on http://${host}:${port}${verify ? ' (interactions endpoint enabled)' : ''}`));
  server.on('error', (err) => log.error('http server error', err));
  return server;
}
