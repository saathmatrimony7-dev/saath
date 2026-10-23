/**
 * Scoped agent tokens — TS mirror of services/agents/src/saath_agents/tokens.py.
 * KEEP IN SYNC: token = b64url(json) + '.' + b64url(hmac_sha256(secret, payload)).
 * Binds agent + acting_for_user_id + tool allow-list + 15-minute expiry.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const AGENT_TOKEN_MAX_TTL_SEC = 15 * 60;

export interface ScopedTokenClaims {
  agent: string;
  acting_for_user_id: string;
  tools: string[];
  exp: number;
}

export class AgentTokenError extends Error {}

export function b64url(data: Buffer): string {
  return data.toString('base64url');
}

export function mintAgentToken(
  secret: string,
  claims: Omit<ScopedTokenClaims, 'exp'>,
  ttlSeconds = AGENT_TOKEN_MAX_TTL_SEC,
): string {
  if (ttlSeconds > AGENT_TOKEN_MAX_TTL_SEC) {
    throw new Error('agent token TTL exceeds the 15-minute maximum');
  }
  const full: ScopedTokenClaims = { ...claims, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const payload = b64url(Buffer.from(JSON.stringify(full), 'utf8'));
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyAgentToken(secret: string, token: string): ScopedTokenClaims {
  const idx = token.indexOf('.');
  if (idx <= 0) throw new AgentTokenError('invalid or expired agent token');
  const payload = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expected = createHmac('sha256', secret).update(payload).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(expected, given)) {
    throw new AgentTokenError('invalid or expired agent token');
  }
  let claims: ScopedTokenClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as ScopedTokenClaims;
  } catch {
    throw new AgentTokenError('invalid or expired agent token');
  }
  if (
    typeof claims.agent !== 'string' ||
    typeof claims.exp !== 'number' ||
    !Array.isArray(claims.tools)
  ) {
    throw new AgentTokenError('invalid or expired agent token');
  }
  if (claims.exp < Math.floor(Date.now() / 1000)) {
    throw new AgentTokenError('invalid or expired agent token');
  }
  return claims;
}
