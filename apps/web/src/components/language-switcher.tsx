'use client';

import { useLocale } from 'next-intl';

import { routing } from '@/i18n/routing';

/**
 * Simple locale switcher: navigates to the same page in another language.
 * The current path is preserved by swapping the locale prefix.
 */
export function LanguageSwitcher() {
  const locale = useLocale();
  // window is only read in the click handler — no hydration mismatch.
  return (
    <nav aria-label="Language" className="flex gap-2 text-sm">
      {routing.locales.map((l) => (
        <a
          key={l}
          href={`/${l}`}
          onClick={(e) => {
            e.preventDefault();
            const rest = window.location.pathname.replace(/^\/(en|hi|ta|te|bn)/, '');
            window.location.assign(`/${l}${rest}`);
          }}
          aria-current={l === locale ? 'true' : undefined}
          className={
            l === locale
              ? 'rounded-full bg-stone-900 px-3 py-1 font-semibold text-amber-50'
              : 'rounded-full border border-stone-300 px-3 py-1 hover:bg-stone-200'
          }
        >
          {l}
        </a>
      ))}
    </nav>
  );
}
