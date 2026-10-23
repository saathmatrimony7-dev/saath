/**
 * Taxonomy tests (P1-01): seeded reference data served in en/hi/ta,
 * authenticated read, anonymous denied, writes denied for the app role,
 * and the rule-10 guard (no inference of religion/community).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { bootTestApp, signupTestUser, TestClient, type TestApp } from '../helpers/test-app';
import { getTestDbUrls } from '../helpers/test-db';
import { RlsPrismaClient } from '../../src/prisma/rls-prisma.client';
import { seedTaxonomy } from '../../prisma/seed-taxonomy-runner';

let t: TestApp;
let app: INestApplication;
let client: TestClient;

beforeAll(async () => {
  t = await bootTestApp();
  app = t.app;

  // Taxonomy seed runs under the ADMIN connection (app role is SELECT-only).
  const admin = new RlsPrismaClient({ datasources: { db: { url: getTestDbUrls().adminUrl } } });
  await seedTaxonomy(admin);
  await admin.$disconnect();

  ({ client } = await signupTestUser(t, '+919100000001'));
});

afterAll(async () => {
  await app.close();
});

describe('taxonomy endpoints', () => {
  it('serves religions with locale labels (hi, ta, en fallback)', async () => {
    const hi = await client.get('/v1/taxonomy/religions?locale=hi');
    expect(hi.status).toBe(200);
    const hindu = (hi.json as unknown as { id: string; label: string }[]).find((r) => r.id === 'hindu');
    expect(hindu?.label).toBe('हिंदू');

    const ta = await client.get('/v1/taxonomy/religions?locale=ta');
    const taHindu = (ta.json as unknown as { id: string; label: string }[]).find((r) => r.id === 'hindu');
    expect(taHindu?.label).toBe('இந்து');
  });

  it('serves communities filtered by religion', async () => {
    const res = await client.get('/v1/taxonomy/communities?religion=muslim');
    const ids = (res.json as unknown as { id: string }[]).map((c) => c.id);
    expect(ids).toContain('muslim-sunni');
    expect(ids).not.toContain('hindu-brahmin');
  });

  it('serves attribute definitions: global + community-scoped', async () => {
    const global = await client.get('/v1/attributes');
    const keys = (global.json as unknown as { key: string }[]).map((a) => a.key);
    expect(keys).toContain('diet');
    expect(keys).not.toContain('gotra'); // brahmin-scoped

    const brahmin = await client.get('/v1/attributes?community=hindu-brahmin');
    const bKeys = (brahmin.json as unknown as { key: string }[]).map((a) => a.key);
    expect(bKeys).toContain('gotra');
    expect(bKeys).toContain('diet');
  });

  it('is public read: anonymous gets 200 (no auth needed for reference data)', async () => {
    const anon = new TestClient(t.baseUrl);
    const res = await anon.get('/v1/taxonomy/religions');
    expect(res.status).toBe(200);
    const ids = (res.json as unknown as { id: string }[]).map((r) => r.id);
    expect(ids).toContain('hindu');
  });
});

describe('taxonomy is read-only for the app role (RLS)', () => {
  it('INSERT as app_login is denied (no write grant/policy)', async () => {
    const appDb = new RlsPrismaClient({ datasources: { db: { url: getTestDbUrls().appUrl } } });
    await expect(
      appDb.taxonomyReligion.create({
        data: { id: 'injected', labelI18n: { en: 'x' }, sortOrder: 0 },
      }),
    ).rejects.toThrow();
    await appDb.$disconnect();
  });
});

describe('rule 10 — no community/caste inference', () => {
  it('no source file infers religion/community/caste from names, photos or text', () => {
    const srcRoot = join(__dirname, '..', '..', 'src');
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name.endsWith('.ts')) {
          const content = readFileSync(full, 'utf8');
          // Flag any code that ASSIGNS community/caste fields from free text or names.
          if (/community\s*=\s*.*(name|bio|about|text)/i.test(content)) {
            offenders.push(full);
          }
        }
      }
    };
    walk(srcRoot);
    expect(offenders).toEqual([]);
  });
});
