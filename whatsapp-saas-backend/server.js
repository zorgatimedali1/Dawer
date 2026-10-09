const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');

const PORT = Number(process.env.PORT || 3000);
const GATEWAY_SECRET = process.env.GATEWAY_SECRET;
const WORKER_URL = (process.env.WORKER_URL || '').replace(/\/+$/, '');
const WORKER_CALLBACK_SECRET = process.env.WHATSAPP_WEB_CALLBACK_SECRET || '';
const AUTH_DATA_PATH = process.env.AUTH_DATA_PATH || './data';
const MAX_SESSIONS = Number(process.env.MAX_SESSIONS || 4);
/**
 * WhatsApp web build rolled out 2026-10-07T15:28Z broke session RESTORE for
 * whatsapp-web.js 1.34.7 (authenticated fires, ready never does). The previous
 * build paired and sent successfully the same day; serve it from a local cache
 * shipped in the image instead of whatever WhatsApp serves next.
 */
const WEB_VERSION = process.env.WEB_VERSION || '2.3000.1049540024-alpha';
const WEB_CACHE_PATH = process.env.WEB_CACHE_PATH || path.join(process.cwd(), 'wwebjs_cache');
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL
  || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '')
).replace(/\/+$/, '');

const READY_TIMEOUT_MS = 10 * 60 * 1000;
const MIN_DELAY_MS = 12000;
const MAX_DELAY_MS = 25000;
const MAX_RECIPIENTS = 500;

if (!GATEWAY_SECRET) {
  console.error('Missing required env: GATEWAY_SECRET');
  process.exit(1);
}
if (!WORKER_URL) {
  console.error('Missing required env: WORKER_URL (e.g. https://campaignflow-backend.workers.dev)');
  process.exit(1);
}

const DEFAULT_TEMPLATE =
  '🎁 *{greet} {name}!*\n\nThanks for spinning our wheel. You won a *{prize}*! Show this message to claim your reward on your next visit. 🥂';
const GREETINGS = ['Hey', 'Hello', 'Hi', 'Awesome news'];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pick = (list) => list[Math.floor(Math.random() * list.length)];

const app = express();
app.use(express.json({ limit: '256kb' }));

const BUSINESS_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Per-tenant tokens minted by the Worker (see gatewayTokens there):
 *   <businessId>.<hmac(GATEWAY_SECRET, "<purpose>:<businessId>")>
 * Two purposes exist so a browser-visible pairing link can never authorize the
 * broadcast pool: `wgt` = server-to-server queue/status, `wgt-pair` = QR page only.
 */
function hmacHex(purpose, tenantId) {
  return crypto.createHmac('sha256', GATEWAY_SECRET).update(`${purpose}:${tenantId}`).digest('hex');
}

function verifyTenantToken(provided, purpose) {
  const raw = String(provided || '');
  const dot = raw.indexOf('.');
  if (dot < 1) return null;
  const tenantId = raw.slice(0, dot);
  const signature = raw.slice(dot + 1);
  if (!BUSINESS_ID_PATTERN.test(tenantId)) return null;
  const expected = hmacHex(purpose, tenantId);
  const a = Buffer.from(signature, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return tenantId;
}

/**
 * A container restart can leave a SingletonLock written by the previous boot
 * (different hostname → Chromium exits with code 21 "profile in use by
 * another computer"). No browser runs yet at this point, so the locks are
 * always stale here.
 */
function clearStaleChromiumLocks(root) {
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  const locks = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    for (const scope of [entry.name, path.join(entry.name, 'Default')]) {
      for (const lock of locks) {
        try {
          fs.unlinkSync(path.join(root, scope, lock));
        } catch {
          // Not present — nothing to clear.
        }
      }
    }
  }
}

clearStaleChromiumLocks(AUTH_DATA_PATH);

/**
 * WhatsApp's Service Worker + CacheStorage live inside each session profile.
 * They serve the cached app shell straight from disk (no network request), so
 * Puppeteer's request interception — and therefore the pinned webVersion —
 * never applies. Wipe them at boot; the pinned build re-registers its own SW
 * on first load. Session keys (IndexedDB/cookies) are untouched.
 */
function clearWebCaches(root) {
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  const cacheDirs = ['Service Worker', 'CacheStorage', 'Cache', 'Code Cache', 'GPUCache'];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    for (const cacheDir of cacheDirs) {
      try {
        fs.rmSync(path.join(root, entry.name, 'Default', cacheDir), { recursive: true, force: true });
      } catch {
        // Not present — nothing to clear.
      }
    }
  }
}

clearWebCaches(AUTH_DATA_PATH);

if (fs.existsSync(path.join(WEB_CACHE_PATH, `${WEB_VERSION}.html`))) {
  console.log(`Pinned WhatsApp web build present: ${WEB_VERSION}`);
} else {
  console.error(`WARNING: pinned WhatsApp web build MISSING: ${path.join(WEB_CACHE_PATH, `${WEB_VERSION}.html`)}`);
}

/**
 * One-time migration: the pre-multi-session gateway stored its single paired
 * account under session-dawer_saas_session. When LEGACY_SESSION_TENANT names
 * the owning business, adopt that directory for its per-tenant session so the
 * phone stays linked and nobody has to re-scan the QR.
 */
function adoptLegacySession() {
  const tenantId = process.env.LEGACY_SESSION_TENANT || '';
  if (!BUSINESS_ID_PATTERN.test(tenantId)) return;
  const from = path.join(AUTH_DATA_PATH, 'session-dawer_saas_session');
  const to = path.join(AUTH_DATA_PATH, `session-${tenantId}`);
  if (!fs.existsSync(from) || fs.existsSync(to)) return;
  try {
    fs.renameSync(from, to);
    console.log(`[${tenantId}] Adopted the legacy paired session — no re-scan needed.`);
  } catch (error) {
    console.error(`[${tenantId}] Unable to adopt the legacy session.`, error && error.message);
  }
}

adoptLegacySession();

/** tenantId (business UUID) -> isolated session with its own phone, queue and state. */
const sessions = new Map();

function createSession(tenantId) {
  const session = {
    tenantId,
    state: 'STARTING', // STARTING | PAIRING | READY | DISCONNECTED | AUTH_FAILED
    latestQr: null,
    queue: [],
    running: false,
    lastQrLogAt: 0,
    client: null,
  };

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: tenantId, dataPath: AUTH_DATA_PATH }),
    webVersion: WEB_VERSION,
    webVersionCache: { type: 'local', path: WEB_CACHE_PATH, strict: true },
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    },
  });
  session.client = client;

  client.on('qr', async (qr) => {
    session.state = 'PAIRING';
    try {
      session.latestQr = await qrcode.toDataURL(qr);
    } catch (error) {
      console.error(`[${tenantId}] Unable to render QR code.`, error);
      session.latestQr = null;
    }
    // WhatsApp rotates the code every ~20s; log the real pairing link at most
    // once a minute instead of spamming a line per refresh.
    const now = Date.now();
    if (now - session.lastQrLogAt >= 60_000) {
      session.lastQrLogAt = now;
      const pairToken = `${tenantId}.${hmacHex('wgt-pair', tenantId)}`;
      const where = PUBLIC_BASE_URL
        ? `${PUBLIC_BASE_URL}/pair?key=${pairToken}`
        : `/pair?key=${pairToken} (set PUBLIC_BASE_URL for a full link)`;
      console.log(`⚠️ [${tenantId}] Action Required: open ${where} and scan the QR with WhatsApp → Linked devices.`);
    }
  });

  client.on('authenticated', () => {
    console.log(`[${tenantId}] WhatsApp session authenticated.`);
    // Safety net: if ready never fires after restore, say so loudly (the
    // whatsapp-web.js post-auth flow fails silently by design).
    session.readyWatchdog = setTimeout(async () => {
      if (session.state === 'READY') return;
      console.error(`[${tenantId}] READY WATCHDOG: stuck in state=${session.state} 120s after authenticated.`);
      try {
        console.error(`[${tenantId}] watchdog webVersion=${await client.getWWebVersion()}`);
      } catch (error) {
        console.error(`[${tenantId}] watchdog probe failed:`, error && error.message);
      }
    }, 120_000);
  });

  client.on('loading_screen', (percent) => {
    if (percent % 25 === 0) console.log(`[${tenantId}] loading ${percent}%`);
  });

  client.on('change_state', (state) => {
    console.log(`[${tenantId}] WA state -> ${state}`);
  });

  client.on('auth_failure', () => {
    session.state = 'AUTH_FAILED';
    console.error(`[${tenantId}] WhatsApp authentication failed. Delete the session data and pair again.`);
  });

  client.on('ready', () => {
    session.state = 'READY';
    session.latestQr = null;
    session.lastQrLogAt = 0;
    if (session.readyWatchdog) clearTimeout(session.readyWatchdog);
    console.log(`✅ [${tenantId}] WhatsApp Web session is online.`);
  });

  client.on('disconnected', (reason) => {
    session.state = 'DISCONNECTED';
    console.error(`[${tenantId}] WhatsApp disconnected (${reason}); retrying in 10s.`);
    setTimeout(() => {
      if (session.state === 'DISCONNECTED') {
        client
          .initialize()
          .catch((error) => console.error(`[${tenantId}] Re-initialize failed.`, error));
      }
    }, 10000);
  });

  client
    .initialize()
    .then(() => {
      if (session.state === 'STARTING') session.state = 'PAIRING';
    })
    .catch((error) => {
      session.state = 'DISCONNECTED';
      console.error(`[${tenantId}] WhatsApp client failed to start.`, error);
    });

  sessions.set(tenantId, session);
  console.log(`[${tenantId}] Session created (${sessions.size}/${MAX_SESSIONS}).`);
  return session;
}

function getSession(tenantId) {
  const existing = sessions.get(tenantId);
  if (existing) return existing;
  if (sessions.size >= MAX_SESSIONS) return null;
  return createSession(tenantId);
}

function sanitizePhone(phone) {
  const digits = String(phone == null ? '' : phone).replace(/[^0-9]/g, '');
  return digits ? `${digits}@c.us` : null;
}

function buildMessage(template, recipient) {
  const name = String(recipient.name || '').trim() || 'there';
  const prize = String(recipient.prize || '').trim() || 'surprise';
  return String(template || DEFAULT_TEMPLATE)
    .replace(/\{greet\}/g, pick(GREETINGS))
    .replace(/\{name\}/g, name)
    .replace(/\{prize\}/g, prize);
}

function requireQueueToken(req, res, next) {
  const auth = req.headers.authorization || '';
  const tenantId = verifyTenantToken(auth.replace(/^Bearer\s+/i, ''), 'wgt');
  if (!tenantId) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }
  req.tenantId = tenantId;
  return next();
}

async function postToWorker(payload) {
  if (!WORKER_URL) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${WORKER_URL}/api/whatsapp-web/internal/progress`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-callback-secret': WORKER_CALLBACK_SECRET,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) {
      // A silent 403/404 here would leave the campaign stuck in PROCESSING
      // on the Worker side — always surface the rejection.
      console.error(
        `Worker callback rejected (HTTP ${response.status}) for campaign ${payload.campaignId || '?'} event ${payload.event || '?'}.`,
      );
    }
  } catch (error) {
    console.error('Worker callback failed (will keep sending).', error.message || error);
  } finally {
    clearTimeout(timer);
  }
}

async function waitForReady(timeoutMs, job, session) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (job && job.cancelled) return false;
    if (session.state === 'READY') return true;
    if (session.state === 'AUTH_FAILED') return false;
    await sleep(2000);
  }
  return session.state === 'READY';
}

async function runQueue(session) {
  if (session.running) return;
  session.running = true;
  const queue = session.queue;
  const tenantId = session.tenantId;
  try {
    while (queue.length > 0) {
      const job = queue[0];

      if (job.cancelled) {
        queue.shift();
        await postToWorker({
          campaignId: job.campaignId,
          event: 'complete',
          cancelled: true,
          sent: job.sent,
          failed: job.failed,
        });
        continue;
      }

      const ready = await waitForReady(READY_TIMEOUT_MS, job, session);
      if (!ready) {
        queue.shift();
        await postToWorker({
          campaignId: job.campaignId,
          event: 'failed',
          sent: job.sent,
          failed: job.failed,
          error: 'WhatsApp session is not ready.',
        });
        continue;
      }

      for (const recipient of job.recipients) {
        if (job.cancelled) break;

        if (session.state !== 'READY') {
          const back = await waitForReady(2 * 60 * 1000, job, session);
          if (!back) break;
        }

        const jid = sanitizePhone(recipient.phone);
        if (!jid) {
          job.failed += 1;
          await postToWorker({
            campaignId: job.campaignId,
            event: 'progress',
            sent: job.sent,
            failed: job.failed,
            phone: String(recipient.phone || ''),
            ok: false,
            error: 'Invalid phone number.',
          });
        } else {
          try {
            await session.client.sendMessage(jid, buildMessage(job.message, recipient));
            job.sent += 1;
            console.log(`[${tenantId}] [Sent Background] Message delivered to ${recipient.name || recipient.phone}`);
            await postToWorker({
              campaignId: job.campaignId,
              event: 'progress',
              sent: job.sent,
              failed: job.failed,
              phone: String(recipient.phone || ''),
              ok: true,
            });
          } catch (error) {
            job.failed += 1;
            const message = String((error && error.message) || error).slice(0, 300);
            console.error(`[${tenantId}] [Error Background] Delivery failed for ${recipient.name || recipient.phone}:`, message);
            await postToWorker({
              campaignId: job.campaignId,
              event: 'progress',
              sent: job.sent,
              failed: job.failed,
              phone: String(recipient.phone || ''),
              ok: false,
              error: message,
            });
          }
        }

        const dynamicDelay = Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS + 1)) + MIN_DELAY_MS;
        await sleep(dynamicDelay);
      }

      queue.shift();
      if (!job.cancelled) {
        await postToWorker({
          campaignId: job.campaignId,
          event: 'complete',
          sent: job.sent,
          failed: job.failed,
        });
        console.log(`🏁 [${tenantId}] Completed background broadcast ${job.campaignId} (sent ${job.sent}, failed ${job.failed}).`);
      }
    }
  } finally {
    session.running = false;
  }
}

function aggregateState() {
  if (sessions.size === 0) return 'STARTING';
  const states = [...sessions.values()].map((session) => session.state);
  if (states.includes('READY')) return 'READY';
  if (states.includes('PAIRING')) return 'PAIRING';
  if (states.includes('STARTING')) return 'STARTING';
  if (states.includes('DISCONNECTED')) return 'DISCONNECTED';
  return states[0] || 'STARTING';
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, state: aggregateState(), sessions: sessions.size });
});

app.get('/pair', (req, res) => {
  const tenantId = verifyTenantToken(req.query.key, 'wgt-pair');
  if (!tenantId) {
    return res.status(404).send('Not found');
  }
  const session = getSession(tenantId);
  if (!session) {
    return res.status(503).send('Gateway session capacity reached. Try again later.');
  }
  const stateLabel = {
    STARTING: 'Starting WhatsApp…',
    PAIRING: 'Scan this QR with WhatsApp (Linked devices) within 60 seconds. Refresh for a fresh code.',
    READY: 'Already paired and ready. No QR needed.',
    DISCONNECTED: 'Disconnected. The gateway will retry automatically.',
    AUTH_FAILED: 'Pairing failed. Clear the session data and pair again.',
  }[session.state];
  const image = session.latestQr
    ? `<img src="${session.latestQr}" alt="WhatsApp pairing QR" style="width:280px;height:280px" />`
    : '';
  return res.send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><title>Dawer WhatsApp Gateway</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>body{font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;background:#f5f9ef;color:#0d120b}main{text-align:center}p{max-width:32rem;margin:1rem auto}</style></head>
<body><main><h1>WhatsApp pairing</h1><p>${stateLabel}</p>${image}<p><a href="/pair?key=${encodeURIComponent(String(req.query.key))}">Refresh</a></p></main></body></html>`);
});

app.post('/api/broadcast-pool', requireQueueToken, (req, res) => {
  const session = getSession(req.tenantId);
  if (!session) {
    return res.status(503).json({ error: 'Gateway session capacity reached. Try again later.' });
  }

  const body = req.body || {};
  const campaignId = typeof body.campaignId === 'string' ? body.campaignId.trim() : '';
  const recipients = Array.isArray(body.recipients) ? body.recipients : null;

  if (!campaignId) return res.status(400).json({ error: 'campaignId is required.' });
  if (!recipients || recipients.length === 0) {
    return res.status(400).json({ error: 'Winners list cannot be empty.' });
  }
  if (recipients.length > MAX_RECIPIENTS) {
    return res.status(400).json({ error: `Winners list cannot exceed ${MAX_RECIPIENTS} entries.` });
  }

  session.queue.push({
    campaignId,
    recipients,
    message: typeof body.message === 'string' && body.message.trim() ? body.message : DEFAULT_TEMPLATE,
    sent: 0,
    failed: 0,
    cancelled: false,
  });

  res.status(202).json({
    status: 'processing',
    message: `Successfully queued ${recipients.length} messages in background.`,
  });
  void runQueue(session);
});

app.post('/api/broadcast-pool/:campaignId/cancel', requireQueueToken, (req, res) => {
  const session = sessions.get(req.tenantId);
  const job = session ? session.queue.find((item) => item.campaignId === req.params.campaignId) : null;
  if (!job) return res.status(404).json({ error: 'Campaign not found in gateway queue.' });
  job.cancelled = true;
  res.json({ status: 'cancelling' });
});

app.get('/api/status', requireQueueToken, (req, res) => {
  const session = getSession(req.tenantId);
  if (!session) {
    return res.status(503).json({ error: 'Gateway session capacity reached. Try again later.' });
  }
  res.json({
    state: session.state,
    qr: session.state === 'PAIRING' ? session.latestQr : null,
    queueDepth: session.queue.length,
    currentJob: session.queue[0]
      ? {
        campaignId: session.queue[0].campaignId,
        total: session.queue[0].recipients.length,
        sent: session.queue[0].sent,
        failed: session.queue[0].failed,
      }
      : null,
  });
});

app.listen(PORT, () => {
  console.log(`Gateway engine processing on port ${PORT} (max ${MAX_SESSIONS} sessions, web ${WEB_VERSION})`);
});

// The whatsapp-web.js post-auth flow can reject silently inside Puppeteer's
// exposed callbacks — surface anything that leaks out instead of losing it.
process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION:', reason && reason.stack ? reason.stack : reason);
});
process.on('uncaughtException', (error) => {
  console.error('UNCAUGHT EXCEPTION:', error && error.stack ? error.stack : error);
  setTimeout(() => process.exit(1), 5000).unref();
});

const shutdown = () => {
  console.log('Shutting down gateway…');
  const destroys = [...sessions.values()].map((session) => session.client.destroy().catch(() => {}));
  Promise.all(destroys).finally(() => process.exit(0));
  setTimeout(() => process.exit(0), 10000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
