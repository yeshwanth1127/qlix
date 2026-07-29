import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  emailDomainMatchesWebsite,
  isPlaceholderEmail,
  isTrustworthyLeadEmail,
  sanitizeBulkLead,
} from './leadEmailTrust.js';

describe('leadEmailTrust', () => {
  it('flags placeholder domains', () => {
    assert.equal(isPlaceholderEmail('contact@example.com'), true);
    assert.equal(isPlaceholderEmail('hi@cafe-bangalore.co.in'), false);
  });

  it('rejects mock source emails', () => {
    assert.equal(
      isTrustworthyLeadEmail('contact@example.com', { source: 'mock' }),
      false,
    );
  });

  it('rejects Wix placeholder emails that do not match website', () => {
    assert.equal(isPlaceholderEmail('info@mysite.com'), true);
    assert.equal(
      isTrustworthyLeadEmail(
        'info@mysite.com',
        { emailSource: 'website' },
        'https://wyxsite.wixstudio.com/thebangalorecafe',
      ),
      false,
    );
  });

  it('accepts browser_enrich when domain matches website', () => {
    assert.equal(
      isTrustworthyLeadEmail('info@cafeazzure.com', { emailSource: 'browser_enrich' }, 'https://www.cafeazzure.com'),
      true,
    );
    assert.equal(
      isTrustworthyLeadEmail('info@cafe1.com', { emailSource: 'browser_enrich' }, 'https://www.cafeazzure.com'),
      false,
    );
  });

  it('matches email domain to website hostname', () => {
    assert.equal(emailDomainMatchesWebsite('hello@cafeazzure.com', 'cafeazzure.com'), true);
    assert.equal(emailDomainMatchesWebsite('hello@cafeazzure.com', 'https://www.cafeazzure.com/menu'), true);
    assert.equal(emailDomainMatchesWebsite('hello@other.com', 'cafeazzure.com'), false);
  });

  it('strips mock scraper emails on ingest', () => {
    const lead = sanitizeBulkLead({
      businessName: 'Test',
      email: 'contact@example.com',
      raw: { source: 'mock' },
    });
    assert.equal(lead.email, null);
    assert.equal(lead.raw?.emailSource, 'mock');
  });
});
