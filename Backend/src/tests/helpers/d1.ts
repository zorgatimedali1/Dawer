import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * `node:sqlite` is not listed in `module.builtinModules` on Node 22, so Vite tries
 * to resolve it as a file. Loading it through `createRequire` keeps it opaque to the
 * bundler while still hitting the real engine.
 */
type SqliteStatement = {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): { changes: number | bigint };
};

type SqliteDatabase = {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
};

const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire('node:sqlite') as {
  DatabaseSync: new (path: string) => SqliteDatabase;
};

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(here, '../../db/schema.sql');

type Args = unknown[];

class TestStatement {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly sql: string,
    private readonly params: Args = [],
  ) {}

  bind(...values: Args): TestStatement {
    return new TestStatement(this.db, this.sql, values);
  }

  async first<T>(): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...(this.params as never[]));
    return (row ?? null) as T | null;
  }

  async all<T>(): Promise<{ results: T[]; success: boolean; meta: Record<string, unknown> }> {
    const rows = this.db.prepare(this.sql).all(...(this.params as never[]));
    return { results: rows as T[], success: true, meta: {} };
  }

  async run(): Promise<{ success: boolean; meta: { changes: number } }> {
    const info = this.db.prepare(this.sql).run(...(this.params as never[]));
    return { success: true, meta: { changes: Number(info.changes) } };
  }
}

export class TestDatabase {
  readonly sqlite: SqliteDatabase;

  constructor() {
    this.sqlite = new DatabaseSync(':memory:');
    this.sqlite.exec(readFileSync(schemaPath, 'utf8'));
  }

  prepare(sql: string): TestStatement {
    return new TestStatement(this.sqlite, sql);
  }

  /** Read-replication session stand-in: SQLite has no replicas, so passthrough. */
  withSession(_constraint: string): TestDatabase {
    return this;
  }

  /** Convenience for tests: run a statement and return the single scalar/row. */
  query<T>(sql: string, ...params: Args): T[] {
    return this.sqlite.prepare(sql).all(...(params as never[])) as T[];
  }

  async batch(statements: TestStatement[]): Promise<{ results: unknown[] }> {
    this.sqlite.exec('BEGIN');
    try {
      for (const statement of statements) await statement.run();
      this.sqlite.exec('COMMIT');
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
    return { results: [] };
  }

  close(): void {
    this.sqlite.close();
  }
}

/**
 * Minimal stand-in for the `CampaignParticipationLock` Durable Object: one
 * claim per (campaign, customer) pair in `once` mode, rolling-window claims
 * and win budgets in `windowed` mode, reset for every test. Exported so tests
 * can swap in a fresh registry to simulate losing the Durable Object's storage.
 */
export function createLockRegistry() {
  const DAY_MS = 86_400_000;
  const onceClaims = new Set<string>();
  const windowedClaims = new Map<string, { claims: number[]; wins: number[] }>();

  function prune(state: { claims: number[]; wins: number[] }) {
    const now = Date.now();
    return {
      claims: state.claims.filter((at) => now - at < DAY_MS),
      wins: state.wins.filter((at) => now - at < DAY_MS),
    };
  }

  return {
    getByName(_name: string) {
      return {
        async claim(
          campaignId: string,
          customerKey: string,
          policy?: { mode: 'windowed'; perDay: number; cooldownMinutes: number },
        ) {
          const key = `${campaignId}:${customerKey}`;

          if (!policy) {
            if (onceClaims.has(key)) return { allowed: false as const, reason: 'duplicate_spin' as const };
            onceClaims.add(key);
            return { allowed: true as const };
          }

          const now = Date.now();
          const state = prune(windowedClaims.get(key) ?? { claims: [], wins: [] });

          if (state.claims.length >= policy.perDay) {
            return { allowed: false as const, reason: 'daily_limit' as const };
          }

          const lastClaim = state.claims.length ? state.claims[state.claims.length - 1] : 0;
          if (lastClaim && now - lastClaim < policy.cooldownMinutes * 60_000) {
            return { allowed: false as const, reason: 'cooldown' as const };
          }

          state.claims.push(now);
          windowedClaims.set(key, state);
          return { allowed: true as const };
        },
        async release(campaignId: string, customerKey: string) {
          const key = `${campaignId}:${customerKey}`;
          if (onceClaims.delete(key)) return;

          const state = windowedClaims.get(key);
          if (!state) return;

          state.claims.pop();
          if (state.claims.length === 0 && state.wins.length === 0) windowedClaims.delete(key);
        },
        async recordWin(campaignId: string, customerKey: string) {
          const key = `${campaignId}:${customerKey}`;
          const state = windowedClaims.get(key) ?? { claims: [], wins: [] };
          state.wins.push(Date.now());
          windowedClaims.set(key, state);
        },
        async getWinCount(campaignId: string, customerKey: string) {
          const state = windowedClaims.get(`${campaignId}:${customerKey}`);
          if (!state) return 0;
          const now = Date.now();
          return state.wins.filter((at) => now - at < DAY_MS).length;
        },
      };
    },
  };
}

/**
 * Minimal stand-in for the `TOKENS` KV namespace used by the OAuth handoff
 * and the analytics response cache. Records the `expirationTtl` of each put
 * so cache tests can assert the tiered TTL policy without a real KV clock.
 */
function createTokenStore() {
  const store = new Map<string, string>();
  const ttls = new Map<string, number>();

  return {
    async get(key: string, _options?: { cacheTtl?: number }): Promise<string | null> {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
      store.set(key, value);
      if (options?.expirationTtl !== undefined) ttls.set(key, options.expirationTtl);
    },
    async delete(key: string): Promise<void> {
      store.delete(key);
      ttls.delete(key);
    },
    keys(): string[] {
      return [...store.keys()];
    },
    /** Test helper: expirationTtl recorded at put() time, if any. */
    ttlOf(key: string): number | undefined {
      return ttls.get(key);
    },
  };
}

/**
 * Minimal stand-in for the `WhatsAppBroadcastSender` Durable Object: records
 * which campaign ids were scheduled so tests can assert the POST kicked the
 * sender, then process batches by calling `processBroadcastBatch` directly.
 */
export function createWhatsAppSenderRegistry() {
  const scheduled: string[] = [];

  return {
    scheduled,
    getByName(name: string) {
      return {
        async schedule(campaignId: string) {
          void name;
          scheduled.push(campaignId);
        },
      };
    },
  };
}

/**
 * Minimal stand-in for the `EmailBroadcastSender` Durable Object: records
 * which campaign ids were scheduled so tests can assert the POST handed the
 * delivery off, then drive rounds by calling `processEmailBatch` directly.
 */
export function createEmailSenderRegistry() {
  const scheduled: string[] = [];

  return {
    scheduled,
    getByName(name: string) {
      return {
        async schedule(campaignId: string) {
          void name;
          scheduled.push(campaignId);
        },
      };
    },
  };
}

/**
 * Minimal stand-in for the `WhatsAppPacingGate` Durable Object: by default
 * every send is allowed immediately. Tests can block it to simulate Meta 429s.
 */
export function createPacingGateRegistry() {
  let waitMs = 0;
  let blocked = false;

  return {
    getByName(_name: string) {
      return {
        async acquire() {
          if (blocked) return { allowed: false as const, waitMs };
          return { allowed: true as const };
        },
        async reportRateLimit(retryAfterMs?: number) {
          blocked = true;
          waitMs = retryAfterMs ?? 5_000;
        },
        async waitMs() {
          return blocked ? waitMs : 0;
        },
        async stats() {
          return {
            blockedUntil: blocked ? Date.now() + waitMs : 0,
            lastSentAt: 0,
            opens24h: blocked ? 1 : 0,
          };
        },
      };
    },
    /** Test control: simulate an open circuit. */
    block(ms = 5_000) {
      blocked = true;
      waitMs = ms;
    },
    /** Test control: close the circuit. */
    unblock() {
      blocked = false;
      waitMs = 0;
    },
  };
}

/**
 * Minimal stand-in for the `PARTNER_LOGOS` R2 bucket: keeps logo bytes in a
 * Map with the content type recorded at put() time, mirroring the subset of
 * the R2 API the partner routes use.
 */
function createPartnerLogoStore() {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();

  return {
    async put(
      key: string,
      value: Uint8Array,
      options?: { httpMetadata?: { contentType?: string } },
    ): Promise<void> {
      objects.set(key, {
        bytes: value,
        contentType: options?.httpMetadata?.contentType ?? 'application/octet-stream',
      });
    },
    async get(key: string): Promise<{ body: Uint8Array; httpMetadata: { contentType: string } } | null> {
      const object = objects.get(key);
      if (!object) return null;
      return { body: object.bytes, httpMetadata: { contentType: object.contentType } };
    },
    async delete(key: string): Promise<void> {
      objects.delete(key);
    },
    /** Test helper: keys currently stored. */
    keys(): string[] {
      return [...objects.keys()];
    },
  };
}

/**
 * Minimal stand-in for the `CAMPAIGN_ASSETS` R2 bucket: keeps attachment
 * bytes in a Map with content type and custom metadata (ownership) recorded
 * at put() time, mirroring the subset of the R2 API the email routes use.
 */
function createCampaignAssetStore() {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string; customMetadata: Record<string, string> }>();

  return {
    async put(
      key: string,
      value: Uint8Array,
      options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> },
    ): Promise<void> {
      objects.set(key, {
        bytes: value,
        contentType: options?.httpMetadata?.contentType ?? 'application/octet-stream',
        customMetadata: options?.customMetadata ?? {},
      });
    },
    async get(
      key: string,
    ): Promise<{
      body: Uint8Array;
      httpMetadata: { contentType: string };
      customMetadata: Record<string, string>;
      arrayBuffer(): Promise<ArrayBuffer>;
    } | null> {
      const object = objects.get(key);
      if (!object) return null;
      return {
        body: object.bytes,
        httpMetadata: { contentType: object.contentType },
        customMetadata: object.customMetadata,
        arrayBuffer: async () =>
          object.bytes.buffer.slice(object.bytes.byteOffset, object.bytes.byteOffset + object.bytes.byteLength) as ArrayBuffer,
      };
    },
    async head(
      key: string,
    ): Promise<{ httpMetadata: { contentType: string }; customMetadata: Record<string, string> } | null> {
      const object = objects.get(key);
      if (!object) return null;
      return { httpMetadata: { contentType: object.contentType }, customMetadata: object.customMetadata };
    },
    async delete(key: string): Promise<void> {
      objects.delete(key);
    },
    /** Test helper: keys currently stored. */
    keys(): string[] {
      return [...objects.keys()];
    },
  };
}

export type TestEnv = {
  DB: TestDatabase;
  CAMPAIGN_LOCK: ReturnType<typeof createLockRegistry>;
  WHATSAPP_SENDER: ReturnType<typeof createWhatsAppSenderRegistry>;
  EMAIL_SENDER: ReturnType<typeof createEmailSenderRegistry>;
  WHATSAPP_PACING: ReturnType<typeof createPacingGateRegistry>;
  TOKENS: ReturnType<typeof createTokenStore>;
  PARTNER_LOGOS: ReturnType<typeof createPartnerLogoStore>;
  CAMPAIGN_ASSETS: ReturnType<typeof createCampaignAssetStore>;
  WHATSAPP_TOKEN?: string;
  WHATSAPP_PHONE_ID?: string;
  WHATSAPP_WEBHOOK_VERIFY_TOKEN?: string;
  META_APP_SECRET?: string;
  EMAIL_PROVIDER?: string;
  MAILJET_API_KEY?: string;
  MAILJET_API_SECRET?: string;
  MAILJET_WEBHOOK_TOKEN?: string;
  BREVO_API_KEY?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  BREVO_WEBHOOK_SECRET?: string;
  EMAIL_MARKETING_DAILY_CAP?: string;
  EMAIL_MONTHLY_SOFT_CAP?: string;
  EMAIL_DAILY_LIMIT?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REDIRECT_URI?: string;
  COOKIE_SIGNING_KEY?: string;
  GATEWAY_SECRET?: string;
  APP_ORIGIN?: string;
  TURNSTILE_SECRET_KEY?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_HOSTNAMES?: string;
};

export function createTestEnv(): TestEnv {
  return {
    DB: new TestDatabase(),
    CAMPAIGN_LOCK: createLockRegistry(),
    WHATSAPP_SENDER: createWhatsAppSenderRegistry(),
    EMAIL_SENDER: createEmailSenderRegistry(),
    WHATSAPP_PACING: createPacingGateRegistry(),
    TOKENS: createTokenStore(),
    PARTNER_LOGOS: createPartnerLogoStore(),
    CAMPAIGN_ASSETS: createCampaignAssetStore(),
    WHATSAPP_TOKEN: 'whatsapp-token.test',
    WHATSAPP_PHONE_ID: '111222333444555',
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'webhook-verify.test',
    META_APP_SECRET: 'meta-app-secret.test',
    MAILJET_API_KEY: 'mailjet_test_key',
    MAILJET_API_SECRET: 'mailjet_test_secret',
    EMAIL_PROVIDER: 'mailjet',
    BREVO_API_KEY: 'brevo_test_key',
    EMAIL_FROM: 'no-reply@example.test',
    // Generous so routine tests aren't blocked by the production default (190/day).
    EMAIL_MARKETING_DAILY_CAP: '1000',
    GOOGLE_CLIENT_ID: 'client-id.test',
    GOOGLE_CLIENT_SECRET: 'client-secret',
    GOOGLE_REDIRECT_URI: 'http://localhost/api/auth/google/callback',
    COOKIE_SIGNING_KEY: 'cookie-signing-key.test',
    // Required production config (H1/L1): unsubscribe links and password-reset
    // links fail closed without these, so the test env must provide them.
    GATEWAY_SECRET: 'gateway-secret.test',
    APP_ORIGIN: 'https://app.example.test',
  };
}
