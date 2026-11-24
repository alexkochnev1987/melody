import { createHash, randomBytes } from 'node:crypto';

const COOKIE_NAME = 'melody_guest_v1';
const GUEST_PATTERN = /^[a-f0-9]{64}$/;

/**
 * This secret is never returned to a client-side script. A one-year HttpOnly
 * cookie identifies the same guest across game rooms in this browser.
 */
export function getGuestIdentity(request: Request): { hash: string; setCookie?: string } {
  const raw = request.headers.get('cookie') ?? '';
  const pair = raw.split(';').map(item => item.trim()).find(item => item.startsWith(`${COOKIE_NAME}=`));
  const value = pair?.slice(COOKIE_NAME.length + 1) ?? '';
  const secret = GUEST_PATTERN.test(value) ? value : randomBytes(32).toString('hex');
  const hash = createHash('sha256').update(secret, 'utf8').digest('hex');
  return {
    hash,
    ...(!GUEST_PATTERN.test(value) ? { setCookie:
      `${COOKIE_NAME}=${secret}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax` +
      (new URL(request.url).protocol === 'https:' ? '; Secure' : ''),
    } : {}),
  };
}
