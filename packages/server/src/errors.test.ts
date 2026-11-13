import { expect, it } from 'vitest';
import { ApiError, errorResponse } from './errors.js';
it('does not expose unexpected backend error details in HTTP responses', () => {
  const response = errorResponse(new Error('database query failed: key=fake-test-secret'));
  expect(response.status).toBe(500);
  expect(JSON.stringify(response.body)).not.toContain('fake-test-secret');
  expect(response.body).toMatchObject({ error: { code: 'INTERNAL_ERROR', message: 'An internal error occurred' } });
});
it('preserves intentionally public validation and authorization errors', () => {
  const response = errorResponse(new ApiError(401, 'UNAUTHORIZED', 'Invalid or revoked API key'));
  expect(response.status).toBe(401);
  expect(response.body).toMatchObject({ error: { message: 'Invalid or revoked API key' } });
});
