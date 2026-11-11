/** Pure startup validation. Error messages contain field names, never secret values. */
export function assertLocalConfiguration(env) {
  const problems = [];
  const network = env.AVALANCHE_NETWORK || 'fuji';
  if (!['fuji', 'mainnet'].includes(network)) problems.push('AVALANCHE_NETWORK must be fuji or mainnet');
  const expected = network === 'mainnet' ? 43114 : 43113;
  for (const name of ['CHAIN_ID', 'AVALANCHE_CHAIN_ID']) {
    if (env[name] && Number(env[name]) !== expected) problems.push(`${name} must match the selected Avalanche network (${expected})`);
  }
  const mode = env.ENTITLEMENT_STORE || 'avalanche';
  if (!['avalanche', 'memory'].includes(mode)) problems.push('ENTITLEMENT_STORE must be avalanche');
  if (mode === 'memory' && env.NODE_ENV === 'production') problems.push('Production requires ENTITLEMENT_STORE=avalanche');
  const address = value => /^0x[\da-f]{40}$/i.test(value || '') && !/^0x0{40}$/i.test(value);
  if (mode === 'avalanche') {
    if (!address(env.AVALANCHE_ENTITLEMENT_REGISTRY)) problems.push('AVALANCHE_ENTITLEMENT_REGISTRY must name a deployed contract on the selected chain');
    if (!env.ENTITLEMENT_SUBJECT_SECRET || env.ENTITLEMENT_SUBJECT_SECRET.length < 32) problems.push('ENTITLEMENT_SUBJECT_SECRET must be a persistent private secret of at least 32 characters');
  }
  if (!address(env.AVALANCHE_USDC)) problems.push('AVALANCHE_USDC must name the explicitly selected payment token');
  const endpoint = value => { try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; } };
  if (!endpoint(env.AVALANCHE_RPC_URL || env.RPC_URL)) problems.push('AVALANCHE_RPC_URL must be configured');
  if (problems.length) throw Error(`Startup configuration is incomplete:\n- ${problems.join('\n- ')}\nNo services were started. Update the deployment configuration; do not substitute memory grants for missing live contracts.`);
}
