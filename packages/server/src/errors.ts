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
  return new ApiError(500, 'INTERNAL_ERROR', message);
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