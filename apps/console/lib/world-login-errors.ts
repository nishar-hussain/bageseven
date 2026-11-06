export function worldLoginError(code: string, backendError?: string | null): string {
  if (code === 'failed_by_host_app' && backendError) return backendError;
  const messages: Record<string, string> = {
    max_verifications_reached: 'World has reached this action’s verification limit. Repeating the same action will not fix it; the operator must configure returning-user verification.',
    nullifier_replayed: 'World has already verified this identity for this action. The operator must configure returning-user verification.',
    malformed_request: 'World rejected the request configuration. The operator must check the registered app and action.',
    generic_error: 'World App could not complete verification. The failure code has been recorded for diagnosis.',
    invalid_rp_signature: 'World rejected the app signature. The operator must check the registered RP signer.',
    unknown_rp: 'World could not find the app’s RP registration.',
    inactive_rp: 'The app’s World RP registration is inactive.',
    credential_unavailable: 'Your World account does not have the requested Proof of Human credential. Check your verification status in World App.',
    world_id_4_not_available: 'Your account does not have the requested World ID 4.0 credential.',
    world_id_3_not_available: 'Your account does not have the requested legacy World ID credential.',
    invalid_network: 'The World verification environment does not match this app’s registration.',
    rp_signature_expired: 'This QR has expired. Select Continue with World ID to generate a new QR.',
    duplicate_nonce: 'This QR has already been used. Select Continue with World ID to generate a new QR.',
    user_rejected: 'World sign-in was cancelled. You can try again.',
    user_presence_failed: 'World could not complete the presence check. Try again in World App.',
    connection_failed: 'The connection to World was interrupted. Check your connection and try a new QR.',
  };
  return `${messages[code] ?? 'World could not complete sign-in. Share the following error code with the operator.'} (${code})`;
}
