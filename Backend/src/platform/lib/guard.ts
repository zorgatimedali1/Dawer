import { z } from 'zod';
import { errorResponse } from '../../lib/http';
import { getOperator, type Operator } from './auth';
import type { Env } from '../../types';

export class AdminError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'AdminError';
    this.status = status;
    this.details = details;
  }
}

/**
 * The console reads the whole user table, so it deliberately bypasses
 * getBusinessIds: an operator is not a tenant. Ownership is checked by requiring
 * a live operator session on the caller instead of a flag on the merchant row.
 */
export async function requireOperator(request: Request, env: Env): Promise<Operator> {
  const operator = await getOperator(request, env);

  if (!operator) {
    throw new AdminError('Authentication required.', 401);
  }

  return operator;
}

/** Shared catch block for the operator console route modules. */
export function renderRouteError(error: unknown, label: string): Response {
  if (error instanceof AdminError) {
    return errorResponse(error.message, error.status, error.details);
  }

  if (error instanceof z.ZodError) {
    return errorResponse('Validation failed.', 400, error.flatten());
  }

  console.error(label, error);
  return errorResponse('Unable to process the request.', 500);
}
