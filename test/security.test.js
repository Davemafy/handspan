import test from 'node:test';
import assert from 'node:assert/strict';
import { settingsFromEnv, validateUrl, isAllowedBrowserRequest, isAuthorized, safeUrl } from '../src/security.js';

const settings = settingsFromEnv({
  TARGET_HOSTS: 'example.com,example.org',
  RESOURCE_HOSTS: 'fonts.gstatic.com,images.unsplash.com',
});
test('accepts only explicitly approved HTTPS project sites', () => {
  assert.equal(validateUrl('https://example.com/invitations', settings.targets).hostname, 'example.com');
  for (const url of [
    'http://example.com',
    'https://example.com.evil.com',
    'https://evil.com@example.com',
    'https://127.0.0.1/',
    'https://localhost/',
    'file:///etc/passwd',
    'https://example.com:8443',
    'https://example.com./',
  ]) assert.throws(() => validateUrl(url, settings.targets), url);
});
test('allows approved static assets but not navigation to asset hosts', () => {
  assert.equal(isAllowedBrowserRequest('https://fonts.gstatic.com/s/font.woff2', false, settings), true);
  assert.equal(isAllowedBrowserRequest('https://fonts.gstatic.com/', true, settings), false);
  assert.equal(isAllowedBrowserRequest('https://169.254.169.254/metadata', false, settings), false);
  assert.equal(isAllowedBrowserRequest('http://example.com/', false, settings), false);
  assert.equal(isAllowedBrowserRequest('data:image/png;base64,AA==', false, settings), true);
});
test('bearer authentication requires exact secret', () => {
  const key = '0123456789abcdefghijklmnopqrstuvwxyz';
  assert.equal(isAuthorized(`Bearer ${key}`, key), true);
  assert.equal(isAuthorized('Bearer incorrect', key), false);
  assert.equal(isAuthorized(`Basic ${key}`, key), false);
  assert.equal(isAuthorized(undefined, key), false);
});
test('query strings and fragments never appear in diagnostic URLs', () => {
  assert.equal(safeUrl('https://example.com/path?token=private#frag'), 'https://example.com/path');
});
