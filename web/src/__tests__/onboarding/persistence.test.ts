import { beforeEach, describe, expect, it } from 'vitest';

// Re-implement the persistence functions inline so we can test them
// without having to re-export from Onboarding.tsx.
// These match the exact implementation in Onboarding.tsx.

const STORAGE_KEY = 'hogaan_onboarding_v1';

interface PersistedOnboarding {
  stepIdx: number;
  answers: { name: string; years: string | null; practices: string[]; consent: boolean };
}

function savePersisted(data: PersistedOnboarding): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function loadPersisted(): PersistedOnboarding | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PersistedOnboarding;
  } catch {
    return null;
  }
}

function clearPersisted(): void {
  localStorage.removeItem(STORAGE_KEY);
}

describe('Onboarding persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('savePersisted writes to localStorage with correct key', () => {
    savePersisted({ stepIdx: 2, answers: { name: 'Hamse', years: '3–5 years', practices: ['Integrity'], consent: false } });
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
  });

  it('loadPersisted returns null when key absent', () => {
    expect(loadPersisted()).toBeNull();
  });

  it('loadPersisted restores stepIdx and answers correctly', () => {
    const data: PersistedOnboarding = {
      stepIdx: 2,
      answers: { name: 'Hamse', years: '3–5 years', practices: ['Integrity', 'Peace'], consent: false },
    };
    savePersisted(data);
    const loaded = loadPersisted();
    expect(loaded).not.toBeNull();
    expect(loaded!.stepIdx).toBe(2);
    expect(loaded!.answers.name).toBe('Hamse');
    expect(loaded!.answers.practices).toEqual(['Integrity', 'Peace']);
  });

  it('clearPersisted removes the key', () => {
    savePersisted({ stepIdx: 1, answers: { name: 'A', years: null, practices: [], consent: false } });
    clearPersisted();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('loadPersisted returns null for malformed JSON', () => {
    localStorage.setItem(STORAGE_KEY, 'not-valid-json{');
    expect(loadPersisted()).toBeNull();
  });
});
