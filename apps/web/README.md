# @saath/web — Saath web app (P1-08)

Next.js 15 (App Router) + Tailwind CSS v4 + next-intl (en/hi/ta).

## Pages

- `/[locale]/login` — OTP login (phone → code). Auth tokens live only in
  httpOnly cookies set by the Core API (`saath_at`/`saath_rt`); the browser
  only reads the non-httpOnly CSRF double-submit cookie to send `x-csrf-token`.
- `/[locale]/onboarding` — onboarding interview chat. Consumes the SSE turn
  endpoint with `fetch` + a stream reader (EventSource can't set the CSRF
  header). AI messages are badged; engine `[AI]` prefixes are stripped in UI.
- `/[locale]/profile/review` — interview summary + explicit confirm. The
  profile goes live only via `POST /v1/onboarding/confirm`.

## API access

The browser never talks to the API cross-origin: `next.config.ts` rewrites
`/api/core/*` to `{CORE_API_URL}/v1/*` (default `http://127.0.0.1:3000`).
Copy `.env.example` to `.env.local` to override.

## i18n

All user-facing strings come from `packages/i18n/messages/{en,hi,ta}.json`
(AGENTS.md rule 14). `pnpm lint` in this package runs `scripts/check-i18n.mjs`,
which fails the build if any literal text is hard-coded in JSX.

## E2E

`pnpm test:e2e` boots the Core API e2e server (`services/api` `e2e:serve` —
embedded Postgres, mock OTP, scripted onboarding engine, `ONBOARDING_MAX_TURNS=5`)
and `next dev`, then signs up and completes onboarding in English and Hindi.
Requires Playwright browsers: `pnpm exec playwright install chromium`.
