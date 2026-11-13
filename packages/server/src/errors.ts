import type { ZodError } from 'zod';
import { randomUUID } from 'node:crypto';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (isZodError(err)) {
    return new ApiError(400, 'VALIDATION_ERROR', 'invalid request body', err.flatten().fieldErrors);
  }
  const code = (err as { code?: string })?.code ?? 'INTERNAL_ERROR';
  if (code === 'ERR_INVALID_MONEY') {
    return new ApiError(400, 'INVALID_AMOUNT', (err as Error).message);
  }
  const message = err instanceof Error ? err.message : 'internal error';
  if (/^(SUBSCRIPTION_[A-Z_]+|RECONCILIATION_REQUIRED|PAYMENT_PENDING|CHECKOUT_EXPIRED):?/.test(message)) {
    const domainCode = message.split(':')[0]!;
    const status = domainCode === 'SUBSCRIPTION_GAS_AUTHORIZATION_REQUIRED' || domainCode === 'SUBSCRIPTIONS_UNAVAILABLE' ? 503
      : domainCode.includes('MISMATCH') || domainCode.includes('UNVERIFIED') ? 403 : 409;
    return new ApiError(status, domainCode, message);
  }
  if (/^PROVIDER_GAS_[A-Z_]+/.test(message)) {
    const providerCode = message.split(':')[0]!;
    return new ApiError(providerCode.includes('SIGNATURE') || providerCode.includes('FORBIDDEN') ? 403 : providerCode.includes('UNCONFIGURED') ? 503 : 409, providerCode, message);
  }
  return new ApiError(500, 'INTERNAL_ERROR', 'An internal error occurred');
}

function isZodError(err: unknown): err is ZodError {
  return typeof err === 'object' && err !== null && 'flatten' in err && (err as { name?: string }).name === 'ZodError';
}

export function errorResponse(err: unknown): { status: number; body: unknown } {
  const api = toApiError(err);
  return {
    status: api.status,
    body: {
      error: {
        code: api.code,
        message: api.message,
        ...(api.details !== undefined ? { details: api.details } : {}),
        request_id: randomUUID(),
      },
    },
  };
}
