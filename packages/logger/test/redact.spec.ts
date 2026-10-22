/**
 * Redaction tests — P0 exit criterion: "redaction tests pass".
 * Every redaction class gets a test proving the raw value never appears
 * in the log output.
 */
import { describe, it, expect } from 'vitest';
import { Writable } from 'node:stream';
import { createLogger, deepRedact, scrubString, REDACTED } from '../src/index';

const capture = () => {
  let buf = '';
  const stream = new Writable({
    write(chunk, _enc, cb) {
      buf += chunk.toString();
      cb();
    },
  });
  return {
    stream,
    lines: () =>
      buf
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l)),
  };
};

describe('key-based redaction', () => {
  it('redacts sensitive keys at any depth', () => {
    const out = deepRedact({
      phone: '+919876543210',
      email: 'user@example.com',
      otp: '482913',
      token: 't0ken',
      refresh_token_hash: 'hash',
      nested: { phone_enc: 'ciphertext', deep: [{ authorization: 'Bearer x' }] },
      safe: 'visible',
    }) as Record<string, unknown>;
    const json = JSON.stringify(out);
    for (const raw of [
      '+919876543210',
      'user@example.com',
      '482913',
      't0ken',
      'ciphertext',
      'Bearer x',
    ]) {
      expect(json).not.toContain(raw);
    }
    expect(out.safe).toBe('visible');
    expect(out.phone).toBe(REDACTED);
  });

  it('redacts *_enc fields', () => {
    const out = deepRedact({ email_enc: 'ENCRYPTED', name: 'ok' }) as Record<string, unknown>;
    expect(out.email_enc).toBe(REDACTED);
    expect(out.name).toBe('ok');
  });
});

describe('pattern-based string scrubbing', () => {
  it('scrubs E.164 phone numbers inside free text', () => {
    expect(scrubString('call me at +919876543210 soon')).toBe(`call me at ${REDACTED} soon`);
  });

  it('scrubs emails inside free text', () => {
    expect(scrubString('write to lalit@example.org please')).toBe(`write to ${REDACTED} please`);
  });

  it('scrubs JWTs', () => {
    const jwt = 'eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ1c3IifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV';
    expect(scrubString(`token: ${jwt}`)).toBe(`token: ${REDACTED}`);
  });

  it('scrubs Bearer headers', () => {
    expect(scrubString('Authorization: Bearer abcdef1234567890')).toContain(REDACTED);
  });

  it('handles huge strings without pathological backtracking', () => {
    const huge = 'x'.repeat(10_000_000); // no patterns; previously hung the worker
    const start = Date.now();
    const out = scrubString(huge);
    expect(Date.now() - start).toBeLessThan(2000);
    expect(out.length).toBeLessThan(huge.length); // truncated
    expect(scrubString(huge + '+919876543210')).not.toContain('+919876543210');
  });
});

describe('logger integration', () => {
  it('log lines never contain raw PII', () => {
    const { stream, lines } = capture();
    const log = createLogger('test', {}, stream);

    log.info({ phone: '+919876543210', otp: '123456' }, 'otp sent to +919876543210');
    const line = JSON.stringify(lines());
    expect(line).not.toContain('+919876543210');
    expect(line).not.toContain('123456');
    expect(line).toContain(REDACTED);
  });

  it('keeps non-sensitive context intact', () => {
    const { stream, lines } = capture();
    const log = createLogger('test', {}, stream);
    log.info({ userId: 'usr_123', action: 'login' }, 'user logged in');
    const parsed = lines()[0];
    expect(parsed.userId).toBe('usr_123');
    expect(parsed.msg).toBe('user logged in');
  });
});
