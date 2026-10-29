import { defineRouting } from 'next-intl/routing';

/** P1 languages en/hi/ta; P5 adds te + bn (DESIGN.md §1.3 continues in P6). */
export const routing = defineRouting({
  locales: ['en', 'hi', 'ta', 'te', 'bn'],
  defaultLocale: 'en',
  localePrefix: 'always',
});

export type Locale = (typeof routing.locales)[number];

export function isLocale(value: string | undefined): value is Locale {
  return routing.locales.includes(value as Locale);
}
