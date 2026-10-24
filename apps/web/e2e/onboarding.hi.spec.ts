import { expect, test } from '@playwright/test';

import { completeInterviewToReview, loginWithOtp } from './helpers';

test('sign up and complete onboarding in Hindi', async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto('/hi/login');
  await expect(page.getByRole('heading', { name: 'साथ में साइन इन करें' })).toBeVisible();

  await loginWithOtp(page, {
    locale: 'hi',
    phone: '9876500002',
    labels: {
      phone: 'मोबाइल नंबर',
      send: 'OTP भेजें',
      sent: /कोड भेज दिया/,
      code: 'OTP कोड',
      verify: 'सत्यापित करें',
    },
  });

  // httpOnly cookie check (tokens never readable from JS).
  const cookies = await page.context().cookies();
  expect(cookies.find((c) => c.name === 'saath_at')?.httpOnly).toBe(true);
  await page.evaluate(() => {
    if (document.cookie.includes('saath_at=')) throw new Error('access token visible to JS');
  });

  // Scripted engine greets in Hindi (Devanagari greeting on the page).
  await expect(page.getByText(/नमस्ते/)).toBeVisible();
  await completeInterviewToReview(page, {
    answers: [
      'मैं पुणे में सॉफ़्टवेयर इंजीनियर हूँ।',
      'मुझे दयालुता और समान विचार ज़रूरी हैं।',
      'छुट्टियों में मैं पढ़ता और घूमता हूँ।',
      'हम चार लोगों का परिवार हैं।',
      'हाँ, ज़रूरत पड़ने पर शहर बदल सकता हूँ।',
      'धूम्रपान बिल्कुल नहीं।',
      'बस इतना ही।',
    ],
    reviewLink: 'प्रोफ़ाइल देखें',
    turns: 8,
  });

  await expect(page.getByRole('heading', { name: 'अपनी प्रोफ़ाइल जाँचें' })).toBeVisible();
  await expect(page.getByText(/जानकारी समेट ली है/)).toBeVisible();
  await page.getByRole('button', { name: 'प्रोफ़ाइल पक्की करें' }).click();
  await expect(page.getByRole('heading', { name: 'प्रोफ़ाइल पक्की हुई' })).toBeVisible();
});
