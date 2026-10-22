/**
 * Environment loading: .env.local (git-ignored, real local secrets) first,
 * then .env as fallback. Committed .env files are never used for secrets.
 */
import { config } from 'dotenv';
import { existsSync } from 'node:fs';

if (existsSync('.env.local')) {
  config({ path: '.env.local' });
}
config();
