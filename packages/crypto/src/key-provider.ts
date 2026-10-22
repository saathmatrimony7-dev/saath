/**
 * Key providers for the crypto module (DESIGN.md §12.4).
 *
 * Local dev / tests: a master key from the environment (FLE_MASTER_KEY_B64).
 * Cloud: AWS KMS CMK per data class — implemented when accounts exist (P0 Q1);
 * the C4 key's policy restricts usage to the crypto-module IAM role.
 */
export interface KeyProvider {
  /** Returns the 32-byte master key. Callers must not log or persist it. */
  getMasterKey(): Promise<Buffer>;
}

/** Local development / CI provider: base64 master key from env. */
export class EnvKeyProvider implements KeyProvider {
  constructor(private readonly envVar = 'FLE_MASTER_KEY_B64') {}

  async getMasterKey(): Promise<Buffer> {
    const b64 = process.env[this.envVar];
    if (!b64) {
      throw new Error(`${this.envVar} is not set (see .env.example)`);
    }
    const key = Buffer.from(b64, 'base64');
    if (key.length !== 32) {
      throw new Error(`${this.envVar} must decode to exactly 32 bytes`);
    }
    return key;
  }
}

/** Fixed-key provider for tests only — never wire into app code. */
export class TestKeyProvider implements KeyProvider {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new Error('test key must be 32 bytes');
  }
  async getMasterKey(): Promise<Buffer> {
    return this.key;
  }
}
