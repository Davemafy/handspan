import { chromium } from 'playwright';
import { randomUUID } from 'node:crypto';
import { settingsFromEnv, validateUrl, isAllowedBrowserRequest, safeUrl } from './security.js';

const DEVICE = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1 },
  mobile: { width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true },
};
const MAX_EVENTS = 35;

const pushEvent = (events, item) => {
  events.push(item);
  if (events.length > MAX_EVENTS) events.shift();
};
const cut = (value, size = 220) => String(value || '').slice(0, size);

export class BrowserService {
  constructor(settings = settingsFromEnv()) {
    this.settings = settings;
    this.browser = null;
    this.launching = null;
    this.sessions = new Map();
    this.sweeper = setInterval(() => { void this.expire(); }, 60_000);
    this.sweeper.unref?.();
  }

  async getBrowser() {
    if (this.browser?.isConnected()) return this.browser;
    if (!this.launching) {
      this.launching = chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
    }
    try {
      this.browser = await this.launching;
      return this.browser;
    } finally { this.launching = null; }
  }

  async open(url, device = 'desktop') {
    const target = validateUrl(url, this.settings.targets);
    if (!DEVICE[device]) throw new Error('Unsupported device');
    await this.expire();
    if (this.sessions.size >= this.settings.maxSessions) {
      throw new Error('Browser session limit reached. Close an existing session before opening another.');
    }

    const browser = await this.getBrowser();
    const context = await browser.newContext({
      ...DEVICE[device],
      serviceWorkers: 'block',
      acceptDownloads: false,
      ignoreHTTPSErrors: false,
      permissions: [],
    });
    const events = [];
    try {
      await context.route('**/*', async (route) => {
        const request = route.request();
        if (isAllowedBrowserRequest(request.url(), request.isNavigationRequest(), this.settings)) {
          try { await route.continue(); } catch { /* Page may have closed. */ }
        } else {
          pushEvent(events, { kind: 'blocked-request', url: safeUrl(request.url()) });
          try { await route.abort('blockedbyclient'); } catch { /* Page may have closed. */ }
        }
      });
      // Playwright request routing does not cover WebSockets. Explicitly block them.
      if (typeof context.routeWebSocket === 'function') {
        await context.routeWebSocket('**/*', async (socket) => { await socket.close(); });
      }
      const page = await context.newPage();
      page.setDefaultTimeout(10_000);
      page.on('console', (msg) => {
        if (msg.type() === 'error') pushEvent(events, { kind: 'console', message: cut(msg.text()) });
      });
      page.on('pageerror', (err) => pushEvent(events, { kind: 'pageerror', message: cut(err.message) }));
      page.on('requestfailed', (req) => pushEvent(events, {
        kind: 'requestfailed', url: safeUrl(req.url()), error: cut(req.failure()?.errorText, 120),
      }));
      page.on('response', (response) => {
        if (response.status() >= 400) pushEvent(events, {
          kind: 'http-error', status: response.status(), url: safeUrl(response.url()),
        });
      });
      const response = await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForTimeout(650);
      const sessionId = randomUUID();
      const session = { sessionId, context, page, events, device, createdAt: Date.now(), touchedAt: Date.now() };
      this.sessions.set(sessionId, session);
      return { sessionId, url: safeUrl(page.url()), title: await page.title(), status: response?.status() ?? null, device };
    } catch (error) {
      await context.close();
      throw error;
    }
  }

  get(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Session not found or expired. Open the site again.');
    session.touchedAt = Date.now();
    return session;
  }

  async screenshot(sessionId, fullPage = false) {
    const { page, device } = this.get(sessionId);
    const png = await page.screenshot({ type: 'png', fullPage, animations: 'disabled', timeout: 20_000 });
    return { png, device, url: safeUrl(page.url()), width: page.viewportSize()?.width ?? 0 };
  }

  async snapshot(sessionId) {
    const { page, events, device } = this.get(sessionId);
    const dom = await page.evaluate(() => {
      const labels = (selector, limit) => [...document.querySelectorAll(selector)].slice(0, limit).map((el) => ({
        text: String(el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 130),
        role: el.getAttribute('role') || null,
      }));
      return {
        title: document.title,
        headings: labels('h1,h2,h3', 25),
        buttons: labels('button,[role="button"]', 35),
        links: labels('a', 25),
        inputs: [...document.querySelectorAll('input,textarea,select')].slice(0, 20).map((el) => ({
          tag: el.tagName.toLowerCase(), type: el.getAttribute('type'), placeholder: el.getAttribute('placeholder'),
          // Deliberately never expose user-entered input values.
        })),
        images: { count: document.images.length, broken: [...document.images].filter(img => !img.complete || img.naturalWidth === 0).length },
        width: { viewport: window.innerWidth, document: document.documentElement.scrollWidth },
      };
    });
    return { url: safeUrl(page.url()), device, dom, events: events.slice(-MAX_EVENTS) };
  }

  async interact(sessionId, action, selector, value) {
    if (!this.settings.enableInteractions) throw new Error('Interactions disabled. Set ENABLE_INTERACTIONS=true on the MCP service.');
    const { page } = this.get(sessionId);
    if (action === 'click') await page.locator(selector).first().click();
    else if (action === 'fill') await page.locator(selector).first().fill(value || '');
    else if (action === 'press') await page.locator(selector).first().press(value || 'Enter');
    else if (action === 'scroll') await page.mouse.wheel(0, Math.min(2000, Math.max(-2000, Number(value) || 600)));
    else throw new Error(`Unsupported action: ${action}`);
    await page.waitForTimeout(300);
    return { action, url: safeUrl(page.url()), title: await page.title() };
  }

  async close(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    this.sessions.delete(sessionId);
    await session.context.close();
    return true;
  }

  async expire() {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now - session.touchedAt > this.settings.ttlMs) await this.close(id);
    }
  }

  async closeAll() {
    clearInterval(this.sweeper);
    for (const id of [...this.sessions.keys()]) await this.close(id);
    await this.browser?.close();
  }
}
