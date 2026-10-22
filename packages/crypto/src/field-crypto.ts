/**
 * Field-level encryption for C4 columns (`*_enc`) and deterministic HMAC
 * lookups (`*_hash`) — DESIGN.md §12.4, AGENTS.md rule 9.
 *
 * - Encryption: AES-256-GCM, random 12-byte IV per value. Output buffer:
 *   [0x01 version][12B IV][16B auth tag][ciphertext]. Tamper-evident.
 * - Lookups: HMAC-SHA256 over the normalised value, hex-encoded. Deterministic
 *   so equality lookups (e.g. phone_e164_hash) work without decryption.
 * - Key separation: HKDF-SHA256 from the master key with distinct info labels,
 *   so the HMAC key can never be confused with the encryption key.
 */
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';
import type { KeyProvider } from './key-provider';

const VERSION = 0x01;
const IV_LEN = 12;
const TAG_LEN = 16;

export class FieldCrypto {
  private encKey?: Buffer;
  private hashKey?: Buffer;

  constructor(private readonly keys: KeyProvider) {}

  private async derive(): Promise<{ enc: Buffer; hash: Buffer }> {
    if (!this.encKey || !this.hashKey) {
      const master = await this.keys.getMasterKey();
      // hkdfSync(digest, ikm, salt, info, length)
      this.encKey = Buffer.from(hkdfSync('sha256', master, 'saath-fle', 'encryption', 32));
      this.hashKey = Buffer.from(hkdfSync('sha256', master, 'saath-fle', 'lookup-hash', 32));
    }
    return { enc: this.encKey, hash: this.hashKey };
  }

  /** Encrypts UTF-8 text for storage in a `*_enc` BYTEA column. */
  async encrypt(plaintext: string): Promise<Buffer> {
    const { enc } = await this.derive();
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv('aes-256-gcm', enc, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([Buffer.from([VERSION]), iv, tag, ct]);
  }

  /** Decrypts a buffer produced by {@link encrypt}. Throws on tamper/wrong key. */
  async decrypt(payload: Buffer): Promise<string> {
    if (payload.length < 1 + IV_LEN + TAG_LEN || payload[0] !== VERSION) {
      throw new Error('FieldCrypto: unsupported payload format');
    }
    const { enc } = await this.derive();
    const iv = payload.subarray(1, 1 + IV_LEN);
    const tag = payload.subarray(1 + IV_LEN, 1 + IV_LEN + TAG_LEN);
    const ct = payload.subarray(1 + IV_LEN + TAG_LEN);
    const decipher = createDecipheriv('aes-256-gcm', enc, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  }

  /**
   * Deterministic HMAC for equality lookups (e.g. phone_e164_hash).
   * Normalise the value (trim, lowercase for emails; E.164 for phones) BEFORE
   * calling this — the caller owns normalisation.
   */
  async hashLookup(normalisedValue: string): Promise<string> {
    const { hash } = await this.derive();
    return createHmac('sha256', hash).update(normalisedValue, 'utf8').digest('hex');
  }
}
