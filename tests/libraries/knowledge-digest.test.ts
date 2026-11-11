import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assemblePrompt } from '../../src/prompt-assembly/index.js';
import { promptTemplatesV2Unified, publishLibraryVersion } from '../../src/libraries/index.js';
import {
  KNOWLEDGE_DIGEST_PLACEHOLDER,
  resetDigestCacheForTests,
} from '../../src/libraries/knowledge-digest.js';
import { resetResolverForTests } from '../../src/libraries/resolver.js';
import type { EmbeddedDb } from '../../src/shared/db/embedded.js';
import { demoTestConfig, embeddedTestDb } from '../helpers/embedded.js';

let edb: EmbeddedDb;
const config = demoTestConfig();
const payload = {
  responseMode: 'FullCoachingResponse' as const,
  userMessage: 'hello',
  userProfile: {},
  sessionTurns: [],
  retrievedMemories: [],
};

beforeAll(async () => {
  edb = await embeddedTestDb();
  await publishLibraryVersion(edb.db, {
    libraryName: 'prompt_templates',
    version: 't',
    payload: promptTemplatesV2Unified,
    publishedBy: 't',
    makeActive: true,
  });
}, 60_000);
afterAll(async () => edb.close());
beforeEach(() => {
  resetDigestCacheForTests();
  resetResolverForTests();
});

describe('P1.4 knowledge digest mechanism', () => {
  it('the placeholder is never injected', async () => {
    await publishLibraryVersion(edb.db, {
      libraryName: 'knowledge_digest',
      version: 'placeholder',
      payload: KNOWLEDGE_DIGEST_PLACEHOLDER,
      publishedBy: 't',
      makeActive: true,
    });
    const b = await assemblePrompt(config, edb.db, payload, { awaitLogWrite: true });
    expect(b.assembledPrompt).not.toContain('PLACEHOLDER');
  });

  it('an approved digest goes into the cached, trusted static block; not when the flag is off', async () => {
    await publishLibraryVersion(edb.db, {
      libraryName: 'knowledge_digest',
      version: 'approved-test',
      payload: {
        status: 'approved',
        approvedBy: 'Test approver',
        text: 'DIGEST-TEXT',
        excerpts: [],
      },
      publishedBy: 't',
      makeActive: true,
    });
    const b = await assemblePrompt(config, edb.db, payload, { awaitLogWrite: true });
    expect(b.systemBlocks![0]!.text).toContain('DIGEST-TEXT');
    expect(b.systemBlocks![0]!.cache).toBe(true);
    expect(b.systemBlocks![0]!.trusted).toBe(true);

    resetDigestCacheForTests();
    const off = await assemblePrompt(demoTestConfig({ features: {} }), edb.db, payload, {
      awaitLogWrite: true,
    });
    expect(off.assembledPrompt).not.toContain('DIGEST-TEXT');
  });
});
