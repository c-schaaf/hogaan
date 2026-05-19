import { describe, expect, it } from 'vitest';
import { buildUserProfileBlock } from '../../src/prompt-assembly/blocks.js';

describe('buildUserProfileBlock — experience band preferred over role', () => {
  it('emits Experience and omits Role when experienceBand is present', () => {
    const block = buildUserProfileBlock({
      role: 'Leader',
      experienceBand: '5-10',
    });
    expect(block).toContain('Experience: 5-10 years');
    expect(block).not.toContain('Role: Leader');
  });

  it('falls back to Role when no experienceBand is present', () => {
    const block = buildUserProfileBlock({ role: 'Leader' });
    expect(block).toContain('Role: Leader');
    expect(block).not.toContain('Experience:');
  });

  it('renders <5 band as "Less than 5 years" prose form', () => {
    const block = buildUserProfileBlock({ experienceBand: '<5' });
    expect(block).toContain('Experience: Less than 5 years');
  });

  it('renders 10+ band as "Over 10 years" prose form', () => {
    const block = buildUserProfileBlock({ experienceBand: '10+' });
    expect(block).toContain('Experience: Over 10 years');
  });
});

// SCRUM-48 — onboarding-selected practices must be piped into the LLM profile
// block. Without this, the personalization promise of the 12-practice
// selection at onboarding never reaches the model.
describe('SCRUM-48 — buildUserProfileBlock renders mappedPractices', () => {
  it('renders all selected practices on a comma-separated Focus practices line', () => {
    const block = buildUserProfileBlock({
      experienceBand: '5-10',
      mappedPractices: ['integrity', 'empathy'],
    });
    // Practices are stored lowercase as PracticeTag tokens but rendered
    // Title-cased so the LLM reads them as concept names per the AC example.
    expect(block).toContain('Focus practices: Integrity, Empathy');
  });

  it('omits the Focus practices line entirely when mappedPractices is empty', () => {
    const block = buildUserProfileBlock({
      experienceBand: '5-10',
      mappedPractices: [],
    });
    expect(block).not.toContain('Focus practices:');
  });
});
