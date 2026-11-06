# World login: phone approval failure

The phone/bridge returned `nullifier_replayed` before any proof reached `/api/auth/world`. The earlier successful verification had exhausted the one-time `bagseven-login` action. Generating another nonce for the same uniqueness action could not solve that rejection.

Console login now uses `IDKitSessionWidget` with `CredentialRequest('proof_of_human')`. First sign-in creates a World session; later sign-ins prove that saved session using an action-free RP signature and a fresh browser-bound nonce. The complete result is verified by World's RP verification API before an application session is issued. Session identity is the verified `session_id`; per-proof session nullifiers are never used as account identifiers. A replay error never becomes successful authentication.

The session identifier is remembered for 90 days in a signed HttpOnly cookie. That cookie cannot authenticate by itself: a fresh accepted World proof is always required. A returning proof must match the saved session, and a challenge can be consumed only once. Diagnostics record only an error code and stage, without proofs or personal information.

This is a World ID 4.0 flow; legacy uniqueness proofs remain available for one-time operations rather than being reused as returning-user authentication. Mint and payment logic are unchanged. Existing legacy-nullifier accounts are not silently merged with new World-session accounts. Clearing the continuity cookie or using another browser requires explicit account recovery/linking to retain the same account; cross-browser recovery is not added by this fix.

Validation: 91 targeted tests passed (World 16, console 17, daemon 58), console and daemon typechecks passed, changed TypeScript lint passed, and daemon plus webpack console production builds passed. The running challenge endpoint returned 200 with `purpose: session`, no action, and a fresh RP signature. The user confirmed that scanning the new QR and approving on the phone now completes sign-in.

Official reference: [World session proofs](https://docs.world.org/world-id/idkit/session-proofs).
