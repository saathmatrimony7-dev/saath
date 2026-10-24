import { hasLocale } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';

import en from '@saath/i18n/messages/en.json';
import hi from '@saath/i18n/messages/hi.json';
import ta from '@saath/i18n/messages/ta.json';

import { routing } from './routing';

const messages = { en, hi, ta } as const;

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  return { locale, messages: messages[locale] };
});
