import { isIP } from 'node:net';

const parseHosts = (raw) => String(raw || '').split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean);

export function settingsFromEnv(env = process.env) {
  const targets = parseHosts(env.TARGET_HOSTS || '');
  const resources = parseHosts(env.RESOURCE_HOSTS || 'fonts.googleapis.com,fonts.gstatic.com,images.unsplash.com,images.pexels.com,image.tmdb.org');
  const publicHosts = parseHosts([env.MCP_PUBLIC_HOST, env.RAILWAY_PUBLIC_DOMAIN].filter(Boolean).join(','));
  return {
    targets,
    resources,
    publicHosts: [...new Set(['localhost', '127.0.0.1', ...publicHosts])],
    maxSessions: Math.max(1, Math.min(4, Number(env.MAX_BROWSER_SESSIONS || 2) || 2)),
    ttlMs: 10 * 60 * 1000,
    enableInteractions: env.ENABLE_INTERACTIONS === 'true',
  };
}

/** Host allowlisting is exact. No wildcard or suffix matching. */
export function validateUrl(raw, hosts) {
  let url;
  try { url = new URL(raw); } catch { throw new Error('Invalid URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) {
    throw new Error('Only HTTPS URLs without credentials or custom ports are allowed');
  }
  const host = url.hostname.toLowerCase();
  if (isIP(host) || host.endsWith('.') || !hosts.includes(host)) {
    throw new Error(`Host not allowed: ${host}`);
  }
  return url;
}

/** Browser subresources are separately approved; navigation is limited to project hosts. */
export function isAllowedBrowserRequest(raw, isNavigation, settings) {
  if (/^(data|blob|about):/.test(raw)) return !isNavigation;
  try {
    validateUrl(raw, isNavigation ? settings.targets : [...settings.targets, ...settings.resources]);
    return true;
  } catch { return false; }
}

/** A constant-time token check; never print tokens or authentication headers. */
export function isAuthorized(header, secret) {
  if (typeof header !== 'string' || !header.startsWith('Bearer ') || !secret) return false;
  const supplied = header.slice(7);
  if (supplied.length === 0) return false;
  // Hashes have equal lengths even when caller supplied an incorrectly sized token.
  // Importing crypto synchronously keeps this helper easy to unit-test.
  return constantTimeTokenEqual(supplied, secret);
}

import { timingSafeEqual, createHash } from 'node:crypto';
function constantTimeTokenEqual(a, b) {
  const left = createHash('sha256').update(a).digest();
  const right = createHash('sha256').update(b).digest();
  return timingSafeEqual(left, right);
}

export function safeUrl(raw) {
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname}`.slice(0, 350);
  } catch { return '[non-URL]'; }
}
