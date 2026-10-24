import { expect, test } from '@playwright/test';

import { completeInterviewToReview, loginWithOtp } from './helpers';

test('sign up and complete onboarding in English', async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto('/en/login');
  await expect(page.getByRole('heading', { name: 'Sign in to Saath' })).toBeVisible();

  await loginWithOtp(page, {
    locale: 'en',
    phone: '9876500001',
    labels: {
      phone: 'Mobile number',
      send: 'Send OTP',
      sent: /sent a code/i,
      code: 'OTP code',
      verify: 'Verify',
    },
  });

  // Session tokens must be httpOnly; the CSRF cookie is JS-readable by design.
  const cookies = await page.context().cookies();
  expect(cookies.find((c) => c.name === 'saath_at')?.httpOnly).toBe(true);
  expect(cookies.find((c) => c.name === 'saath_rt')?.httpOnly).toBe(true);
  await page.evaluate(() => {
    if (document.cookie.includes('saath_at=')) throw new Error('access token visible to JS');
  });

  // Scripted engine greets in English and walks its topics.
  await expect(page.getByText(/onboarding assistant/)).toBeVisible();
  await completeInterviewToReview(page, {
    answers: [
      'I work as a software engineer, B.Tech from Pune.',
      'Kindness and shared values matter most.',
      'I read and hike on weekends.',
      'We are a close-knit family of four.',
      'Yes, open to relocating.',
      'No smoking is a firm dealbreaker.',
      'That is everything.',
    ],
    reviewLink: 'Review profile',
    turns: 8,
  });

  await expect(page.getByRole('heading', { name: 'Review your profile' })).toBeVisible();
  await expect(page.getByText(/gathered your details/i)).toBeVisible();
  await page.getByRole('button', { name: 'Confirm profile' }).click();
  await expect(page.getByRole('heading', { name: 'Profile confirmed' })).toBeVisible();
  await expect(page.getByText(/profile is now live/i)).toBeVisible();
});
