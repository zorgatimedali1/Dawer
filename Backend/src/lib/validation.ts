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

export const googleCallbackSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

export const participationSchema = z.object({
  firstName: z.string().trim().min(1).max(60).optional(),
  lastName: z.string().trim().min(1).max(60).optional(),
  email: z.string().trim().email().optional(),
  phone: z.string().trim().min(6).max(30).optional(),
  marketingConsent: z.boolean().optional().default(false),
});

const optionalUrl = z.string().trim().max(2048).refine(
  (value) => value === '' || URL.canParse(value),
  'Enter a valid URL.',
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
  rewards: z.array(rewardInputSchema).min(1).max(20).optional(),
});

export const campaignCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).default(''),
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
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update.');

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
  logo: z.string().trim().max(2048),
  primaryColor: hexColor,
  secondaryColor: hexColor,
  notifications: z.object({
    email: z.boolean(),
    sms: z.boolean(),
    push: z.boolean(),
  }),
});

export const changePlanSchema = z.object({
  planSlug: z.enum(['starter', 'growth', 'scale']),
});
