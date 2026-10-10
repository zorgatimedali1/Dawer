/**
 * Load test for the public spin/claim hot path against a running Worker.
 *
 *   1. Seed:  npx wrangler d1 execute campaignflow --local -c wrangler.jsonc --file scripts/loadtest-seed.sql
 *   2. Run:   node scripts/loadtest.mjs http://127.0.0.1:8787
 *
 * Scenario A — "same visitor mashes the spin button": 50 concurrent POSTs
 *   with the SAME anonymousId + visitor cookie must yield exactly ONE 200
 *   and 49 duplicate 409s (Durable Object lock + spin_claims backstop).
 * Scenario B — "throughput": distinct visitors (unique anonymousId + email)
 *   hit the same endpoint concurrently; reports latency percentiles, RPS
 *   and the status histogram.
 */

const base = (process.argv[2] ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
const CODE = process.argv[3] ?? 'LDTEST000001';
const SCENARIO_A_CONCURRENCY = 50;
const SCENARIO_B_VISITORS = 180; // total requests stay under the 300/min public limiter

const PARTICIPATE = `${base}/api/public/campaigns/${CODE}/participate`;
const CAMPAIGN_URL = `${base}/api/public/campaigns/${CODE}`;

const hex = (bytes) => Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
const uuid = () => crypto.randomUUID();

const COOKIE_SIGNING_KEY = process.env.COOKIE_SIGNING_KEY ?? 'loadtest-cookie-signing-key';

async function hmacSha256Hex(secret, value) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** Mints the signed `<id>.<mac>` value the app's `verifySpinVisitorValue` expects. */
async function mintVisitorCookie() {
  const id = hex(32);
  const mac = await hmacSha256Hex(COOKIE_SIGNING_KEY, `spin:${id}`);
  return `${id}.${mac}`;
}

let transportRetries = 0;

async function participateOnce({ anonymousId, email, cookie }) {
  const started = performance.now();
  const response = await fetch(PARTICIPATE, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: `cf_spin_visitor=${cookie}` },
    body: JSON.stringify({ anonymousId, email, marketingConsent: false }),
  });
  const text = await response.text();
  let message = '';
  try {
    const parsed = JSON.parse(text);
    message = parsed.message ?? parsed.error ?? '';
  } catch {
    /* not json */
  }
  return { status: response.status, ms: performance.now() - started, message };
}

/**
 * wrangler dev's ProxyWorker occasionally drops sustained concurrent
 * connections ("Network connection lost" → 500 with no app stack trace).
 * Those are harness failures, not app failures, so retry them; genuine app
 * responses (200/403/404/409/429) are never retried.
 */
async function participate(input) {
  let result;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      result = await participateOnce(input);
    } catch (error) {
      result = { status: 0, ms: 0, message: String(error?.message ?? error) };
    }
    if (result.status !== 0 && result.status !== 500) return result;
    transportRetries += 1;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return result;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

function histogram(results) {
  const counts = new Map();
  for (const result of results) {
    const key = `${result.status}${result.message ? ` (${result.message})` : ''}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Server at ${base} never became healthy.`);
}

async function main() {
  await waitForServer();

  const campaignProbe = await fetch(CAMPAIGN_URL);
  const campaignBody = await campaignProbe.json().catch(() => ({}));
  console.log(`GET campaign -> ${campaignProbe.status} ${campaignBody.success ? '(live campaign)' : ''}`);
  if (campaignProbe.status !== 200) {
    throw new Error('Seed missing or campaign not reachable — run loadtest-seed.sql first.');
  }

  // ---- Scenario A: 50 concurrent spins from ONE visitor -------------------
  const shared = { anonymousId: uuid(), cookie: await mintVisitorCookie() };
  const aStarted = performance.now();
  const aResults = await Promise.all(Array.from({ length: SCENARIO_A_CONCURRENCY }, () => participate(shared)));
  const aWall = performance.now() - aStarted;
  const aOk = aResults.filter((r) => r.status === 200).length;
  const aDuplicates = aResults.filter((r) => r.status === 409).length;
  const aOther = aResults.length - aOk - aDuplicates;

  console.log('\n=== Scenario A: same visitor, 50 concurrent spins ===');
  console.log(`200 winners: ${aOk}   409 duplicates: ${aDuplicates}   other: ${aOther}   wall: ${aWall.toFixed(0)}ms`);
  for (const [key, count] of histogram(aResults)) console.log(`  ${count} x ${key}`);
  const aPass = aOk === 1 && aDuplicates === SCENARIO_A_CONCURRENCY - 1 && aOther === 0;
  console.log(aPass ? 'PASS — exactly one spin won the race, no double participation.' : 'FAIL — expected 1x200 + 49x409.');

  // ---- Scenario B: distinct visitors, throughput --------------------------
  const bResults = [];
  const bStarted = performance.now();
  const concurrency = 20;
  let cursor = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (cursor < SCENARIO_B_VISITORS) {
        const i = cursor++;
        bResults.push(
          await participate({
            anonymousId: uuid(),
            email: `load-${i}-${hex(4)}@example.test`,
            cookie: await mintVisitorCookie(),
          }),
        );
      }
    }),
  );
  const bWall = performance.now() - bStarted;
  const latencies = bResults.map((r) => r.ms).sort((x, y) => x - y);
  const bOk = bResults.filter((r) => r.status === 200).length;

  console.log(`\n=== Scenario B: ${SCENARIO_B_VISITORS} distinct visitors, ${concurrency} in flight ===`);
  console.log(`completed: ${bResults.length}/${SCENARIO_B_VISITORS} in ${(bWall / 1000).toFixed(1)}s  (${((bResults.length / bWall) * 1000).toFixed(1)} req/s)`);
  console.log(`latency ms: p50 ${percentile(latencies, 50).toFixed(0)}   p95 ${percentile(latencies, 95).toFixed(0)}   p99 ${percentile(latencies, 99).toFixed(0)}   max ${percentile(latencies, 100).toFixed(0)}`);
  console.log(`200 OK: ${bOk}/${SCENARIO_B_VISITORS}   transport retries: ${transportRetries}`);
  for (const [key, count] of histogram(bResults)) console.log(`  ${count} x ${key}`);

  const bPass = bOk === SCENARIO_B_VISITORS;
  console.log(bPass ? 'PASS — every distinct visitor participated exactly once.' : 'FAIL — non-200 responses present (rate limit 429? seed missing?).');

  process.exit(aPass && bPass ? 0 : 1);
}

main().catch((error) => {
  console.error('Load test crashed:', error);
  process.exit(1);
});
