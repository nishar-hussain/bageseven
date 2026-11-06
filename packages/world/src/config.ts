/** Mocks require an explicit opt-in and are never accepted in production. */
export function worldMocksAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV !== 'production' && env.WORLD_MOCK_PROOFS === 'true';
}

export function worldIdKitConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    app_id: env.WORLD_APP_ID?.trim() || '',
    rp_id: env.WORLD_RP_ID?.trim() || '',
    action: env.WORLD_IDKIT_ACTION?.trim() || 'bagseven-mint',
    environment: env.WORLD_IDKIT_ENVIRONMENT === 'staging' ? 'staging' as const : 'production' as const,
    mock_proofs: worldMocksAllowed(env),
    idkit: Boolean(env.WORLD_APP_ID?.trim() && env.WORLD_RP_ID?.trim() && env.WORLD_RP_SIGNING_KEY?.trim()),
  };
}
