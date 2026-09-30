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

export const campaignConfigSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000),
  googleMapsName: z.string().trim().max(250),
  googleMapsUrl: optionalUrl,
  googlePlaceId: z.string().trim().max(255),
  facebookUrl: optionalUrl,
  instagramUrl: optionalUrl,
  action: z.enum(['google-review', 'instagram', 'facebook', 'newsletter', 'purchase', 'none']),
});
