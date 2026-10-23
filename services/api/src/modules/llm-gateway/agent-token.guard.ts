/**
 * Scoped agent token guard for /internal/tools/* (P1-05, DESIGN.md A6.0/A12.6).
 * Verifies the HMAC-scoped token from x-agent-token and enforces that the
 * endpoint's tool name is in the token's allow-list. Claims land on
 * req.agentClaims for the controller (agent + acting_for_user_id binding).
 */
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { AppConfig } from '../../config';
import { APP_CONFIG } from '../identity/tokens';
import { AgentTokenError, verifyAgentToken, type ScopedTokenClaims } from './agent-token';

export const AGENT_CLAIMS_KEY = 'agentClaims';

@Injectable()
export class AgentTokenGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const handler = context.getHandler() as { toolName?: string } | undefined;
    const toolName = handler?.toolName ?? '';
    const header = req.headers['x-agent-token'];
    const token = typeof header === 'string' ? header : (header?.[0] ?? '');
    if (!token) throw new UnauthorizedException('missing agent token');

    let claims: ScopedTokenClaims;
    try {
      claims = verifyAgentToken(this.config.AGENT_TOKEN_HMAC_SECRET, token);
    } catch (err) {
      if (err instanceof AgentTokenError) throw new UnauthorizedException(err.message);
      throw err;
    }
    if (toolName && !claims.tools.includes(toolName)) {
      throw new ForbiddenException(`tool not allowed for ${claims.agent}: ${toolName}`);
    }
    req[AGENT_CLAIMS_KEY] = claims;
    return true;
  }
}

/** Decorator: marks the endpoint's tool name for the guard's allow-list check. */
export function ToolName(name: string): MethodDecorator {
  return (target, _propertyKey, descriptor) => {
    (descriptor.value as { toolName?: string }).toolName = name;
    void target;
    return descriptor;
  };
}
