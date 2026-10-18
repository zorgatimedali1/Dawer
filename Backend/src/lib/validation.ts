import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8).max(128),
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().min(1).max(60),
  businessName: z.string().trim().min(2).max(120).optional(),
});

export const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8).max(128),
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().email(),
});

export const resetPasswordSchema = z.object({
  token: z.string().trim().min(1).max(200),
  password: z.string().min(8).max(128),
});

export const googleCallbackSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

const deviceHashField = z
  .string()
  .trim()
  .regex(/^[0-9a-f]{16,64}$/i, 'Invalid device hash.')
  .optional();

export const participationSchema = z.object({
  firstName: z.string().trim().min(1).max(60).optional(),
  lastName: z.string().trim().min(1).max(60).optional(),
  email: z.string().trim().email().optional(),
  phone: z.string().trim().min(6).max(30).optional(),
  marketingConsent: z.boolean().optional().default(false),
  anonymousId: z
    .string()
    .trim()
    .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'Invalid anonymous id.')
    .optional(),
  deviceHash: deviceHashField,
  /** Optional reported position for the P2-7 proximity signal (soft). */
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  /** Cloudflare Turnstile token (M7). Only required when the operator has
   *  enabled Turnstile; otherwise ignored. */
  turnstileToken: z.string().trim().min(1).max(2048).optional(),
});

export const ACTION_CLAIM_KINDS = [
  'GOOGLE_REVIEW',
  'INSTAGRAM',
  'FACEBOOK',
] as const;

export const actionClaimSchema = z.object({
  anonymousId: z
    .string()
    .trim()
    .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'Invalid anonymous id.'),
  action: z.enum(ACTION_CLAIM_KINDS),
  deviceHash: deviceHashField,
  /** Signed ticket minted by the campaign GET; required when the gate is on. */
  actionTicket: z.string().trim().min(1).max(512).optional(),
  /**
   * Cloudflare Turnstile token minted by the gate widget (`action: "action"`).
   * The signed ticket alone only proves the page was open ≥3s — a farm can
   * sleep that out. A Turnstile token proves a human cleared a challenge on
   * this page, so the action claim cannot be replayed by a script.
   */
  turnstileToken: z.string().trim().min(1).max(2048).optional(),
});

/**
 * Per-campaign play rules. `NULL` (no rules) keeps the historic behaviour:
 * one spin per visitor, forever. Rolling 24-hour windows keep the semantics
 * timezone-free.
 */
export const playRulesSchema = z.object({
  mode: z.enum(['once', 'windowed']),
  perDay: z.number().int().min(1).max(20).default(1),
  cooldownMinutes: z.number().int().min(0).max(10080).default(0),
  /** 0 disables the per-IP cap. */
  maxPlaysPerIpDay: z.number().int().min(0).max(1000).default(0),
  /** Wins allowed per rolling 24 h per identity; 0 disables the budget. */
  winBudget: z.number().int().min(0).max(100).default(1),
});

export type PlayRules = z.infer<typeof playRulesSchema>;

/** Accepts the raw TEXT column (JSON string), a parsed object, or null. */
export function parsePlayRules(raw: unknown): PlayRules | null {
  let value = raw;

  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }

  if (!value || typeof value !== 'object') return null;

  const parsed = playRulesSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export const customerDetailsSchema = z.object({
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().max(60).optional().default(''),
  email: z.union([z.string().trim().email(), z.literal('')]).optional().default(''),
  phone: z.string().trim().min(6).max(30),
  marketingConsent: z.boolean().optional().default(false),
});

export const couponUpdateSchema = z
  .object({
    status: z.enum(['ISSUED', 'REDEEMED']).optional(),
    // `null` explicitly clears the deadline; omitted leaves it untouched.
    expiresAt: z.union([z.string().datetime(), z.null()]).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Provide a status or expiry date.');

const optionalUrl = z
  .string()
  .trim()
  .max(2048)
  .refine(
    (value) => {
      if (value === '') return true;
      // M4: only http(s) links are accepted — a `javascript:` (or `data:`,
      // `vbscript:`, etc.) URL rendered as an <a href> on a public page is a
      // stored-XSS vector.
      if (!URL.canParse(value)) return false;
      const { protocol } = new URL(value);
      return protocol === 'http:' || protocol === 'https:';
    },
    'Enter a valid http(s) URL.',
  );

export const campaignStatusSchema = z.enum([
  'DRAFT',
  'SCHEDULED',
  'ACTIVE',
  'PAUSED',
  'COMPLETED',
  'ARCHIVED',
]);

export const rewardTypeSchema = z.enum([
  'percentage_discount',
  'fixed_discount',
  'free_product',
  'free_service',
  'custom_reward',
  'none',
]);

export const rewardInputSchema = z.object({
  id: z.string().trim().min(1).max(64).optional(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).default(''),
  type: rewardTypeSchema.default('custom_reward'),
  value: z.number().finite().min(0).max(1_000_000).default(0),
  weight: z.number().int().min(0).max(1_000_000),
  quantity: z.number().int().min(0).max(1_000_000).optional(),
  active: z.boolean().default(true),
});

export type RewardInput = z.infer<typeof rewardInputSchema>;

const isoDateTime = z
  .string()
  .trim()
  .refine((value) => value === '' || !Number.isNaN(Date.parse(value)), 'Enter a valid date.');

export const campaignConfigSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000),
  googleMapsName: z.string().trim().max(250),
  googleMapsUrl: optionalUrl,
  googlePlaceId: z.string().trim().max(255),
  facebookUrl: optionalUrl,
  instagramUrl: optionalUrl,
  action: z.enum(['google-review', 'instagram', 'facebook', 'newsletter', 'purchase', 'none']),
  campaignId: z.string().trim().min(1).max(64).optional(),
  status: campaignStatusSchema.optional(),
  startAt: isoDateTime.optional(),
  endAt: isoDateTime.optional(),
  rewards: z.array(rewardInputSchema).max(20).optional(),
  playRules: playRulesSchema.optional(),
  /** Optional hard geofence radius in metres. When set (and the campaign has
   * resolved coordinates), spins farther than this from the venue are rejected
   * server-side. NULL/omitted keeps the historic advisory-only proximity. */
  radiusMeters: z.number().int().min(50).max(5000).nullable().optional(),
});

export const campaignCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1000).default(''),
    status: campaignStatusSchema.default('DRAFT'),
    startAt: isoDateTime.default(''),
    endAt: isoDateTime.default(''),
  })
  .refine((input) => !input.startAt || !input.endAt || Date.parse(input.endAt) >= Date.parse(input.startAt), {
    message: 'End date must be on or after the start date.',
    path: ['endAt'],
  });

export const businessCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
});

export const campaignUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1000),
    status: campaignStatusSchema,
    startAt: isoDateTime,
    endAt: isoDateTime,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update.')
  .refine((value) => (
    !value.startAt || !value.endAt || Date.parse(value.endAt) >= Date.parse(value.startAt)
  ), {
    message: 'End date must be on or after the start date.',
    path: ['endAt'],
  });

export const campaignListQuerySchema = z.object({
  status: z.string().trim().max(200).optional(),
  search: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

const pageQuery = {
  search: z.string().trim().max(120).optional(),
  campaignId: z.string().trim().max(64).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};

export const customerListQuerySchema = z.object(pageQuery);

export const couponListQuerySchema = z
  .object({
    status: z.enum(['ISSUED', 'REDEEMED', 'EXPIRED', 'ALL']).default('ALL'),
  })
  .extend(pageQuery);

export const rewardPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500),
    active: z.boolean(),
    quantity: z.number().int().min(0).max(1_000_000),
    weight: z.number().int().min(0).max(1_000_000),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update.');

export const qrCodeCreateSchema = z.object({
  campaignId: z.string().trim().min(1).max(64),
  name: z.string().trim().max(120).default(''),
  location: z.string().trim().max(120).default(''),
});

export const qrCodePatchSchema = z
  .object({
    name: z.string().trim().max(120),
    location: z.string().trim().max(120),
    active: z.boolean(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update.');

export type CouponListQuery = z.infer<typeof couponListQuerySchema>;

export const profileUpdateSchema = z
  .object({
    firstName: z.string().trim().min(1).max(60),
    lastName: z.string().trim().min(1).max(60),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update.');

export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(8).max(128),
  newPassword: z.string().min(8).max(128),
});

const hexColor = z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Enter a hex color such as #4f46e5.');

export const businessSettingsSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000),
  website: optionalUrl,
  phone: z.string().trim().max(30),
  email: z.union([z.string().trim().email(), z.literal('')]),
  address: z.string().trim().max(250),
  timezone: z.string().trim().max(60),
  googleMapsName: z.string().trim().max(250),
  googleMapsUrl: optionalUrl,
  googlePlaceId: z.string().trim().max(255),
  facebookUrl: optionalUrl,
  instagramUrl: optionalUrl,
 twitterUrl: optionalUrl,
 linkedinUrl: optionalUrl,
 tiktokUrl: optionalUrl,
 youtubeUrl: optionalUrl,
  // L6: the logo is rendered as an <img src> on public pages. Allow only an
  // http(s) URL, an inline data:image, or empty — never an arbitrary scheme.
  logo: z
    .string()
    .trim()
    .max(2048)
    .refine(
      (value) => {
        if (value === '') return true;
        if (value.startsWith('data:image/')) return true;
        if (!URL.canParse(value)) return false;
        const { protocol } = new URL(value);
        return protocol === 'http:' || protocol === 'https:';
      },
      'Enter a valid image URL.',
    ),
  primaryColor: hexColor,
  secondaryColor: hexColor,
  notifications: z.object({
    email: z.boolean(),
    sms: z.boolean(),
    push: z.boolean(),
  }),
});

/**
 * Slug shape for pricing plans: the operator can create plans from the
 * console, so the four legacy slugs are no longer a closed set.
 */
export const planSlugSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9-]{1,29}$/, 'Invalid plan slug');

export const changePlanSchema = z.object({
  planSlug: planSlugSchema,
});

export type ChangePlan = z.infer<typeof changePlanSchema>;

/** A merchant asks the owner to start a plan; there is no online payment here. */
export const subscribeRequestSchema = z.object({
  planSlug: planSlugSchema,
});

export type SubscribeRequest = z.infer<typeof subscribeRequestSchema>;

export const PLAN_INTERVALS = ['3_months', 'year', '2_years', '3_years'] as const;

/** The numerical criteria an operator can tune per plan. */
const planLimitsSchema = z.object({
  campaigns: z.number().int().min(-1).max(1_000_000),
  customers: z.number().int().min(-1).max(100_000_000),
  whatsappMonthly: z.number().int().min(0).max(1_000_000),
  whatsappBatch: z.number().int().min(0).max(1_000_000),
  emailMonthly: z.number().int().min(0).max(1_000_000),
  emailBatch: z.number().int().min(0).max(1_000_000),
  /** Wheel design (colors/motion) as a 0/1 flag. */
  wheelDesign: z.number().int().min(0).max(1).optional(),
  /** Merchant logo at the wheel hub as a 0/1 flag. */
  wheelCenterLogo: z.number().int().min(0).max(1).optional(),
  /** Gate step colour (badges + CTA buttons) as a 0/1 flag. */
  wheelStepsColor: z.number().int().min(0).max(1).optional(),
});

/** The criteria blob stored in plans.features (limits + bullet features). */
export const planCriteriaSchema = z.object({
  limits: planLimitsSchema,
  features: z.array(z.string().trim().min(1).max(140)).max(20),
});

export type PlanCriteria = z.infer<typeof planCriteriaSchema>;

/** Full payload to create a plan from the operator console. */
export const planUpsertSchema = z.object({
  name: z.string().trim().min(1).max(60),
  slug: planSlugSchema,
  priceCents: z.number().int().min(0).max(100_000_000),
  interval: z.enum(PLAN_INTERVALS),
  active: z.boolean().optional(),
  features: planCriteriaSchema,
});

export type PlanUpsert = z.infer<typeof planUpsertSchema>;

/** Fields an operator may patch on an existing plan. */
export const planUpdateSchema = planUpsertSchema.partial();

export type PlanUpdate = z.infer<typeof planUpdateSchema>;

/** The operator only offers whole-month presets. */
export const APPROVE_DURATION_DAYS = [30, 90, 180, 365, 730, 1095] as const;

export const approveSubscriptionSchema = z.object({
  durationDays: z.union([
    z.literal(APPROVE_DURATION_DAYS[0]),
    z.literal(APPROVE_DURATION_DAYS[1]),
    z.literal(APPROVE_DURATION_DAYS[2]),
    z.literal(APPROVE_DURATION_DAYS[3]),
    z.literal(APPROVE_DURATION_DAYS[4]),
    z.literal(APPROVE_DURATION_DAYS[5]),
  ]),
});

export type ApproveSubscription = z.infer<typeof approveSubscriptionSchema>;

export const SUBSCRIPTION_REQUEST_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;

export const subscriptionRequestListQuerySchema = z.object({
  search: z.string().trim().max(255).default(''),
  status: z.enum(SUBSCRIPTION_REQUEST_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type SubscriptionRequestListQuery = z.infer<typeof subscriptionRequestListQuerySchema>;

export const adminAccountListQuerySchema = z.object({
  search: z.string().trim().max(255).default(''),
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type AdminAccountListQuery = z.infer<typeof adminAccountListQuerySchema>;

/** Suspend needs a reason so the audit trail explains the action. */
export const adminSuspendSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

export type AdminSuspend = z.infer<typeof adminSuspendSchema>;

/** Deletion is irreversible, so it carries the same auditable reason. */
export const adminDeleteSchema = adminSuspendSchema;

export type AdminDelete = z.infer<typeof adminDeleteSchema>;

/**
 * Platform-operator play policy for a merchant account. `off` clears the
 * override; the stored JSON only ever carries the frequency fields — win
 * budget and per-IP cap stay with the campaign itself.
 */
export const adminPlayPolicySchema = z.object({
  mode: z.enum(['off', 'once', 'windowed']),
  perDay: z.number().int().min(1).max(20).default(1),
  cooldownMinutes: z.number().int().min(0).max(10080).default(0),
});

export type AdminPlayPolicy = z.infer<typeof adminPlayPolicySchema>;

/**
 * Per-account marketing feature switches. At least one flag must be present.
 * `reason` is optional — when present it ties the change to the operator in
 * the audit trail; the console toggles fire without one.
 */
export const adminFeatureAccessSchema = z
  .object({
    whatsappEnabled: z.boolean().optional(),
    emailEnabled: z.boolean().optional(),
    wheelDesignEnabled: z.boolean().optional(),
    reason: z.string().trim().min(3).max(500).optional(),
  })
  .refine(
    (value) =>
      value.whatsappEnabled !== undefined ||
      value.emailEnabled !== undefined ||
      value.wheelDesignEnabled !== undefined,
    {
      message: 'Provide whatsappEnabled, emailEnabled and/or wheelDesignEnabled.',
    },
  );

export type AdminFeatureAccess = z.infer<typeof adminFeatureAccessSchema>;

/** Platform-wide master switches; partial updates only. */
export const platformFeatureSchema = z
  .object({
    whatsappEnabled: z.boolean().optional(),
    emailEnabled: z.boolean().optional(),
    wheelDesignEnabled: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.whatsappEnabled !== undefined ||
      value.emailEnabled !== undefined ||
      value.wheelDesignEnabled !== undefined,
    {
      message: 'Provide whatsappEnabled, emailEnabled and/or wheelDesignEnabled.',
    },
  );

export type PlatformFeatureUpdate = z.infer<typeof platformFeatureSchema>;

type StoredAccountPolicy = { mode: 'once' } | { mode: 'windowed'; perDay: number; cooldownMinutes: number };

/** Accepts the raw TEXT column (JSON string) or an already-parsed object. */
function parseAccountPolicy(raw: unknown): StoredAccountPolicy | null {
  let value = raw;

  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }

  if (!value || typeof value !== 'object') return null;

  const policy = value as { mode?: unknown; perDay?: unknown; cooldownMinutes?: unknown };
  if (policy.mode === 'once') return { mode: 'once' };
  if (policy.mode !== 'windowed') return null;

  const perDay = Number(policy.perDay);
  const cooldownMinutes = Number(policy.cooldownMinutes);

  return {
    mode: 'windowed',
    perDay: Number.isFinite(perDay) && perDay >= 1 ? Math.min(20, Math.trunc(perDay)) : 1,
    cooldownMinutes:
      Number.isFinite(cooldownMinutes) && cooldownMinutes >= 0
        ? Math.min(10080, Math.trunc(cooldownMinutes))
        : 0,
  };
}

/** Stored column → the API/UI shape; an absent or unknown value reads as `off`. */
export function describeStoredPlayPolicy(raw: unknown): AdminPlayPolicy {
  const policy = parseAccountPolicy(raw);

  if (!policy) return { mode: 'off', perDay: 1, cooldownMinutes: 0 };
  if (policy.mode === 'once') return { mode: 'once', perDay: 1, cooldownMinutes: 0 };
  return { mode: 'windowed', perDay: policy.perDay, cooldownMinutes: policy.cooldownMinutes };
}

/** API/UI shape → the column value (`null` clears the override). */
export function playPolicyToStorage(policy: AdminPlayPolicy): string | null {
  if (policy.mode === 'off') return null;
  if (policy.mode === 'once') return JSON.stringify({ mode: 'once' });
  return JSON.stringify({ mode: 'windowed', perDay: policy.perDay, cooldownMinutes: policy.cooldownMinutes });
}

/**
 * Folds the operator's account policy over the campaign's own play rules.
 * Frequency (mode, per-day, cooldown) always comes from the operator — the
 * operator wins. Win budget and per-IP cap are inherited only when the
 * merchant actually configured windowed play; a `once` campaign carries no
 * meaningful values there, so operator-enabled repeat play starts unlimited.
 */
export function applyAccountPlayPolicy(
  campaignRules: PlayRules | null,
  storedPolicy: unknown,
): PlayRules | null {
  const policy = parseAccountPolicy(storedPolicy);
  if (!policy) return campaignRules;

  const base: PlayRules =
    campaignRules?.mode === 'windowed'
      ? campaignRules
      : { mode: 'once', perDay: 1, cooldownMinutes: 0, maxPlaysPerIpDay: 0, winBudget: 0 };

  return { ...base, ...policy };
}

export const posterCreateSchema = z.object({
  campaignId: z.string().trim().min(1).max(64),
  template: z.string().trim().min(1).max(60).default('gradient'),
  title: z.string().trim().max(140).default(''),
  subtitle: z.string().trim().max(240).default(''),
  theme: z.string().trim().max(60).default('#4f46e5'),
  configuration: z.record(z.unknown()).optional(),
});

export const posterPatchSchema = z
  .object({
    template: z.string().trim().min(1).max(60),
    title: z.string().trim().max(140),
    subtitle: z.string().trim().max(240),
    theme: z.string().trim().max(60),
    configuration: z.record(z.unknown()),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update.');

export const LOGO_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  // L3: image/svg+xml is intentionally NOT allowed. SVG can embed <script> and
  // event handlers, and these logos are stored in D1 and re-served with the
  // client-declared content type on the app origin — a stored-XSS vector that
  // only the API-wide CSP currently blunts. Raster formats only.
] as const;

export const MAX_LOGO_BYTES = 512 * 1024;

export const logoUploadSchema = z.object({
  mimeType: z.enum(LOGO_MIME_TYPES),
  dataBase64: z
    .string()
    .min(1)
    .refine((value) => Math.ceil((value.length * 3) / 4) <= MAX_LOGO_BYTES, {
      message: 'The logo must be 512 KB or smaller.',
    }),
});

/** A landing-page partner: display name plus the logo bytes to store in R2. */
export const partnerCreateSchema = z.object({
  name: z.string().trim().min(1, 'Enter a partner name.').max(80, 'The partner name is too long.'),
  mimeType: z.enum(LOGO_MIME_TYPES),
  dataBase64: z
    .string()
    .min(1)
    .refine((value) => Math.ceil((value.length * 3) / 4) <= MAX_LOGO_BYTES, {
      message: 'The logo must be 512 KB or smaller.',
    }),
});

const wheelHexColor = z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Enter a hex color such as #4f46e5.');

/** Spin speed presets: each pairs a duration with its easing curve. */
export const WHEEL_MOTION_PRESETS = ['fast', 'standard', 'slow'] as const;

export const wheelThemeSchema = z.object({
  colors: z.object({
    segments: z.array(wheelHexColor).min(1).max(8),
    rim: wheelHexColor,
    pointer: wheelHexColor,
  }),
  motion: z.object({
    preset: z.enum(WHEEL_MOTION_PRESETS),
  }),
  centerLogo: z.boolean(),
  /**
   * Brand colour for the gate step badges + CTA buttons on the public page.
   * `.default()` keeps themes stored before this field parseable, so old rows
   * resolve to the default instead of being dropped.
   */
  stepsColor: wheelHexColor.default('#7DAB4B'),
});

export type WheelTheme = z.infer<typeof wheelThemeSchema>;

/** The design every wheel falls back to: the palette ships in the SPA today. */
export const DEFAULT_WHEEL_THEME: WheelTheme = {
  colors: {
    segments: ['#f59e0b', '#a78bfa', '#34d399', '#60a5fa', '#fb7185', '#cbd5e1', '#facc15', '#2dd4bf'],
    rim: '#ffffff',
    pointer: '#0f172a',
  },
  motion: { preset: 'standard' },
  centerLogo: false,
  stepsColor: '#7DAB4B',
};

/**
 * Plan-tier flags that decide what a merchant may touch on the wheel live in
 * `subscription-limits.ts` (`wheelDesignAllowed` / `wheelCenterLogoAllowed`),
 * where the operator's per-plan criteria are resolved. The resolver below
 * takes the outcome as plain booleans so this module stays plan-agnostic.
 */

/** Tolerant read of a TEXT column (JSON string or parsed object) → a full theme. */
export function parseWheelTheme(raw: unknown): WheelTheme | null {
  let value = raw;

  if (typeof value === 'string') {
    if (!value.trim()) return null;
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }

  const parsed = wheelThemeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * Effective theme for a wheel: the operator's override always wins over the
 * merchant's own design for colors and motion. Without the plan's design flag
 * (Starter, Pro, or a plan the operator locked) those stay pinned to the
 * default even when an override exists — same operator-wins shape as
 * applyAccountPlayPolicy. The hub logo is the merchant's own brand asset, so
 * their toggle wins over the override whenever the plan includes it; the
 * override's flag only applies as a default for accounts that never saved a
 * theme of their own.
 */
export function resolveWheelTheme(options: {
  merchantTheme: unknown;
  overrideTheme: unknown;
  designAllowed: boolean;
  centerLogoAllowed: boolean;
  stepsColorAllowed: boolean;
}): WheelTheme {
  const override = parseWheelTheme(options.overrideTheme);
  const merchant = parseWheelTheme(options.merchantTheme);

  const base = options.designAllowed ? override ?? merchant ?? DEFAULT_WHEEL_THEME : DEFAULT_WHEEL_THEME;
  const withLogo = options.centerLogoAllowed
    ? { ...base, centerLogo: (merchant ?? override)?.centerLogo ?? false }
    : { ...base, centerLogo: false };
  // The gate step colour is the merchant's own brand asset (like the hub logo):
  // their value wins over the operator override whenever the plan includes it.
  return options.stepsColorAllowed
    ? { ...withLogo, stepsColor: (merchant ?? override)?.stepsColor ?? DEFAULT_WHEEL_THEME.stepsColor }
    : { ...withLogo, stepsColor: DEFAULT_WHEEL_THEME.stepsColor };
}

/** Serializes a theme for its column; `null` clears the merchant design. */
export function wheelThemeToStorage(theme: WheelTheme | null): string | null {
  return theme ? JSON.stringify(theme) : null;
}

/** Operator console payload: clear the override and/or set a new one. */
export const adminWheelThemeSchema = z
  .object({
    theme: wheelThemeSchema.optional(),
    clear: z.boolean().optional(),
  })
  .refine((value) => value.clear === true || value.theme !== undefined, {
    message: 'Provide theme or clear.',
  })
  .refine((value) => !(value.clear === true && value.theme !== undefined), {
    message: 'Provide either theme or clear, not both.',
  });

export type AdminWheelThemeUpdate = z.infer<typeof adminWheelThemeSchema>;

export const whatsappRecipientSchema = z.object({
  name: z.string().trim().max(120).optional(),
  phone: z.string().trim().min(3).max(32),
});

export const whatsappBroadcastSchema = z.object({
  recipients: z.array(whatsappRecipientSchema).min(1).max(1000),
  templateName: z
    .string()
    .trim()
    .regex(/^[a-z0-9_]{1,64}$/, 'Template names use lowercase letters, digits and underscores.'),
  language: z.enum(['fr', 'en']).default('fr'),
  variables: z.array(z.string().max(1024)).max(10).default([]),
  pace: z.enum(['fast', 'standard', 'relaxed']).default('standard'),
});

export type WhatsAppBroadcastInput = z.infer<typeof whatsappBroadcastSchema>;

export const whatsappWebRecipientSchema = z.object({
  name: z.string().trim().max(120).optional(),
  phone: z.string().trim().min(3).max(32),
  prize: z.string().trim().max(160).optional(),
});

export const whatsappWebBroadcastSchema = z.object({
  recipients: z.array(whatsappWebRecipientSchema).min(1).max(500),
  message: z.string().trim().min(1).max(1000).optional(),
});

export type WhatsAppWebBroadcastInput = z.infer<typeof whatsappWebBroadcastSchema>;

export const emailRecipientSchema = z.object({
  email: z.string().trim().email().max(254),
  name: z.string().trim().max(120).optional(),
});

/** Attachment types the email provider accepts and mail clients render (no webp/svg). */
export const EMAIL_ASSET_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'application/pdf',
] as const;

export const MAX_EMAIL_ASSET_BYTES = 8 * 1024 * 1024;

export const emailAssetUploadSchema = z.object({
  name: z.string().trim().min(1).max(160),
  mimeType: z.enum(EMAIL_ASSET_MIME_TYPES),
  dataBase64: z
    .string()
    .min(1)
    .refine((value) => Math.ceil((value.length * 3) / 4) <= MAX_EMAIL_ASSET_BYTES, {
      message: 'The attachment must be 8 MB or smaller.',
    }),
});

/** Broadcast reference to an already-uploaded asset; name/mime come from R2. */
export const emailAssetRefSchema = z.object({
  id: z.string().uuid(),
});

export const emailBroadcastSchema = z
  .object({
    senderName: z.string().trim().min(1).max(80),
    subject: z.string().trim().min(1).max(200),
    content: z.string().trim().max(50_000).default(''),
    link: z.string().trim().max(2048).optional(),
    asset: emailAssetRefSchema.optional(),
    recipients: z.array(emailRecipientSchema).min(1).max(1000),
  })
  .superRefine((value, ctx) => {
    if (!value.content && !value.asset) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['content'],
        message: 'Message text or an attachment is required.',
      });
    }
  });

export type EmailBroadcastInput = z.infer<typeof emailBroadcastSchema>;
