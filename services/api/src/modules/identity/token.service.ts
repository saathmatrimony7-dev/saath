/**
 * Token service (DESIGN.md §12.2):
 * - Access: ES256 JWT, 10 min TTL, `kid` for key rotation.
 * - Refresh: opaque 256-bit tokens, stored SHA-256-hashed, rotate on every use.
 *   Reuse of a rotated token = theft signal → the whole session is revoked.
 */
import { randomBytes, createHash } from 'node:crypto';
import { SignJWT, jwtVerify, importPKCS8, importSPKI } from 'jose';
import type { AppConfig } from '../../config';

export interface AccessTokenPayload {
  sub: string; // user id
  sid: string; // session id
}

export class TokenService {
  constructor(private readonly config: AppConfig) {}

  private async signingKey() {
    const pem = Buffer.from(this.config.JWT_PRIVATE_KEY_ES256_B64, 'base64').toString('utf8');
    return importPKCS8(pem, 'ES256');
  }

  private async verifyKey() {
    const pem = Buffer.from(this.config.JWT_PUBLIC_KEY_ES256_B64, 'base64').toString('utf8');
    return importSPKI(pem, 'ES256');
  }

  async signAccessToken(payload: AccessTokenPayload): Promise<string> {
    const key = await this.signingKey();
    return new SignJWT({ sid: payload.sid })
      .setProtectedHeader({ alg: 'ES256', kid: this.config.JWT_KEY_ID })
      .setSubject(payload.sub)
      .setIssuer(this.config.JWT_ISSUER)
      .setIssuedAt()
      .setExpirationTime(`${this.config.JWT_ACCESS_TTL_SEC}s`)
      .sign(key);
  }

  async verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    const key = await this.verifyKey();
    const { payload } = await jwtVerify(token, key, {
      issuer: this.config.JWT_ISSUER,
      algorithms: ['ES256'],
    });
    if (!payload.sub || typeof payload.sid !== 'string') {
      throw new Error('malformed access token');
    }
    return { sub: payload.sub, sid: payload.sid };
  }

  generateRefreshToken(): { token: string; hash: string } {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: TokenService.hashRefreshToken(token) };
  }

  static hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
