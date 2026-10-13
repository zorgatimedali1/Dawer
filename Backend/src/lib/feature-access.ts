import type { Env } from '../types';

export type FeatureName = 'whatsapp' | 'email';

export interface FeatureFlags {
  whatsappEnabled: boolean;
  emailEnabled: boolean;
}

const PLATFORM_KEYS: Record<FeatureName, string> = {
  whatsapp: 'whatsapp_enabled',
  email: 'email_enabled',
};

function toBool(value: string | number | null | undefined): boolean {
  return value === 1 || value === '1';
}

/**
 * Platform-wide master switches. A missing row means "off" so a fresh database
 * (or a failed migration) leaves the marketing channels disabled until the
 * operator explicitly turns them on.
 */
export async function getPlatformFeatures(env: Env): Promise<FeatureFlags> {
  const rows = await env.DB.prepare('SELECT key, value FROM platform_settings').all<{
    key: string;
    value: string;
  }>();

  const settings = new Map((rows.results ?? []).map((row) => [row.key, row.value]));

  return {
    whatsappEnabled: settings.has(PLATFORM_KEYS.whatsapp) ? toBool(settings.get(PLATFORM_KEYS.whatsapp)) : false,
    emailEnabled: settings.has(PLATFORM_KEYS.email) ? toBool(settings.get(PLATFORM_KEYS.email)) : false,
  };
}

/** Per-business switches written by the operator console. */
export async function getBusinessFeatures(env: Env, businessId: string): Promise<FeatureFlags> {
  const row = await env.DB.prepare(
    'SELECT whatsapp_enabled, email_enabled FROM businesses WHERE id = ? LIMIT 1',
  )
    .bind(businessId)
    .first<{ whatsapp_enabled: number; email_enabled: number }>();

  if (!row) return { whatsappEnabled: false, emailEnabled: false };

  return {
    whatsappEnabled: toBool(row.whatsapp_enabled),
    emailEnabled: toBool(row.email_enabled),
  };
}

/**
 * Platform-wide switch: upserts the master row AND applies the value to every
 * business at once, so the per-account switches in the operator console stay
 * in sync with the Platform controls card. A single account can still be
 * overridden afterwards from the accounts page.
 */
export async function setPlatformFeature(env: Env, feature: FeatureName, enabled: boolean): Promise<void> {
  const column = PLATFORM_KEYS[feature];
  const value = enabled ? '1' : '0';
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO platform_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).bind(column, value, new Date().toISOString()),
    env.DB.prepare(`UPDATE businesses SET ${column} = ?, updated_at = ?`).bind(enabled ? 1 : 0, new Date().toISOString()),
  ]);
}

export async function setBusinessFeatures(env: Env, businessId: string, features: Partial<FeatureFlags>): Promise<void> {
  const sets: string[] = [];
  const binds: Array<string | number> = [];

  if (features.whatsappEnabled !== undefined) {
    sets.push('whatsapp_enabled = ?');
    binds.push(features.whatsappEnabled ? 1 : 0);
  }
  if (features.emailEnabled !== undefined) {
    sets.push('email_enabled = ?');
    binds.push(features.emailEnabled ? 1 : 0);
  }
  if (sets.length === 0) return;

  sets.push('updated_at = ?');
  binds.push(new Date().toISOString());

  await env.DB.prepare(`UPDATE businesses SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...binds, businessId)
    .run();
}

export class FeatureDisabledError extends Error {
  readonly feature: FeatureName;

  constructor(feature: FeatureName) {
    super(
      feature === 'whatsapp'
        ? 'WhatsApp marketing is currently disabled by the platform administrator.'
        : 'Email marketing is currently disabled by the platform administrator.',
    );
    this.name = 'FeatureDisabledError';
    this.feature = feature;
  }
}

/**
 * Effective access = the business switch. The platform master switch only
 * seeds new businesses and bulk-applies via `setPlatformFeature`; a
 * per-account switch always wins for that merchant. Status endpoints return
 * this as `enabled` so the UI can render a disabled banner; every mutation
 * path rejects through `assertFeatureEnabled`.
 */
export async function getEffectiveFeatures(env: Env, businessId: string): Promise<FeatureFlags> {
  return getBusinessFeatures(env, businessId);
}

export async function assertFeatureEnabled(env: Env, businessId: string, feature: FeatureName): Promise<void> {
  const features = await getEffectiveFeatures(env, businessId);
  const enabled = feature === 'whatsapp' ? features.whatsappEnabled : features.emailEnabled;

  if (!enabled) throw new FeatureDisabledError(feature);
}
