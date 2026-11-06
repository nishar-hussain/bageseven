/** Mocks require an explicit opt-in and are never accepted in production. */
export function worldMocksAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV !== 'production' && env.WORLD_MOCK_PROOFS === 'true';
}

/**
 * Public World IDKit readiness for the login UI.
 * `idkit` is true when app_id + rp_id are set (enough to show the CTA).
 * Signing key stays server-only; challenge endpoint fails closed if missing.
 * Per docs.world.org: never expose WORLD_RP_SIGNING_KEY to the client.
 *
 * Login and mint MUST use different actions — uniqueness nullifiers are one-shot
 * per (human, app, action). Reusing bagseven-mint for login causes nullifier_replayed.
 */
export function worldIdKitConfig(env: NodeJS.ProcessEnv = process.env) {
  const app_id = env.WORLD_APP_ID?.trim() || '';
  const rp_id = env.WORLD_RP_ID?.trim() || '';
  const hasSigningKey = Boolean(env.WORLD_RP_SIGNING_KEY?.trim());
  const mintAction = env.WORLD_IDKIT_ACTION?.trim() || 'bagseven-mint';
  const loginAction = env.WORLD_IDKIT_LOGIN_ACTION?.trim() || 'bagseven-login';
  return {
    app_id,
    rp_id,
    /** Mint / purchase uniqueness action */
    action: mintAction,
    /** Console sign-in uniqueness action (must differ from mint) */
    login_action: loginAction === mintAction ? 'bagseven-login' : loginAction,
    /** Signal bound into login proofs */
    login_signal: env.WORLD_IDKIT_LOGIN_SIGNAL?.trim() || 'bagseven-login',
    environment: (env.WORLD_IDKIT_ENVIRONMENT === 'staging'
      ? 'staging'
      : env.WORLD_IDKIT_ENVIRONMENT === 'sandbox'
        ? 'sandbox'
        : 'production') as 'production' | 'staging' | 'sandbox',
    mock_proofs: worldMocksAllowed(env),
    idkit: Boolean(app_id && rp_id),
    signing_configured: hasSigningKey,
  };
}
