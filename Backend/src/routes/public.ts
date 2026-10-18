import { z } from 'zod';
import { applySoldOutOdds, ensureNoWinSlice, isSoldOutReward, pickWeightedReward } from '../lib/reward';
import { errorResponse, jsonResponse } from '../lib/http';
import { actionClaimSchema, customerDetailsSchema, participationSchema, parsePlayRules, applyAccountPlayPolicy, resolveWheelTheme, type PlayRules, type WheelTheme } from '../lib/validation';
import { secureRandomHex, sha256Hex } from '../lib/crypto';
import { buildCookie, mintSpinVisitorValue, readSpinVisitor, spinVisitorCookieName, verifySpinVisitorValue } from '../lib/cookie';
import { mintActionTicket, verifyActionTicket } from '../lib/action-ticket';
import { distanceMetersBetween } from '../lib/geo';
import { getCustomerLimit, customerLimitFromAccess, wheelCenterLogoAllowed, wheelDesignAllowed, wheelStepsColorAllowed } from '../lib/subscription-limits';
import { accessFromSubscriptionRow, readStarterPlan, type BusinessAccess } from '../lib/subscription-access';
import { handlePublicLogoRoute, handlePublicWheelLogoRoute, businessWheelLogoPath } from './settings';
import type { Env } from '../types';

/** Campaign + business branding + subscription/plan columns from the shared fetch. */
interface SharedCampaignRow {
  id: string;
  name: string;
  description: string | null;
  public_code: string;
  status: string;
  start_at: string | null;
  end_at: string | null;
  game_type: string;
  require_action: string | null;
  require_customer_information: number;
  play_rules: string | null;
  google_maps_name: string | null;
  google_maps_url: string | null;
  google_place_id: string | null;
  facebook_url: string | null;
  instagram_url: string | null;
  latitude: number | null;
  longitude: number | null;
  radius_meters: number | null;
  business_id: string;
  business_play_policy: string | null;
  business_name: string | null;
  business_logo: string | null;
  business_wheel_theme: string | null;
  business_wheel_theme_override: string | null;
  sub_status: string | null;
  sub_period_start: string | null;
  sub_period_end: string | null;
  plan_id: string | null;
  plan_name: string | null;
  plan_slug: string | null;
  plan_price_cents: number | null;
  plan_interval: string | null;
  plan_features: string | null;
}

/**
 * Counts one QR scan per visitor per UTC day on the public campaign page.
 *
 * The page GET is the only request a QR landing triggers, so it is the only
 * place this fires. The pre-read keeps repeat loads (refresh, back button, SPA
 * remount) off the D1 write path, while the unique index from migration 0040
 * keeps concurrent first loads idempotent even if a read replica lags. A
 * failure here must never surface to the visitor — the scan is a side effect.
 */
async function recordQrScan(
  env: Env,
  businessId: string,
  campaignId: string,
  visitorHash: string | null,
): Promise<void> {
  if (!visitorHash) return;

  const now = new Date();
  const scanKey = `${visitorHash}|${now.toISOString().slice(0, 10)}`;

  try {
    const alreadyCounted = await env.DB.prepare(
      `SELECT 1 AS found FROM analytics_events
       WHERE business_id = ? AND campaign_id = ? AND event_type = 'QR_SCANNED' AND event_data = ?
       LIMIT 1`,
    )
      .bind(businessId, campaignId, scanKey)
      .first();

    if (alreadyCounted) return;

    await env.DB.prepare(
      `INSERT OR IGNORE INTO analytics_events (id, business_id, campaign_id, event_type, event_data, created_at)
       VALUES (?, ?, ?, 'QR_SCANNED', ?, ?)`,
    )
      .bind(crypto.randomUUID(), businessId, campaignId, scanKey, now.toISOString())
      .run();
  } catch (error) {
    console.error('qr_scan_record_failed', error instanceof Error ? error.message : String(error));
  }
}

/** Active rewards for a wheel, normalized and with sold-out odds applied. */
type WheelReward = {
  id: string;
  name: string;
  description: string | null;
  type: string;
  value: string | null;
  weight: number;
  quantity: number;
  quantityInitial: number;
};

const WHEEL_REWARD_FIELDS = `id, name, description, type, value, weight, quantity, quantity_initial`;

function toWheelRewards(rows: unknown[]): WheelReward[] {
  return rows.map((row) => {
    const raw = row as Record<string, unknown>;
    return {
      id: String(raw.id),
      name: String(raw.name),
      description: raw.description == null ? null : String(raw.description),
      type: String(raw.type),
      value: raw.value == null ? null : String(raw.value),
      weight: Number(raw.weight ?? 0),
      quantity: Number(raw.quantity ?? 0),
      quantityInitial: Number(raw.quantity_initial ?? 0),
    };
  });
}

/**
 * Loads a campaign's active rewards for display and picking. Unlike the old
 * query this keeps sold-out rows (they stay on the wheel at 0%) and moves
 * their weight onto the campaign's "none" slice — switching that slice on the
 * first time it has a share to absorb, and reloading once so the response
 * already carries the boosted weight.
 */
async function selectWheelRewards(env: Env, campaignId: string): Promise<WheelReward[]> {
  const load = () =>
    env.DB
      .prepare(
        `SELECT ${WHEEL_REWARD_FIELDS}
         FROM rewards
         WHERE campaign_id = ? AND active = 1
         ORDER BY weight DESC, created_at ASC`,
      )
      .bind(campaignId)
      .all();

  const rows = toWheelRewards(((await load()).results) ?? []);

  if (!rows.some((row) => isSoldOutReward(row))) return applySoldOutOdds(rows);

  if (!(await ensureNoWinSlice(env, campaignId))) return applySoldOutOdds(rows);

  return applySoldOutOdds(toWheelRewards(((await load()).results) ?? []));
}

/**
 * Stores a new customer under the plan's storage quota.
 *
 * The quota is a rolling window of the N most recent stored contacts: when
 * the business is already at its limit, the oldest stored customer (first
 * added) is evicted — their participations and coupons are unlinked
 * (`customer_id = NULL`) so spin/reward history and issued codes survive —
 * and the new contact takes the freed slot. Returning contacts never reach
 * this helper (the dedupe runs first). Unlimited plans (`limit < 0`) never
 * evict.
 *
 * The eviction + retry insert run as one atomic batch, and the insert keeps
 * its own `COUNT < limit` guard, so a lost race stores nothing instead of
 * exceeding the cap.
 */
async function insertCustomerWithinQuota(
  env: Env,
  businessId: string,
  values: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
    marketingConsent: boolean;
    timestamp: string;
  },
  limit: number,
): Promise<{ stored: boolean; evicted: boolean }> {
  const insertOnce = () =>
    env.DB.prepare(
      // OR IGNORE: a concurrent submit for the same identity used to make the
      // unique email index throw (surfacing as a 500); ignore it and detect
      // the duplicate below instead.
      `INSERT OR IGNORE INTO customers (id, business_id, first_name, last_name, email, phone, marketing_consent, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE ? < 0 OR (SELECT COUNT(*) FROM customers WHERE business_id = ?) < ?`,
    ).bind(
      values.id,
      businessId,
      values.firstName,
      values.lastName,
      values.email,
      values.phone,
      values.marketingConsent ? 1 : 0,
      values.timestamp,
      values.timestamp,
      limit,
      businessId,
      limit,
    );

  const first = await insertOnce().run();
  if (first.meta.changes > 0) return { stored: true, evicted: false };
  if (limit < 0) return { stored: false, evicted: false };

  // changes === 0 with no throw: either a concurrent insert of the same
  // identity won the race (already stored — report success, never evict over
  // it) or the store is genuinely at its cap.
  const identityKey = (values.email ?? values.phone ?? values.id).toLowerCase();
  const duplicate = await env.DB.prepare(
    `SELECT id FROM customers WHERE business_id = ? AND LOWER(COALESCE(email, phone, id)) = ? LIMIT 1`,
  )
    .bind(businessId, identityKey)
    .first<{ id: string }>();
  if (duplicate) return { stored: true, evicted: false };

  const oldest = await env.DB.prepare(
    `SELECT id FROM customers WHERE business_id = ? ORDER BY created_at ASC, rowid ASC LIMIT 1`,
  )
    .bind(businessId)
    .first<{ id: string }>();

  if (!oldest) return { stored: false, evicted: false };

  const batch = await env.DB.batch([
    env.DB.prepare(`UPDATE participations SET customer_id = NULL WHERE customer_id = ?`).bind(oldest.id),
    env.DB.prepare(`UPDATE coupons SET customer_id = NULL WHERE customer_id = ?`).bind(oldest.id),
    env.DB.prepare(`DELETE FROM customers WHERE id = ?`).bind(oldest.id),
    insertOnce(),
  ]);

  const retried = batch[3];
  return { stored: (retried?.meta.changes ?? 0) > 0, evicted: true };
}

export async function handlePublicCampaignRoute(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (/^\/api\/public\/businesses\/[^/]+\/logo$/.test(url.pathname)) {
    return await handlePublicLogoRoute(request, env);
  }

  if (/^\/api\/public\/businesses\/[^/]+\/wheel-logo$/.test(url.pathname)) {
    return await handlePublicWheelLogoRoute(request, env);
  }

  const publicCampaign = /^\/api\/public\/campaigns\/([^/]+)(?:\/|$)/.exec(url.pathname);
  let sharedCampaign: SharedCampaignRow | null = null;
  let campaignAccess: BusinessAccess | null = null;
  if (publicCampaign?.[1]) {
    // One fetch feeds the wrapper's access gate AND every handler below —
    // the campaign row, business branding, subscription and plan all ride
    // on this query so the spin path never re-reads them.
    const row = await env.DB.prepare(
      `SELECT c.*,
              b.play_policy AS business_play_policy,
              b.name AS business_name,
              b.logo AS business_logo,
              b.wheel_theme AS business_wheel_theme,
              b.wheel_theme_override AS business_wheel_theme_override,
              s.status AS sub_status,
              s.updated_at AS sub_period_start,
              s.current_period_end AS sub_period_end,
              p.id AS plan_id,
              p.name AS plan_name,
              p.slug AS plan_slug,
              p.price_cents AS plan_price_cents,
              p.interval AS plan_interval,
              p.features AS plan_features
       FROM campaigns c
       LEFT JOIN businesses b ON b.id = c.business_id
       LEFT JOIN subscriptions s ON s.business_id = c.business_id
       LEFT JOIN plans p ON p.id = s.plan_id
       WHERE (c.public_code = ? OR c.id = ?)
       LIMIT 1`,
    )
      .bind(publicCampaign[1], publicCampaign[1])
      .first<SharedCampaignRow>();

    if (row) {
      sharedCampaign = row;
      const fallback = row.plan_id ? null : await readStarterPlan(env);
      campaignAccess = accessFromSubscriptionRow(
        row.sub_status == null
          ? null
          : {
              status: row.sub_status,
              current_period_start: row.sub_period_start,
              current_period_end: row.sub_period_end,
              id: row.plan_id,
              name: row.plan_name,
              slug: row.plan_slug,
              price_cents: row.plan_price_cents,
              interval: row.plan_interval,
              features: row.plan_features,
            },
        fallback,
      );
      if (!campaignAccess.canManage) {
        return errorResponse('Campaign not found.', 404);
      }
    }
  }

  const campaignMatch = /^\/api\/public\/campaigns\/([^/]+)$/.exec(url.pathname);

  if (request.method === 'GET' && campaignMatch) {
    const now = new Date().toISOString();
    const shared = sharedCampaign;
    if (
      !shared ||
      shared.status !== 'ACTIVE' ||
      (shared.start_at && shared.start_at > now) ||
      (shared.end_at && shared.end_at < now)
    ) {
      return errorResponse('Campaign not found.', 404);
    }

    const campaign: Record<string, unknown> = {
      id: shared.id,
      name: shared.name,
      description: shared.description,
      public_code: shared.public_code,
      status: shared.status,
      start_at: shared.start_at,
      end_at: shared.end_at,
      game_type: shared.game_type,
      require_action: shared.require_action,
      require_customer_information: shared.require_customer_information,
      play_rules: shared.play_rules,
      google_maps_name: shared.google_maps_name,
      google_maps_url: shared.google_maps_url,
      google_place_id: shared.google_place_id,
      facebook_url: shared.facebook_url,
      instagram_url: shared.instagram_url,
      latitude: shared.latitude,
      longitude: shared.longitude,
      business_id: shared.business_id,
      business_name: shared.business_name,
      business_logo: shared.business_logo,
    };

    // The operator's account policy overrides the merchant's own rules, so
    // the client must see the effective mode — a forced "once" campaign
    // shows the already-played card, a forced "windowed" one never does.
    const effectiveRules = applyAccountPlayPolicy(
      parsePlayRules(shared.play_rules),
      shared.business_play_policy,
    );
    campaign.play_rules = effectiveRules ? JSON.stringify(effectiveRules) : null;

    // Same operator-wins shape for the wheel design: without the plan flag
    // (Starter, or a locked plan) colors and motion stay default, while
    // the hub logo resolves separately so Pro can show it on the default wheel.
    const access = campaignAccess;
    const designAllowed = wheelDesignAllowed(access?.plan.slug, access?.plan.features.limits);
    const centerLogoAllowed = wheelCenterLogoAllowed(access?.plan.slug, access?.plan.features.limits);
    const stepsColorAllowed = wheelStepsColorAllowed(access?.plan.slug, access?.plan.features.limits);
    const wheelTheme: WheelTheme = resolveWheelTheme({
      merchantTheme: shared.business_wheel_theme,
      overrideTheme: shared.business_wheel_theme_override,
      designAllowed,
      centerLogoAllowed,
      stepsColorAllowed,
    });
    campaign.wheel_theme = wheelTheme;
    // Only ship the center-hub URL when the theme asks for it; the visitor
    // then 404s gracefully via onError if no image was ever uploaded.
    campaign.wheel_logo =
      wheelTheme.centerLogo && shared.business_id
        ? businessWheelLogoPath(String(shared.business_id))
        : null;
    delete campaign.business_id;

    // The visitor identity is only trusted when it carries a MAC under the
    // server key: a forged, legacy or absent cookie gets replaced with a
    // freshly signed one on every load, so rotation-from-JS never sticks.
    const existingVisitor = readSpinVisitor(request);
    const verifiedVisitor =
      env.COOKIE_SIGNING_KEY && existingVisitor
        ? await verifySpinVisitorValue(env.COOKIE_SIGNING_KEY, existingVisitor)
        : null;

    let issuedVisitorId = verifiedVisitor;
    let freshCookieValue: string | null = null;

    if (env.COOKIE_SIGNING_KEY) {
      if (!verifiedVisitor) {
        const freshId = secureRandomHex(32);
        freshCookieValue = await mintSpinVisitorValue(env.COOKIE_SIGNING_KEY, freshId);
        issuedVisitorId = freshId;
      }
    } else {
      // Fail closed downstream (unverified visitors only get the no-win slice)
      // but never silently — a missing key means anti-fraud is effectively off.
      console.error('cookie_signing_key_missing', 'COOKIE_SIGNING_KEY is not configured; spin identities cannot be verified.');
    }

    // Signed action ticket: the /action claim needs proof that a browser with
    // a real identity loaded this page (P2-3). Bound to campaign + visitor,
    // and only handed out when the campaign actually gates on an action.
    const requiredAction = campaign.require_action ?? 'NONE';
    let actionTicket: string | null = null;
    if (env.COOKIE_SIGNING_KEY && issuedVisitorId && requiredAction !== 'NONE') {
      actionTicket = await mintActionTicket(env.COOKIE_SIGNING_KEY, String(campaign.id), issuedVisitorId);
    }

    // Same campaign+visitor key as `participations.visitor_hash`, so one
    // browser scans this campaign at most once per UTC day.
    const scanHash = issuedVisitorId ? await sha256Hex(`${campaign.id}:${issuedVisitorId}`) : null;

    const [wheelRewards] = await Promise.all([
      selectWheelRewards(env, String(campaign.id)),
      recordQrScan(env, String(shared.business_id), String(campaign.id), scanHash),
    ]);

    const response = jsonResponse({
      success: true,
      campaign,
      rewards: wheelRewards.map(({ quantityInitial: _quantityInitial, ...row }) => row),
      ...(actionTicket ? { actionTicket } : {}),
    });

    if (freshCookieValue) {
      response.headers.append(
        'set-cookie',
        buildCookie(request, spinVisitorCookieName(request), freshCookieValue, 31_536_000),
      );
    } else {
      // No per-visitor cookie on this response (COOKIE_SIGNING_KEY unset, or
      // an already-verified visitor): if it were cached, the QR-scan side
      // effect above would only fire once per TTL window instead of once per
      // visitor, undercounting scans. Keep it uncached.
      response.headers.set('Cache-Control', 'no-store');
    }

    return response;
  }

  const actionMatch = /^\/api\/public\/campaigns\/([^/]+)\/action$/.exec(url.pathname);

  if (actionMatch) {
    if (request.method !== 'POST') {
      return errorResponse('Method not allowed.', 405);
    }

    if (!sharedCampaign || sharedCampaign.public_code !== actionMatch[1]) {
      return errorResponse('Campaign not found.', 404);
    }
    return handleActionClaim(env, sharedCampaign, request);
  }

  const detailsMatch = /^\/api\/public\/campaigns\/([^/]+)\/participations\/([^/]+)\/customer$/.exec(url.pathname);

  if (detailsMatch) {
    if (request.method !== 'POST') {
      return errorResponse('Method not allowed.', 405);
    }

    return handleCustomerDetails(env, detailsMatch[1], detailsMatch[2], request);
  }

  const match = /^\/api\/public\/campaigns\/([^/]+)\/participate$/.exec(url.pathname);

  if (!match) {
    return errorResponse('Route not found.', 404);
  }

  if (request.method !== 'POST') {
    return errorResponse('Method not allowed.', 405);
  }

  // Undo bookkeeping for the participation chain: if a write fails part-way
  // through, the catch block below restores stock, hands the claim rows back
  // and releases the Durable Object lock so the visitor can retry.
  type LockStub = ReturnType<typeof env.CAMPAIGN_LOCK.getByName>;
  let lock: LockStub | null = null;
  let lockClaimed = false;
  let undoRelease: (() => Promise<void>) | null = null;
  let decrementedRewardId: string | null = null;
  // Set only when *this* attempt materialized the customer row: the rollback
  // path deletes it so a failed spin never leaves an orphan that counts
  // against the merchant's storage quota.
  let createdCustomerId: string | null = null;
  // True when createdCustomerId's row took an evicted customer's slot. A
  // recycled slot is kept even on rollback: the old customer is already gone,
  // so deleting this one too would shrink the roster for nothing.
  let slotRecycled = false;
  // Every durable `spin_claims` row this attempt wrote (browser key first,
  // then the advisory contact key) — all of them go back on any failure.
  const claimRowIds: string[] = [];

  const dropSpinClaimRows = async () => {
    while (claimRowIds.length) {
      const id = claimRowIds.pop();
      if (id) await env.DB.prepare(`DELETE FROM spin_claims WHERE id = ?`).bind(id).run();
    }
  };

  try {
    const publicCode = match[1];
    const body = participationSchema.parse(await request.json());
    const nowIso = new Date().toISOString();

    // The shared fetch resolved this campaign during wrapper gating; the
    // strict public_code match preserves the old "id-only POSTs 404" shape.
    const campaign = sharedCampaign?.public_code === publicCode ? sharedCampaign : null;

    if (!campaign) {
      return errorResponse('Campaign not found.', 404);
    }

    // Bot protection is a per-IP daily spin floor enforced further down (see
    // the anti-farm section). Turnstile used to gate this endpoint too, but a
    // token minted while the page is visible is invalidated when the page is
    // backgrounded or delayed, so real visitors hit a dead end with no way to
    // proceed. The floor bounds one address without ever blocking a human.

    // P2-7 proximity: recorded as a soft signal for fraud review. Missing
    // coordinates on either side (or a client that sends none) just yields no
    // signal — it never blocks the spin. The SPA no longer asks for browser
    // location at all, so this only ever fires for API clients that opt in.
    const distanceMeters = (() => {
      if (campaign.latitude == null || campaign.longitude == null) return null;
      if (body.latitude === undefined || body.longitude === undefined) return null;
      return Math.round(
        distanceMetersBetween(Number(campaign.latitude), Number(campaign.longitude), body.latitude, body.longitude),
      );
    })();

    const withinWindow =
      (!campaign.start_at || campaign.start_at <= nowIso) &&
      (!campaign.end_at || campaign.end_at >= nowIso);

    if (campaign.status !== 'ACTIVE' || !withinWindow) {
      return errorResponse('Campaign is not accepting spins right now.', 409);
    }

    // The operator's account policy is a hard override of the campaign's own
    // rules: it decides the frequency (once vs windowed, per-day, cooldown),
    // while win budget / IP cap stay with the merchant's windowed config.
    const playRules: PlayRules | null = applyAccountPlayPolicy(
      parsePlayRules(campaign.play_rules),
      campaign.business_play_policy,
    );
    const windowed = playRules?.mode === 'windowed';

    // Hashed request signals: the raw IP and user agent never leave this
    // module, and the hashes double as the per-network throttle key and the
    // audit trail in `spin_events`.
    const clientIp = request.headers.get('cf-connecting-ip') ?? '';
    const userAgent = request.headers.get('user-agent') ?? '';
    const ipHash = clientIp ? await sha256Hex(`${campaign.id}:${clientIp}`) : null;
    const uaHash = userAgent ? await sha256Hex(userAgent) : null;

    // The sticky browser id is the strongest key we have: email and phone are
    // supplied by the client and can be rotated between spins, the stored
    // device hash cannot. The HttpOnly visitor cookie wins over both — but only
    // once its signature verifies: a forged or legacy value falls through to
    // the client-supplied identity and gets demoted to the no-win slice below.
    const rawSpinVisitor = readSpinVisitor(request);
    const spinVisitor =
      env.COOKIE_SIGNING_KEY && rawSpinVisitor
        ? await verifySpinVisitorValue(env.COOKIE_SIGNING_KEY, rawSpinVisitor)
        : null;
    const cookieIdentity = spinVisitor ? await sha256Hex(`${campaign.id}:${spinVisitor}`) : null;

    // The device hash is preferred over the rotating anonymous id so a farm
    // that regenerates ids still collides on one identity.
    const gateIdentity = body.deviceHash ?? body.anonymousId;
    const requiredAction = campaign.require_action ?? 'NONE';

    if (requiredAction !== 'NONE') {
      if (!gateIdentity && !cookieIdentity) {
        return errorResponse('Complete the required action first.', 403);
      }

      // The claim may have been written under the signed cookie identity (the
      // preferred key on /action) or under the client-supplied id — accept
      // either so one browser cannot mint claims by rotating anonymous ids.
      const claimKeys = [cookieIdentity ?? gateIdentity ?? '', gateIdentity ?? cookieIdentity ?? ''];
      const claim = await env.DB.prepare(
        `SELECT id FROM action_claims
          WHERE campaign_id = ? AND anonymous_id IN (?, ?) AND action = ?
          LIMIT 1`,
      )
        .bind(campaign.id, claimKeys[0], claimKeys[1], requiredAction)
        .first<{ id: string }>();

      if (!claim) {
        return errorResponse('Complete the required action first.', 403);
      }
    }

    // Per-network cap: applies in every mode (once + windowed). A merchant who
    // explicitly configured `maxPlaysPerIpDay` keeps their cap as-is (it is a
    // deliberate setting, stricter or looser). A campaign that configured
    // nothing is lifted to the platform safety floor (`IP_SPINS_PER_DAY`) so a
    // farm rotating cookies/ids from one address cannot replay it indefinitely.
    // Counted before the durable claim so a rejected attempt never burns the
    // spin allowance. A merchant who *explicitly* configured a cap is asking
    // for a per-network gate, so a request with no IP signal is refused (there
    // is nothing to count it against). The platform floor alone never rejects
    // for a missing IP — an address-less request is simply not counted (the
    // durable identity claim still gates it).
    const ipSpinFloor = Number(env.IP_SPINS_PER_DAY ?? 10);
    const merchantIpCap = playRules?.maxPlaysPerIpDay ?? 0;
    const effectiveIpSpinCap =
      merchantIpCap > 0
        ? merchantIpCap
        : Number.isFinite(ipSpinFloor) && ipSpinFloor > 0
          ? ipSpinFloor
          : 0;
    if (merchantIpCap > 0 && !ipHash) {
      return errorResponse('Spins from this network are not available right now.', 409);
    }
    if (effectiveIpSpinCap > 0 && ipHash) {
      const windowStart = new Date(Date.now() - 86_400_000).toISOString();
      const ipCount = await env.DB.prepare(
        `SELECT COUNT(*) AS total FROM spin_events
          WHERE campaign_id = ? AND ip_hash = ? AND created_at >= ?`,
      )
        .bind(campaign.id, ipHash, windowStart)
        .first<{ total: number }>();

      if ((ipCount?.total ?? 0) >= effectiveIpSpinCap) {
        return errorResponse('Too many spins from this network. Please try again later.', 409);
      }
    }

    // Platform safety valve: all tenants share one D1 write budget on the
    // free plan, so a single viral wheel could otherwise burn it and make
    // every other merchant's spins fail for the rest of the UTC day. The cap
    // is deliberately generous (5000/day default) — real campaigns never see
    // it; it only exists to bound the blast radius of an outlier. Counted with
    // the other refusals, before the durable claim, so a rejected attempt
    // never holds a slot.
    const dailySpinCap = Number(env.CAMPAIGN_DAILY_SPIN_CAP ?? 5000);
    if (Number.isFinite(dailySpinCap) && dailySpinCap > 0) {
      const dayStart = new Date().toISOString().slice(0, 10);
      const todaySpins = await env.DB.prepare(
        `SELECT COUNT(*) AS total FROM participations WHERE campaign_id = ? AND created_at >= ?`,
      )
        .bind(campaign.id, `${dayStart}T00:00:00.000Z`)
        .first<{ total: number }>();

      if ((todaySpins?.total ?? 0) >= dailySpinCap) {
        return errorResponse(
          'The wheel is at capacity today. Please come back tomorrow.',
          429,
          { code: 'campaign_capacity' },
        );
      }
    }

    const customerKey = (
      body.email ??
      body.phone ??
      gateIdentity ??
      `${body.firstName ?? 'guest'}_${body.lastName ?? 'visitor'}`
    )
      .trim()
      .toLowerCase();

    // P2-5: only a real contact (email/phone) may materialize a customer row.
    // Anonymous spins store `customer_id = NULL` and attach details later —
    // otherwise a farm fills the plan's storage quota and every new visitor
    // gets a permanent 409.
    const hasContact = Boolean(body.email ?? body.phone);

    // The sticky browser id was already resolved above (before the action
    // gate); the durable claim keys on it now.
    const visitorKey = (cookieIdentity ?? gateIdentity ?? customerKey).trim().toLowerCase();

    // No usable identity at all: the fallback customerKey collapses every
    // anonymous visitor onto one shared claim key (the literal `guest_*`
    // name), so one farm visitor would block every other guest. Refuse
    // before any claim is taken — nothing is held yet at this point.
    if (!cookieIdentity && !gateIdentity && !hasContact) {
      return errorResponse('Open this page through your campaign link to participate.', 403);
    }

    // P2-4: durability keys on the verified cookie first — email and phone are
    // unverified, client-supplied values, so an attacker who POSTs a victim's
    // address before they play must not burn a permanent claim for them. The
    // sticky non-contact id (device hash / anonymous id / guest name) still
    // gets its own claim, so rotating cookies alone cannot replay a campaign.
    // Email-keyed claims exist only in `spin_claims` below (once-mode), where
    // the merchant can expire them.
    const claimKey = (cookieIdentity ?? customerKey).trim().toLowerCase();
    const stickyKeyRaw = gateIdentity ?? (hasContact ? null : customerKey);
    const stickyKey = stickyKeyRaw ? stickyKeyRaw.trim().toLowerCase() : null;

    // Claim the participation slot before touching the customers table so a
    // rejected spin never leaves an orphan guest row behind.
    lock = env.CAMPAIGN_LOCK.getByName(`campaign:${campaign.id}:${claimKey}`);
    const claimPolicy =
      windowed && playRules
        ? { mode: 'windowed' as const, perDay: playRules.perDay, cooldownMinutes: playRules.cooldownMinutes }
        : undefined;

    // The browser-identity and sticky-identity claims are independent Durable
    // Objects, so they are claimed in parallel; a denial on either is undone
    // against the other before returning, same as the old sequential order.
    const useStickyClaim = Boolean(stickyKey && stickyKey !== claimKey);
    let stickyLock: LockStub | null = useStickyClaim
      ? env.CAMPAIGN_LOCK.getByName(`campaign:${campaign.id}:${stickyKey}`)
      : null;
    let stickyLockClaimed = false;

    // Hands back whichever claims are still held — used by every early return
    // below and by the catch block if a later write fails. Defined (and wired
    // into `undoRelease`) *before* the claims so a throw mid-claim can never
    // leak a slot that was granted: the catch block retries this same path.
    const releaseClaims = async () => {
      if (stickyLockClaimed && stickyLock && stickyKey) {
        await stickyLock.release(campaign.id, stickyKey);
        stickyLockClaimed = false;
      }
      if (lockClaimed && lock) {
        await lock.release(campaign.id, claimKey);
        lockClaimed = false;
      }
      // A contact row this attempt created goes with the failed spin: keeping
      // it would let scripted failures (random emails at a sold-out wheel)
      // fill the merchant's customer-storage quota with unreachable rows.
      // A recycled slot is the exception — the evicted customer is already
      // gone, and the rolling window reclaims stray rows on the next winner.
      if (createdCustomerId) {
        if (!slotRecycled) {
          await env.DB.prepare('DELETE FROM customers WHERE id = ?').bind(createdCustomerId).run();
        }
        createdCustomerId = null;
        slotRecycled = false;
      }
    };
    undoRelease = releaseClaims;

    // A Durable Object error must never leak a claim: the throw collapses to
    // a denial, and whichever sibling claim was granted is handed back by the
    // release path above.
    const claimSafely = async (stub: LockStub | null, key: string) => {
      if (!stub) return null;
      try {
        return await stub.claim(campaign.id, key, claimPolicy);
      } catch (error) {
        console.error('Campaign claim failed.', error);
        return { allowed: false as const, reason: 'unavailable' };
      }
    };

    const [lockResult, stickyResult] = await Promise.all([
      claimSafely(lock, claimKey),
      claimSafely(stickyLock, stickyKey ?? ''),
    ]);

    let denialReason: string | null = lockResult && !lockResult.allowed ? String(lockResult.reason ?? 'duplicate_spin') : null;
    if (lockResult?.allowed) {
      lockClaimed = true;
    }
    if (stickyResult?.allowed && stickyLock && stickyKey) {
      stickyLockClaimed = true;
    }

    if (denialReason !== null) {
      // The speculative sticky claim must be handed back when the primary
      // claim lost its race.
      if (stickyLockClaimed) {
        await releaseClaims();
      }
      lock = null;
      stickyLock = null;
    } else if (stickyLock && stickyKey && !stickyResult?.allowed) {
      denialReason = String(stickyResult?.reason ?? 'duplicate_spin');
      await releaseClaims();
      lock = null;
      stickyLock = null;
    }

    if (denialReason !== null) {
      if (denialReason === 'unavailable') {
        return errorResponse('The wheel is busy. Please try again.', 503);
      }
      const message =
        denialReason === 'cooldown'
          ? 'Please wait before spinning again.'
          : denialReason === 'daily_limit'
            ? "You have reached today's spin limit. Come back tomorrow."
            : 'This customer has already participated in this campaign.';
      return errorResponse(message, 409);
    }

    // P2-5: the customer row is materialized only for a real contact. The
    // quota therefore only ever counts rows the merchant can actually reach,
    // and an anonymous farm can no longer brick the campaign's storage.
    const customerId = crypto.randomUUID();
    let resolvedCustomerId: string | null = null;

    if (hasContact) {
      const customerResult = await env.DB.prepare(
        `SELECT id FROM customers WHERE business_id = ? AND LOWER(COALESCE(email, phone, id)) = ? LIMIT 1`,
      )
        .bind(campaign.business_id, customerKey)
        .first<{ id: string }>();

      resolvedCustomerId = customerResult?.id ?? customerId;

      if (!customerResult) {
        const limit = customerLimitFromAccess(campaignAccess);
        const stored = await insertCustomerWithinQuota(env, campaign.business_id, {
          id: customerId,
          firstName: body.firstName ?? null,
          lastName: body.lastName ?? null,
          email: body.email ?? null,
          phone: body.phone ?? null,
          marketingConsent: Boolean(body.marketingConsent),
          timestamp: nowIso,
        }, limit);

        if (!stored.stored) {
          await releaseClaims();
          return errorResponse(
            `This merchant has reached its customer storage limit (${limit} customers). Upgrade the plan to store more customers.`,
            409,
          );
        }

        createdCustomerId = customerId;
        slotRecycled = stored.evicted;
      }
    }

    // The reward listing and the win-budget reads are independent of each
    // other (and of the customer block above), so they run in parallel: the
    // Durable Object win counts and the per-IP budget query overlap the
    // rewards SELECT instead of stacking after it on every spin.
    const budgetFlow = (async () => {
      // Win budget: once the identity holds its daily wins, force the "no win"
      // slice so a farm can never drain the campaign's value — or refuse the
      // spin outright when the campaign has no such slice configured.
      //
      // Two independent ceilings, the stricter one wins:
      //   * merchant winBudget — per sticky/cookie identity (windowed only) and
      //     per IP, all modes. Only enforced when the merchant set one (> 0).
      //   * platform per-IP floor (IP_WINS_PER_DAY) — always enforced in every
      //     mode, so a farm rotating identities from one address is capped even
      //     on a once campaign that configured no budget at all.
      let exhausted = false;
      const merchantWinBudget = playRules?.winBudget ?? 0;

      // Per-identity budgets key on the sticky non-contact id and the verified
      // cookie — never on email/phone (P2-4: pre-spending a victim's budget
      // would only ever hand them the "no win" slice). Each identity's wins
      // are read from the Durable Object that holds its claim, so a rotating
      // cookie cannot reset the device budget.
      if (windowed && merchantWinBudget > 0) {
        const stickyWins = stickyLock
          ? ((await stickyLock.getWinCount(campaign.id, stickyKey ?? '')) ?? 0)
          : stickyKey && stickyKey === claimKey
            ? ((await lock?.getWinCount(campaign.id, claimKey)) ?? 0)
            : 0;
        const cookieWins = cookieIdentity ? ((await lock?.getWinCount(campaign.id, cookieIdentity)) ?? 0) : 0;
        exhausted = stickyWins >= merchantWinBudget || cookieWins >= merchantWinBudget;
      }

      // Per-network budget in every mode: however many identities one address
      // rotates through, it can only spend the effective wins per rolling day.
      // `spin_events.is_win` backs it, so the count survives DO loss. A merchant
      // who configured a winBudget keeps it as-is (stricter or looser); a
      // campaign that configured none is lifted to the platform per-IP win
      // floor (IP_WINS_PER_DAY) so a farm draining one address is capped even
      // on a once campaign with no budget.
      const ipWinFloor = Number(env.IP_WINS_PER_DAY ?? 3);
      const effectiveIpWinCap =
        merchantWinBudget > 0
          ? merchantWinBudget
          : Number.isFinite(ipWinFloor) && ipWinFloor > 0
            ? ipWinFloor
            : 0;

      if (!exhausted && effectiveIpWinCap > 0 && ipHash) {
        const windowStart = new Date(Date.now() - 86_400_000).toISOString();
        const ipWins = await env.DB.prepare(
          `SELECT COUNT(*) AS total FROM spin_events
            WHERE campaign_id = ? AND ip_hash = ? AND created_at >= ? AND is_win = 1`,
        )
          .bind(campaign.id, ipHash, windowStart)
          .first<{ total: number }>();

        exhausted = (ipWins?.total ?? 0) >= effectiveIpWinCap;
      }
      return exhausted;
    })();

    const [wheelRewards, budgetExhausted] = await Promise.all([
      selectWheelRewards(env, String(campaign.id)),
      budgetFlow,
    ]);

    // Fail closed: without the server-set HttpOnly visitor cookie there is no
    // identity that survives across spins (email, phone, device hash and
    // anonymous id are all client-supplied), so an unverified visitor only
    // ever receives the "no win" slice — or, when the campaign has none, the
    // spin is refused instead of falling back to a guessable identity.
    const unverifiedVisitor = cookieIdentity === null;

    let selectedReward;

    if (budgetExhausted || unverifiedVisitor) {
      selectedReward = wheelRewards.find((reward) => reward.type === 'none');

      if (!selectedReward) {
        await releaseClaims();
        return errorResponse(
          unverifiedVisitor
            ? 'Open this page through your campaign link to participate.'
            : "You have reached today's win limit. Come back tomorrow.",
          409,
        );
      }
    } else {
      // Sold-out slices stay on the wheel at 0%; they must never win, so the
      // pick only considers slices that still carry weight.
      selectedReward = pickWeightedReward(wheelRewards.filter((reward) => reward.weight > 0));
    }

    if (!selectedReward) {
      // Hand the slot back: nothing was written, so the visitor keeps the one
      // spin they are allowed once stock is topped up again.
      await releaseClaims();
      return errorResponse('No reward available for this campaign.', 400);
    }

    // Durable backstop for the in-memory lock: a unique row per visitor per
    // campaign, enforced by D1 rather than Durable Object storage. Windowed
    // campaigns skip it — their claims expire, the unique index never would.
    if (!windowed) {
      const claimRow = await env.DB.prepare(
        `INSERT INTO spin_claims (id, campaign_id, visitor_key, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(campaign_id, visitor_key) DO NOTHING
         RETURNING id`,
      )
        .bind(crypto.randomUUID(), campaign.id, visitorKey, nowIso)
        .first<{ id: string }>();

      if (!claimRow) {
        await releaseClaims();
        return errorResponse('This customer has already participated in this campaign.', 409);
      }
      claimRowIds.push(claimRow.id);

      // P2-4 (advisory): the contact key keeps its "same email twice" rule,
      // but only here in D1 — never as a Durable Object claim — and only for
      // once-mode, where the merchant's claims-expire action can lift it if an
      // address was burned before its owner ever played.
      if (hasContact) {
        const contactClaim = await env.DB.prepare(
          `INSERT INTO spin_claims (id, campaign_id, visitor_key, created_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(campaign_id, visitor_key) DO NOTHING
           RETURNING id`,
        )
          .bind(crypto.randomUUID(), campaign.id, `contact:${customerKey}`, nowIso)
          .first<{ id: string }>();

        if (!contactClaim) {
          await dropSpinClaimRows();
          await releaseClaims();
          return errorResponse('This customer has already participated in this campaign.', 409);
        }
        claimRowIds.push(contactClaim.id);
      }
    }

    // A `type = 'none'` slice ("Prochaine fois") hands out nothing: no stock to
    // burn and no coupon to issue, but the spin is still recorded.
    const isNoWin = selectedReward.type === 'none';

    // Only rewards that were capped at creation time burn stock; an
    // unconfigured quantity means unlimited availability. The UPDATE doubles
    // as a compare-and-swap: if a concurrent spin took the last unit, hand
    // every claim back instead of issuing a coupon for stock we no longer hold.
    if (!isNoWin && selectedReward.quantityInitial > 0) {
      const decremented = await env.DB.prepare(
        `UPDATE rewards SET quantity = MAX(quantity - 1, 0), updated_at = ?
         WHERE id = ? AND quantity > 0
         RETURNING quantity`,
      )
        .bind(nowIso, selectedReward.id)
        .first<{ quantity: number }>();

      if (!decremented) {
        await dropSpinClaimRows();
        await releaseClaims();
        return errorResponse('No reward available for this campaign.', 409);
      }
      decrementedRewardId = selectedReward.id;
      selectedReward.quantity = Number(decremented.quantity ?? 0);
    }

    // No coupon is written here: the row is created only once the winner
    // submits their details, so an abandoned form never leaves an unnamed
    // "Unknown" coupon in the merchant's list (see handleCustomerDetails).
    const couponCode = '';
    const participationId = crypto.randomUUID();
    const now = nowIso;

    // One implicit transaction: a crash between the participation row and the
    // audit trail must never leave a half-recorded spin behind.
    const chain = [
      env.DB.prepare(
        `INSERT INTO participations (id, campaign_id, customer_id, reward_id, result, visitor_hash, distance_meters, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(participationId, campaign.id, resolvedCustomerId, selectedReward.id, selectedReward.name, cookieIdentity, distanceMeters, now),
    ];

    chain.push(
      env.DB.prepare(
        `INSERT INTO analytics_events (id, business_id, campaign_id, event_type, event_data, created_at)
         VALUES (?, ?, ?, 'PARTICIPATION', ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        campaign.business_id,
        campaign.id,
        JSON.stringify({ rewardId: selectedReward.id, customerKey, isWin: !isNoWin, couponCode: null }),
        now,
      ),
    );

    // No REWARD_CLAIMED event either: the `coupons` row written when the
    // winner submits their details is the single source of truth analytics
    // derives `rewardsClaimed` from. Fewer event rows = faster analytics
    // reads + smaller storage footprint per spin.

    chain.push(
      env.DB.prepare(
        `INSERT INTO spin_events (id, campaign_id, visitor_key, device_hash, ip_hash, ua_hash, is_win, distance_meters, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(crypto.randomUUID(), campaign.id, visitorKey, body.deviceHash ?? null, ipHash, uaHash, isNoWin ? 0 : 1, distanceMeters, now),
    );

    await env.DB.batch(chain);

    // The chain committed — from here nothing is worth unwinding, and the
    // lock claims must stay held: that is what blocks the next spin. The
    // customer row is now legitimate CRM data, not a rollback target.
    claimRowIds.length = 0;
    decrementedRewardId = null;
    lockClaimed = false;
    stickyLockClaimed = false;
    createdCustomerId = null;
    slotRecycled = false;

    // The spin landed: count it toward the campaign's win budget on each
    // identity's own claim — the sticky non-contact id (or the browser key
    // when they coincide) plus the verified cookie. Best-effort: the DO may
    // be briefly unreachable, and a failure here must not 500 a spin that
    // already committed (the visitor would spin again on reload).
    if (windowed && !isNoWin) {
      try {
        if (stickyKey) {
          const stickyTarget = stickyLock ?? (stickyKey === claimKey ? lock : null);
          await stickyTarget?.recordWin(campaign.id, stickyKey);
        }
        if (cookieIdentity) await lock?.recordWin(campaign.id, cookieIdentity);
      } catch (winCountError) {
        console.error(
          'record_win_failed',
          winCountError instanceof Error ? winCountError.message : String(winCountError),
        );
      }
    }

    return jsonResponse({
      success: true,
      participation: {
        participationId,
        campaignId: campaign.id,
        reward: selectedReward,
        couponCode,
      },
    });
  } catch (error) {
    // Unwind whatever the chain already wrote so a failure never costs the
    // visitor their spin or the merchant its stock.
    try {
      await dropSpinClaimRows();
      if (decrementedRewardId) {
        await env.DB.prepare(`UPDATE rewards SET quantity = quantity + 1, updated_at = ? WHERE id = ?`)
          .bind(new Date().toISOString(), decrementedRewardId)
          .run();
        decrementedRewardId = null;
      }
      if (undoRelease) {
        // releaseClaims checks each held flag itself, so a sticky-only claim
        // (primary denied mid-flight) is handed back too.
        await undoRelease();
      }
    } catch (rollbackError) {
      console.error('Participation rollback failed.', rollbackError);
    }

    if (error instanceof z.ZodError) {
      return errorResponse('Validation failed.', 400, error.flatten());
    }

    console.error('Participation failed.', error);
    return errorResponse('Unable to process participation.', 500);
  }
}

async function handleActionClaim(env: Env, campaign: { id: string; require_action: string | null }, request: Request): Promise<Response> {
  try {
    const body = actionClaimSchema.parse(await request.json());

    const requiredAction = campaign.require_action ?? 'NONE';

    if (requiredAction === 'NONE') {
      return jsonResponse({ success: true, required: false });
    }

    if (body.action !== requiredAction) {
      return errorResponse('This campaign requires a different action.', 400);
    }

    // P2-3: the claim needs a signed ticket from a campaign-page load — a
    // blind script that never opened the page cannot mint one. The MAC binds
    // ticket → campaign → this browser's cookie, and enforces a minimum dwell
    // plus an expiry. Every failure collapses to one message so probing
    // learns nothing about which check failed.
    const rawVisitor = readSpinVisitor(request);
    const verifiedVisitor =
      env.COOKIE_SIGNING_KEY && rawVisitor
        ? await verifySpinVisitorValue(env.COOKIE_SIGNING_KEY, rawVisitor)
        : null;

    const ticketCheck =
      env.COOKIE_SIGNING_KEY && verifiedVisitor && body.actionTicket
        ? await verifyActionTicket(env.COOKIE_SIGNING_KEY, campaign.id, verifiedVisitor, body.actionTicket)
        : 'invalid';

    if (ticketCheck !== 'ok') {
      return errorResponse('Reload the campaign page and try again.', 403);
    }

    // The action gate's signed ticket + 3s dwell is the only check here.
    // A Turnstile token used to gate this too, but the visitor must leave for
    // the review/social tab and come back — that backgrounds the page, which
    // invalidates the token, so the step could never be satisfied reliably.

    const now = new Date().toISOString();
    // The signed cookie identity keys the claim: one browser, one claim —
    // rotating anonymous ids from the same browser collides on this key.
    const cookieIdentity = await sha256Hex(`${campaign.id}:${verifiedVisitor}`);
    const claimIdentity = cookieIdentity ?? body.deviceHash ?? body.anonymousId;

    // Idempotent: coming back from the review tab may replay the claim.
    await env.DB.prepare(
      `INSERT INTO action_claims (id, campaign_id, anonymous_id, action, claimed_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(campaign_id, anonymous_id) DO NOTHING`,
    )
      .bind(crypto.randomUUID(), campaign.id, claimIdentity, requiredAction, now, now)
      .run();

    return jsonResponse({ success: true, required: true, action: requiredAction });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse('Validation failed.', 400, error.flatten());
    }

    return errorResponse('Unable to record the action.', 500);
  }
}

async function handleCustomerDetails(
  env: Env,
  publicCode: string,
  participationId: string,
  request: Request,
): Promise<Response> {
  try {
    const body = customerDetailsSchema.parse(await request.json());
    const now = new Date().toISOString();

    const participation = await env.DB.prepare(
      `SELECT p.id, p.customer_id, p.campaign_id, p.reward_id, p.visitor_hash, c.business_id,
              r.type AS reward_type
       FROM participations p
       JOIN campaigns c ON c.id = p.campaign_id
       LEFT JOIN rewards r ON r.id = p.reward_id
       WHERE p.id = ? AND c.public_code = ?
       LIMIT 1`,
    )
      .bind(participationId, publicCode)
      .first<{
        id: string;
        customer_id: string | null;
        campaign_id: string;
        reward_id: string | null;
        visitor_hash: string | null;
        business_id: string;
        reward_type: string | null;
      }>();

    if (!participation) {
      return errorResponse('Participation not found.', 404);
    }

    // P2-8: a participation id alone must not authorize the details form.
    // When the spin recorded a signed visitor identity, only that browser may
    // attach details to it — knowing/guessing the UUID is not enough anymore.
    if (participation.visitor_hash) {
      const rawVisitor = readSpinVisitor(request);
      const verifiedVisitor =
        env.COOKIE_SIGNING_KEY && rawVisitor
          ? await verifySpinVisitorValue(env.COOKIE_SIGNING_KEY, rawVisitor)
          : null;
      const requesterIdentity = verifiedVisitor
        ? await sha256Hex(`${participation.campaign_id}:${verifiedVisitor}`)
        : null;

      if (requesterIdentity !== participation.visitor_hash) {
        return errorResponse('Open this page through your campaign link to submit your details.', 403);
      }
    }

    const emailKey = body.email.trim().toLowerCase();
    const phoneKey = body.phone.trim();

    // P2-5: an anonymous spin stored no customer row at all. Find or create
    // one now — under the plan's storage quota — then bind this participation
    // and the coupon it won to it.
    let boundCustomerId = participation.customer_id;

    if (!boundCustomerId) {
      const existing = await env.DB.prepare(
        `SELECT id FROM customers
          WHERE business_id = ?
            AND ((? <> '' AND LOWER(COALESCE(email, '')) = ?) OR COALESCE(phone, '') = ?)
          LIMIT 1`,
      )
        .bind(participation.business_id, emailKey, emailKey, phoneKey)
        .first<{ id: string }>();

      let attachId: string;

      if (existing) {
        attachId = existing.id;
      } else {
        const candidateId = crypto.randomUUID();
        const limit = await getCustomerLimit(env, participation.business_id);
        const stored = await insertCustomerWithinQuota(env, participation.business_id, {
          id: candidateId,
          firstName: body.firstName,
          lastName: body.lastName,
          email: emailKey || null,
          phone: phoneKey,
          marketingConsent: Boolean(body.marketingConsent),
          timestamp: now,
        }, limit);

        if (!stored.stored) {
          return errorResponse(
            `This merchant has reached its customer storage limit (${limit} customers). Upgrade the plan to store more customers.`,
            409,
          );
        }
        attachId = candidateId;
      }

      await env.DB.prepare(
        `UPDATE participations SET customer_id = ? WHERE id = ? AND customer_id IS NULL`,
      )
        .bind(attachId, participation.id)
        .run();
      await env.DB.prepare(
        `UPDATE coupons SET customer_id = ? WHERE participation_id = ? AND customer_id IS NULL`,
      )
        .bind(attachId, participation.id)
        .run();
      boundCustomerId = attachId;
    }

    const duplicate = await env.DB.prepare(
      `SELECT id FROM customers
       WHERE business_id = ? AND id <> ?
         AND ((? <> '' AND LOWER(COALESCE(email, '')) = ?) OR COALESCE(phone, '') = ?)
       LIMIT 1`,
    )
      .bind(participation.business_id, boundCustomerId, emailKey, emailKey, phoneKey)
      .first<{ id: string }>();

    const targetId = duplicate?.id ?? boundCustomerId;

    const target = await env.DB.prepare(
      `SELECT id, first_name, last_name, email, phone FROM customers WHERE id = ? LIMIT 1`,
    )
      .bind(targetId)
      .first<{ id: string; first_name: string | null; last_name: string | null; email: string | null; phone: string | null }>();

    if (!target) {
      return errorResponse('Customer not found.', 404);
    }

    if (duplicate) {
      await env.DB.prepare(`UPDATE participations SET customer_id = ? WHERE customer_id = ?`)
        .bind(targetId, boundCustomerId)
        .run();
      await env.DB.prepare(`UPDATE coupons SET customer_id = ? WHERE customer_id = ?`)
        .bind(targetId, boundCustomerId)
        .run();
      await env.DB.prepare(`DELETE FROM customers WHERE id = ?`)
        .bind(boundCustomerId)
        .run();
    }

    await env.DB.prepare(
      `UPDATE customers
       SET first_name = ?, last_name = ?, email = ?, phone = ?, marketing_consent = ?, updated_at = ?, last_activity_at = ?
       WHERE id = ?`,
    )
      .bind(
        target.first_name || body.firstName,
        target.last_name || body.lastName,
        target.email || body.email || null,
        target.phone || body.phone,
        body.marketingConsent ? 1 : 0,
        now,
        now,
        targetId,
      )
      .run();

    // The coupon is issued here — and only here — so a winner who abandons
    // this form never leaves an unnamed row in the merchant's list. The
    // `WHERE NOT EXISTS` guard makes a replayed submit idempotent, and a
    // `type = 'none'` slice never wins a coupon at all.
    if (participation.reward_id && participation.reward_type !== 'none') {
      // Race-safe (M1): the partial UNIQUE index on participation_id plus
      // `ON CONFLICT ... DO NOTHING` means two concurrent submits can never
      // mint two codes — the loser simply gets no row and falls through to the
      // SELECT below, which returns the winner's code.
      await env.DB.prepare(
        `INSERT INTO coupons (id, business_id, campaign_id, customer_id, participation_id, reward_id, code, status, issued_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'ISSUED', ?)
         ON CONFLICT(participation_id) DO NOTHING`,
      )
        .bind(
          crypto.randomUUID(),
          participation.business_id,
          participation.campaign_id,
          targetId,
          participation.id,
          participation.reward_id,
          `CF-${secureRandomHex(8).toUpperCase()}`,
          now,
        )
        .run();
    }

    // The exact coupon this submission issued (linked above); the legacy
    // campaign/customer/reward query only covers rows written before the
    // participation link existed.
    const coupon =
      (await env.DB.prepare(`SELECT code FROM coupons WHERE participation_id = ? LIMIT 1`)
        .bind(participation.id)
        .first<{ code: string }>()) ??
      (await env.DB.prepare(
        `SELECT code FROM coupons
         WHERE campaign_id = ? AND customer_id = ? AND reward_id IS ?
         ORDER BY issued_at DESC LIMIT 1`,
      )
        .bind(participation.campaign_id, targetId, participation.reward_id)
        .first<{ code: string }>());

    return jsonResponse({ success: true, couponCode: coupon?.code ?? '' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse('Validation failed.', 400, error.flatten());
    }

    return errorResponse('Unable to save customer details.', 500);
  }
}
