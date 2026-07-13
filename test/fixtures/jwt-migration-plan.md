# Migrate session auth to JWT with refresh rotation

## Context & goal

Session cookies are validated against a single Postgres table on every request. This plan swaps session cookies for short-lived JWTs with a rotating refresh token.

Scope: apps/api/auth/* and the two internal services that read the session directly.

## Proposed approach

1. Add a JWT issuer (auth/jwt.ts) using the existing signing-key rotation service; access tokens expire in 15 min.
2. Introduce a refresh_tokens table keyed by device, rotating on every use.
3. Update apps/api/middleware/session.ts to accept either a legacy session cookie or a bearer JWT.
4. Backfill transparently on first request after deploy.
5. Flip billing and notifications to read JWT claims instead of querying the sessions table directly.

## Implementation checklist

- [ ] Add auth/jwt.ts issuer + unit tests for signing/verification
- [ ] Create refresh_tokens migration + revoke-on-rotate logic
- [ ] Update middleware/session.ts dual-read path
- [ ] Ship feature flag jwt_session_rollout (0% default)

## Code sketch

Rotation logic for refresh_tokens, chained via parentId for audit:

```ts
export async function rotateRefreshToken(tokenId: string) {
  const current = await db.refreshTokens.findUnique({ where: { id: tokenId } });
  if (!current || current.revokedAt) throw new AuthError('invalid_refresh');
  return issueAccessToken(current.userId, { ttl: '15m' });
}
```

## Testing plan

- Unit: token issuance, rotation, and revocation edge cases
- Integration: dual-read middleware against staging traffic replay
- Load test: refresh endpoint at 5x current session-lookup volume

## Rollback & risks

The feature flag is per-account and defaults to 0%, so rollback is a flag flip with no data migration to undo.

- Clock skew between services could reject valid tokens early.
- billing and notifications read sessions synchronously today.
