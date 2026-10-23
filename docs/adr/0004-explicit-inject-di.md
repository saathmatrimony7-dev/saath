# ADR-0004: Explicit @Inject() on every NestJS constructor dependency

**Status:** accepted · **Date:** 2026-10-22

## Context

Vitest (esbuild) and tsx do not emit TypeScript decorator metadata, so NestJS constructor injection silently injects `undefined` when relying on `emitDecoratorMetadata`. SWC was tried and abandoned (Windows ACL quirks broke its native binding cache; extra toolchain weight).

## Decision

Every injected constructor parameter carries an explicit `@Inject(TOKEN)` (class or string token from `tokens.ts`). Custom providers use `useFactory` with explicit `inject` arrays. This makes DI independent of the transpiler.

## Consequences

- Convention applies to ALL future modules; reviewers should reject implicit-DI constructors.
- `pnpm dev` (tsx watch), vitest, and `tsc` builds behave identically.
- eslint `consistent-type-imports` must not convert runtime-needed classes (used in `@Inject`) to `import type` — it respects value usage, verified.
