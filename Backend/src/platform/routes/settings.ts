import { errorResponse, jsonResponse } from '../../lib/http';
import { platformFeatureSchema } from '../../lib/validation';
import { getPlatformFeatures, setPlatformFeature } from '../../lib/feature-access';
import { writeAuditLog } from '../../lib/tenant';
import { renderRouteError, requireOperator } from '../lib/guard';
import type { Env } from '../../types';

/**
 * Platform-wide switches for WhatsApp / email marketing. Toggling one applies
 * the value to every merchant immediately (master row + all business rows),
 * so the per-account switches stay in sync. A single account can still be
 * overridden afterwards from the accounts page — its own switch wins.
 */
async function getFeatures(request: Request, env: Env): Promise<Response> {
  await requireOperator(request, env);
  const features = await getPlatformFeatures(env);
  return jsonResponse({ success: true, features });
}

async function updateFeatures(request: Request, env: Env): Promise<Response> {
  const operator = await requireOperator(request, env);
  const input = platformFeatureSchema.parse(await request.json());

  if (input.whatsappEnabled !== undefined) {
    await setPlatformFeature(env, 'whatsapp', input.whatsappEnabled);
  }
  if (input.emailEnabled !== undefined) {
    await setPlatformFeature(env, 'email', input.emailEnabled);
  }
  if (input.wheelDesignEnabled !== undefined) {
    await setPlatformFeature(env, 'wheel', input.wheelDesignEnabled);
  }
  if (input.rewardsEnabled !== undefined) {
    await setPlatformFeature(env, 'rewards', input.rewardsEnabled);
  }

  await writeAuditLog(env, {
    businessId: null,
    userId: null,
    platformOperatorId: operator.id,
    action: 'ADMIN_PLATFORM_FEATURES_UPDATED',
    entityType: 'platform_setting',
    entityId: 'features',
    metadata: { ...input },
  });

  const features = await getPlatformFeatures(env);
  return jsonResponse({ success: true, features });
}

export async function handlePlatformFeaturesRoute(request: Request, env: Env): Promise<Response> {
  try {
    if (request.method === 'GET') return await getFeatures(request, env);
    if (request.method === 'POST') return await updateFeatures(request, env);
    return errorResponse('Method not allowed.', 405);
  } catch (error) {
    return renderRouteError(error, 'Platform features route failed.');
  }
}
