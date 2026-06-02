import { describe, expect, it } from 'vitest';
import { validateInputPayload } from '../../src/prompt-assembly/validate.js';
import { PromptAssemblyError, type InputPayload } from '../../src/prompt-assembly/types.js';

/**
 * validateInputPayload — one test per throw branch + a happy-path round-trip.
 * The function is synchronous and pure, so no mocks required. Every error
 * case must surface PromptAssemblyError with code 'E5_MalformedInput' so
 * the dispatching layer can map it to the right end-event.
 */

function happyPayload(): InputPayload {
  return {
    responseMode: 'FullCoachingResponse',
    userMessage: 'a real message',
    userProfile: { experienceBand: '5-10' },
    retrievedMemories: [],
    sessionTurns: [],
  };
}

describe('validateInputPayload — error branches throw E5_MalformedInput', () => {
  it('throws when userMessage is empty string', () => {
    const payload: InputPayload = { ...happyPayload(), userMessage: '' };
    let caught: unknown;
    try {
      validateInputPayload(payload);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PromptAssemblyError);
    expect((caught as PromptAssemblyError).endEvent).toBe('E5_MalformedInput');
  });

  it('throws when userMessage is non-string', () => {
    const payload = { ...happyPayload(), userMessage: 123 as unknown as string };
    let caught: unknown;
    try {
      validateInputPayload(payload);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PromptAssemblyError);
    expect((caught as PromptAssemblyError).endEvent).toBe('E5_MalformedInput');
  });

  it('throws when retrievedMemories is non-array', () => {
    const payload = {
      ...happyPayload(),
      retrievedMemories: 'not-an-array' as unknown as InputPayload['retrievedMemories'],
    };
    let caught: unknown;
    try {
      validateInputPayload(payload);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PromptAssemblyError);
    expect((caught as PromptAssemblyError).endEvent).toBe('E5_MalformedInput');
  });

  it('throws when sessionTurns is non-array', () => {
    const payload = {
      ...happyPayload(),
      sessionTurns: { not: 'an array' } as unknown as InputPayload['sessionTurns'],
    };
    let caught: unknown;
    try {
      validateInputPayload(payload);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PromptAssemblyError);
    expect((caught as PromptAssemblyError).endEvent).toBe('E5_MalformedInput');
  });

  it('throws when userProfile is null', () => {
    const payload = {
      ...happyPayload(),
      userProfile: null as unknown as InputPayload['userProfile'],
    };
    let caught: unknown;
    try {
      validateInputPayload(payload);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PromptAssemblyError);
    expect((caught as PromptAssemblyError).endEvent).toBe('E5_MalformedInput');
  });

  it('throws when userProfile is a non-object primitive (string)', () => {
    const payload = {
      ...happyPayload(),
      userProfile: 'not-an-object' as unknown as InputPayload['userProfile'],
    };
    let caught: unknown;
    try {
      validateInputPayload(payload);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PromptAssemblyError);
    expect((caught as PromptAssemblyError).endEvent).toBe('E5_MalformedInput');
  });
});

describe('validateInputPayload — happy path', () => {
  it('returns the payload narrow-typed unchanged when every field is well-formed', () => {
    const payload = happyPayload();
    const result = validateInputPayload(payload);
    expect(result).toBe(payload);
    expect(result.userMessage).toBe('a real message');
    expect(result.retrievedMemories).toEqual([]);
    expect(result.sessionTurns).toEqual([]);
    expect(result.userProfile).toEqual({ experienceBand: '5-10' });
  });
});
