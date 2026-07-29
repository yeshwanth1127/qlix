/**
 * GMB / Google Maps lead scraper.
 * Uses Playwright when available; falls back to structured mock data when GMB_SCRAPER_MOCK=1.
 */

import { safeFetch } from './ssrfGuard.js';

const MOCK = process.env.GMB_SCRAPER_MOCK === '1' || process.env.GMB_SCRAPER_MOCK === 'true';
const MAX_CONCURRENT = Math.max(1, Number(process.env.GMB_SCRAPER_MAX_CONCURRENT) || 2);

const PLACEHOLDER_EMAIL_DOMAINS = [
  'example.com',
  'example.org',
  'test.com',
  'domain.com',
  'yoursite.com',
  'mysite.com',
  'wixsite.com',
  'wixstudio.com',
  'godaddysites.com',
  'squarespace.com',
];

function hostnameFromUrl(websiteUrl) {
  try {
    const url = /^https?:\/\//i.test(websiteUrl) ? websiteUrl : `https://${websiteUrl}`;
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

function emailMatchesWebsite(email, websiteUrl) {
  const host = hostnameFromUrl(websiteUrl);
  if (!host) return false;
  const at = String(email).toLowerCase().lastIndexOf('@');
  if (at < 1) return false;
  const emailHost = email.slice(at + 1).toLowerCase().replace(/^www\./, '');
  return emailHost === host || emailHost.endsWith(`.${host}`);
}

function isPlaceholderEmail(email) {
  const e = String(email).trim().toLowerCase();
  const at = e.lastIndexOf('@');
  if (at < 1) return true;
  const domain = e.slice(at + 1);
  return PLACEHOLDER_EMAIL_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
}

/** Best-effort: pull a contact email from the business website (not from GMB listing). */
async function extractEmailFromWebsite(websiteUrl) {
  if (!websiteUrl?.trim()) return null;
  let url = websiteUrl.trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  try {
    const res = await safeFetch(url, {
      signal: AbortSignal.timeout(10_000),
      headers: { 'User-Agent': 'QlixLeadBot/1.0 (+https://qlix.exora.solutions)' },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const mailto = html.match(/mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
    if (mailto?.[1] && !isPlaceholderEmail(mailto[1]) && emailMatchesWebsite(mailto[1], url)) {
      return { email: mailto[1], emailSource: 'website' };
    }
    const found = html.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    if (found?.[0] && !isPlaceholderEmail(found[0]) && emailMatchesWebsite(found[0], url)) {
      return { email: found[0], emailSource: 'website' };
    }
  } catch {
    /* ignore */
  }
  return null;
}

let activeJobs = 0;
const queue = [];

function enqueue(fn) {
  return new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    drainQueue();
  });
}

function drainQueue() {
  while (activeJobs < MAX_CONCURRENT && queue.length > 0) {
    const job = queue.shift();
    activeJobs += 1;
    job
      .fn()
      .then((r) => job.resolve(r))
      .catch((e) => job.reject(e))
      .finally(() => {
        activeJobs -= 1;
        drainQueue();
      });
  }
}

function mockLeads(searchQuery, location, maxResults) {
  const loc = location || 'Local Area';
  const n = Math.min(maxResults, 10);
  return Array.from({ length: n }, (_, i) => ({
    businessName: `${searchQuery} Business ${i + 1}`,
    address: `${100 + i} Main St, ${loc}`,
    phone: `+1-555-01${String(i).padStart(2, '0')}`,
    website: `https://example-${i + 1}.com`,
    email: null,
    categories: [searchQuery],
    rating: 3.5 + (i % 3) * 0.5,
    reviewCount: 10 + i * 7,
    placeId: `mock_place_${i + 1}`,
    lat: 37.77 + i * 0.01,
    lng: -122.42 + i * 0.01,
    socialLinks: {},
    raw: { source: 'mock', searchQuery, location: loc, emailSource: 'none' },
  }));
}

const GENERIC_DETAIL_TITLES = new Set(['results', 'search results', '']);

function isValidBusinessWebsite(url) {
  if (!url?.trim()) return false;
  try {
    const normalized = /^https?:\/\//i.test(url) ? url.trim() : `https://${url.trim()}`;
    const u = new URL(normalized);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (!host.includes('.')) return false;
    const blocked = [
      'google.com',
      'goo.gl',
      'maps.app.goo.gl',
      'g.page',
      'business.site',
    ];
    if (blocked.some((b) => host === b || host.endsWith(`.${b}`))) return false;
    if (host.endsWith('.google.com') || host.includes('google.')) return false;
    return true;
  } catch {
    return false;
  }
}

async function scrapeWithPlaywright(searchQuery, location, maxResults, requireWebsite = true) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const leads = [];
  let skippedNoWebsite = 0;
  const maxScrolls = requireWebsite ? 20 : 5;
  try {
    const page = await browser.newPage();
    const q = encodeURIComponent(`${searchQuery} ${location || ''}`.trim());
    await page.goto(`https://www.google.com/maps/search/${q}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    await page.waitForTimeout(3000);

    const feedSelector = 'div[role="feed"]';
    try {
      await page.waitForSelector(feedSelector, { timeout: 15000 });
    } catch {
      console.warn('[gmb-scraper] GMB feed not found — returning empty (no mock fallback)');
      return { leads: [], skippedNoWebsite: 0 };
    }

    for (let scroll = 0; scroll < maxScrolls && leads.length < maxResults; scroll += 1) {
      const items = await page.$$('a.hfpxzc');
      for (const link of items) {
        if (leads.length >= maxResults) break;
        try {
          const aria = await link.getAttribute('aria-label');
          if (!aria) continue;
          const name = aria.trim();
          if (leads.some((l) => l.businessName === name)) continue;
          await link.click({ timeout: 5000 });
          await page.waitForTimeout(2000);

          const detail = await page.evaluate(() => {
            const text = (sel) => document.querySelector(sel)?.textContent?.trim() || null;
            const href = (sel) => document.querySelector(sel)?.getAttribute('href') || null;
            let website =
              href('a[data-item-id="authority"]') ||
              href('a[aria-label*="Website" i]') ||
              href('a[data-tooltip*="website" i]');
            if (!website) {
              for (const a of document.querySelectorAll('a[href^="http"]')) {
                const label = `${a.getAttribute('aria-label') || ''} ${a.textContent || ''}`.toLowerCase();
                if (label.includes('website') || label.includes('open website')) {
                  website = a.href;
                  break;
                }
              }
            }
            const h1 = text('h1.DUwDvf') || text('h1');
            return {
              businessName: h1 || text('[data-attrid="title"]'),
              address:
                text('button[data-item-id="address"]') ||
                text('[data-item-id="address"]') ||
                text('div[data-item-id="address"]'),
              phone:
                text('button[data-item-id^="phone"]') ||
                text('[data-item-id^="phone"]') ||
                text('button[aria-label^="Phone"]'),
              website,
              rating: text('div.F7nice span[aria-hidden="true"]') || text('span.ceNzKf'),
            };
          });

          const resolvedName =
            detail.businessName && !GENERIC_DETAIL_TITLES.has(detail.businessName.toLowerCase())
              ? detail.businessName
              : name;

          const dedupeKey = `${resolvedName}|${detail.address || ''}|${detail.phone || ''}`.toLowerCase();
          if (
            leads.some(
              (l) =>
                `${l.businessName}|${l.address || ''}|${l.phone || ''}`.toLowerCase() === dedupeKey,
            )
          ) {
            const backDup = await page.$('button[aria-label="Back"]');
            if (backDup) await backDup.click();
            await page.waitForTimeout(400);
            continue;
          }

          if (requireWebsite && !isValidBusinessWebsite(detail.website)) {
            skippedNoWebsite += 1;
            const backSkip = await page.$('button[aria-label="Back"]');
            if (backSkip) await backSkip.click();
            await page.waitForTimeout(400);
            continue;
          }

          const entry = {
            businessName: resolvedName,
            address: detail.address,
            phone: detail.phone,
            website: detail.website,
            email: null,
            categories: [searchQuery],
            rating: detail.rating ? parseFloat(detail.rating) : null,
            reviewCount: null,
            placeId: null,
            lat: null,
            lng: null,
            socialLinks: {},
            raw: { source: 'playwright', searchQuery, location, emailSource: 'none' },
          };

          if (detail.website) {
            const fromSite = await extractEmailFromWebsite(detail.website);
            if (fromSite) {
              entry.email = fromSite.email;
              entry.raw.emailSource = fromSite.emailSource;
            }
          }

          leads.push(entry);

          const back = await page.$('button[aria-label="Back"]');
          if (back) await back.click();
          await page.waitForTimeout(800);
        } catch {
          /* skip item */
        }
      }
      await page.evaluate(() => {
        const feed = document.querySelector('div[role="feed"]');
        if (feed) feed.scrollBy(0, 800);
      });
      await page.waitForTimeout(1000);
    }
  } finally {
    await browser.close();
  }

  if (leads.length === 0) {
    console.warn(
      `[gmb-scraper] Playwright returned 0 leads (requireWebsite=${requireWebsite}, skippedNoWebsite=${skippedNoWebsite})`,
    );
    return { leads: [], skippedNoWebsite };
  }
  return { leads, skippedNoWebsite };
}

export async function scrapeGmbLeads({ searchQuery, location, maxResults, requireWebsite = true }) {
  const limit = Math.min(Math.max(1, maxResults || 25), 200);
  return enqueue(async () => {
    if (MOCK) {
      await new Promise((r) => setTimeout(r, 500));
      const leads = mockLeads(searchQuery, location, limit);
      return { leads, skippedNoWebsite: 0 };
    }
    try {
      return await scrapeWithPlaywright(searchQuery, location, limit, requireWebsite !== false);
    } catch (err) {
      console.error('[gmb-scraper] Playwright failed:', err?.message || err);
      throw err;
    }
  });
}

export async function runScrapeJob({ campaignId, orgId, getCampaign, completeScrape }) {
  let campaign;
  try {
    const data = await getCampaign(orgId, campaignId);
    campaign = data.campaign;
  } catch (err) {
    console.error('[gmb-scraper] campaign load failed', err);
    return;
  }

  if (!campaign || campaign.status !== 'scraping') return;

  try {
    const scrapeResult = await scrapeGmbLeads({
      searchQuery: campaign.searchQuery,
      location: campaign.location,
      maxResults: campaign.maxResults,
      requireWebsite: campaign.requireWebsite !== false,
    });
    const leads = scrapeResult.leads ?? scrapeResult;
    await completeScrape(orgId, campaignId, leads, false);
    console.info(`[gmb-scraper] completed ${campaignId}: ${leads.length} leads`);
  } catch (err) {
    console.error('[gmb-scraper] job failed', err);
    await completeScrape(orgId, campaignId, [], true).catch(() => undefined);
  }
}
