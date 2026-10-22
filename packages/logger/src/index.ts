/**
 * Saath redaction logger — structured JSON logging where PII can never leak.
 *
 * Wraps pino: every log argument (message strings and object fields) passes
 * through deepRedact before serialisation. Use this everywhere instead of
 * console.* or a bare pino instance (AGENTS.md rule 8).
 */
import { pino, type DestinationStream, type Logger, type LoggerOptions } from 'pino';
import { deepRedact, scrubString } from './redact';

export type SaathLogger = Logger;

export function createLogger(
  service: string,
  options: LoggerOptions = {},
  destination?: DestinationStream,
): SaathLogger {
  return pino(
    {
      name: service,
      level: process.env.LOG_LEVEL ?? 'info',
      base: { service, env: process.env.NODE_ENV ?? 'development' },
      ...options,
      hooks: {
        // Sanitise every argument before pino serialises it.
        logMethod(inputArgs: unknown[], method) {
          const sanitised = inputArgs.map((arg) =>
            typeof arg === 'string' ? scrubString(arg) : deepRedact(arg),
          );
          return (method as (...a: unknown[]) => unknown).apply(this, sanitised);
        },
        ...options.hooks,
      },
    },
    destination,
  );
}

export { deepRedact, scrubString, REDACTED } from './redact';
