import { generateKeyPairSync, randomBytes } from 'node:crypto';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
console.log(`JWT_PRIVATE_KEY_ES256_B64=${Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64')}`);
console.log(`JWT_PUBLIC_KEY_ES256_B64=${Buffer.from(publicKey.export({ type: 'spki', format: 'pem' })).toString('base64')}`);
console.log(`FLE_MASTER_KEY_B64=${randomBytes(32).toString('base64')}`);
console.log(`OTP_PEPPER=${randomBytes(16).toString('hex')}`);
