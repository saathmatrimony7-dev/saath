import { defineRouting } from 'next-intl/routing';

/** P1 languages (DESIGN.md §1.3 starts with en + hi + ta). */
export const routing = defineRouting({
  locales: ['en', 'hi', 'ta'],
  defaultLocale: 'en',
  localePrefix: 'always',
});

export type Locale = (typeof routing.locales)[number];

export function isLocale(value: string | undefined): value is Locale {
  return routing.locales.includes(value as Locale);
}
