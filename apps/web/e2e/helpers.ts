import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/** Reads the latest mock OTP from the API e2e server's test-only endpoint. */
export async function latestOtp(): Promise<string> {
  const res = await fetch('http://127.0.0.1:3100/__e2e/otp');
  const body = (await res.json()) as { code: string | null };
  if (!body.code) throw new Error('mock SMS outbox is empty');
  return body.code;
}

/** Full OTP login for a fresh phone number; lands on the onboarding page. */
export async function loginWithOtp(
  page: Page,
  opts: {
    locale: 'en' | 'hi' | 'ta';
    phone: string;
    labels: { phone: string; send: string; sent: RegExp; code: string; verify: string };
  },
): Promise<void> {
  await page.goto(`/${opts.locale}/login`);
  await page.getByLabel(opts.labels.phone).fill(opts.phone);
  await page.getByRole('button', { name: opts.labels.send }).click();
  await expect(page.getByText(opts.labels.sent)).toBeVisible();
  const code = await latestOtp();
  await page.getByLabel(opts.labels.code).fill(code);
  await page.getByRole('button', { name: opts.labels.verify }).click();
  await page.waitForURL(`**/${opts.locale}/onboarding`);
}

/** Chat until the engine asks for confirmation; returns after clicking review. */
export async function completeInterviewToReview(
  page: Page,
  opts: { answers: string[]; reviewLink: string; turns: number },
): Promise<void> {
  const review = page.getByRole('link', { name: opts.reviewLink });
  const input = page.getByLabel(/Type your answer|अपना उत्तर लिखें|உங்கள் பதில் எழுதுங்கள்/);
  for (const answer of opts.answers.slice(0, opts.turns)) {
    if (await review.isVisible().catch(() => false)) break;
    await input.fill(answer);
    await page.getByRole('button', { name: /^Send$|भेजें|அனுப்பு$/ }).click();
    // After the done frame the UI either re-enables the input (next turn)
    // or replaces the form with the review link (awaiting_confirm).
    const next = await Promise.race([
      review.waitFor({ state: 'visible', timeout: 30_000 }).then(() => 'review' as const),
      expect(input)
        .toBeEnabled({ timeout: 30_000 })
        .then(() => 'input' as const),
    ]);
    if (next === 'review') break;
  }
  await expect(review).toBeVisible({ timeout: 30_000 });
  await review.click();
  await page.waitForURL('**/profile/review**');
}
