import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { FieldCrypto, TestKeyProvider } from '../src/index';

const keyA = new TestKeyProvider(randomBytes(32));
const keyB = new TestKeyProvider(randomBytes(32));

describe('FieldCrypto', () => {
  it('encrypt/decrypt round-trips', async () => {
    const c = new FieldCrypto(keyA);
    const secret = '+919876543210';
    const enc = await c.encrypt(secret);
    expect(enc).not.toContain(Buffer.from(secret));
    expect(await c.decrypt(enc)).toBe(secret);
  });

  it('produces different ciphertext for the same value (random IV)', async () => {
    const c = new FieldCrypto(keyA);
    const a = await c.encrypt('same');
    const b = await c.encrypt('same');
    expect(a.equals(b)).toBe(false);
    expect(await c.decrypt(a)).toBe('same');
    expect(await c.decrypt(b)).toBe('same');
  });

  it('fails with the wrong key', async () => {
    const a = new FieldCrypto(keyA);
    const b = new FieldCrypto(keyB);
    const enc = await a.encrypt('secret');
    await expect(b.decrypt(enc)).rejects.toThrow();
  });

  it('fails on tampered ciphertext (GCM auth tag)', async () => {
    const c = new FieldCrypto(keyA);
    const enc = await c.encrypt('secret');
    const last = enc.length - 1;
    enc[last] = (enc[last] ?? 0) ^ 0xff;
    await expect(c.decrypt(enc)).rejects.toThrow();
  });

  it('rejects malformed payloads without leaking plaintext', async () => {
    const c = new FieldCrypto(keyA);
    await expect(c.decrypt(Buffer.from('not-a-payload'))).rejects.toThrow(/format/);
  });
});

describe('hashLookup', () => {
  it('is deterministic for the same input', async () => {
    const c = new FieldCrypto(keyA);
    expect(await c.hashLookup('+919876543210')).toBe(await c.hashLookup('+919876543210'));
  });

  it('differs for different inputs and keys', async () => {
    const a = new FieldCrypto(keyA);
    const b = new FieldCrypto(keyB);
    expect(await a.hashLookup('x')).not.toBe(await a.hashLookup('y'));
    expect(await a.hashLookup('x')).not.toBe(await b.hashLookup('x'));
  });

  it('is not reversible as plain sha256 of the value', async () => {
    const { createHash } = await import('node:crypto');
    const c = new FieldCrypto(keyA);
    const plain = createHash('sha256').update('+919876543210').digest('hex');
    expect(await c.hashLookup('+919876543210')).not.toBe(plain);
  });
});
