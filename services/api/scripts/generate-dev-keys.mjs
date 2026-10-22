#!/usr/bin/env node
/**
 * Generates a LOCAL DEV ES256 keypair for JWT signing and prints the values
 * to put in your git-ignored .env.local. Never commit real keys.
 */
import { generateKeyPairSync } from 'node:crypto';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });

const priv = privateKey.export({ type: 'pkcs8', format: 'pem' });
const pub = publicKey.export({ type: 'spki', format: 'pem' });

console.log('Add to services/api/.env.local (git-ignored):');
console.log(`JWT_PRIVATE_KEY_ES256_B64=${Buffer.from(priv).toString('base64')}`);
console.log(`JWT_PUBLIC_KEY_ES256_B64=${Buffer.from(pub).toString('base64')}`);
console.log(`OTP_PEPPER=${randomHex()}`);
console.log(`FLE_MASTER_KEY_B64=${randomB64()}`);

function randomHex(): string {
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}
function randomB64(): string {
  return Buffer.from(Array.from({ length: 32 }, () => Math.floor(Math.random() * 256))).toString(
    'base64',
  );
}
