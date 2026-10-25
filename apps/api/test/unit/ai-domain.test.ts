import { describe, expect, it } from 'vitest';
import { clip, formatSources, isIsoDate, matchPerson } from '../../src/modules/ai/domain/ai.js';
import { toAnyWordQuery } from '../../src/modules/search/domain/search.js';

const people = [
  { userId: 'u1', name: 'Dana Lee', email: 'dana@acme.com' },
  { userId: 'u2', name: 'Dana Smith', email: 'dsmith@acme.com' },
  { userId: 'u3', name: 'Sam Rivera', email: 'sam@acme.com' },
];

describe('matchPerson', () => {
  it('matches by email, full name, first name or a unique partial name', () => {
    expect(matchPerson(people, 'DANA@acme.com')).toEqual({ userId: 'u1' });
    expect(matchPerson(people, 'dana smith')).toEqual({ userId: 'u2' });
    expect(matchPerson(people, '@Sam')).toEqual({ userId: 'u3' });
    expect(matchPerson(people, 'river')).toEqual({ userId: 'u3' });
  });

  it('refuses to guess between people or invent one', () => {
    expect(matchPerson(people, 'Dana')).toEqual({ error: '"Dana" matches more than one person' });
    expect(matchPerson(people, 'Zed')).toEqual({
      error: 'No one called "Zed" can be assigned here',
    });
    // Very short fragments don't partially match.
    expect(matchPerson(people, 'le')).toHaveProperty('error');
  });
});

describe('isIsoDate', () => {
  it('accepts only real calendar dates', () => {
    expect(isIsoDate('2026-02-28')).toBe(true);
    expect(isIsoDate('2028-02-29')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2026-2-3')).toBe(false);
    expect(isIsoDate('next friday')).toBe(false);
  });
});

describe('prompt helpers', () => {
  it('clips long content with a marker', () => {
    expect(clip('short', 10)).toBe('short');
    expect(clip('a'.repeat(12), 10)).toBe(`${'a'.repeat(10)}\n[…truncated]`);
  });

  it('numbers sources for citation', () => {
    expect(
      formatSources([
        { n: 1, title: 'ENG-1 Billing', content: 'Due soon' },
        { n: 2, title: 'Launch plan', content: 'Ship it' },
      ]),
    ).toBe('[1] ENG-1 Billing\nDue soon\n\n---\n\n[2] Launch plan\nShip it');
  });
});

describe('toAnyWordQuery', () => {
  it('keeps the meaningful words of a question, matching any of them', () => {
    expect(toAnyWordQuery("What's the status of the billing migration?")).toEqual({
      prefix: 'status:* | billing:* | migration:*',
      text: 'status or billing or migration',
    });
  });

  it('returns null when nothing meaningful is left', () => {
    expect(toAnyWordQuery('what is it?')).toBeNull();
  });
});
