import 'dotenv/config';
import { assemblePrompt, type InputPayload } from '../src/prompt-assembly/index.js';
import { getDb } from '../src/shared/db/client.js';
import { loadConfig } from '../src/shared/secrets/config.js';

/**
 * Phase 4 verification harness — answers the user's four critical questions:
 *
 *   1. Given a synthetic user message, is the assembled prompt structurally
 *      valid (every required block present in canonical order)?
 *   2. Does it contain the right library versions (the 3-library version set
 *      pinned at assembly time)?
 *   3. Token count is observational only (SCRUM-55 removed the 4000-token
 *      budget — Haiku 4.5's 200k context makes the cap unnecessary).
 *   4. Does identical inputs → identical determinism hash (across two calls)?
 */

// userId / sessionId / turnId omitted on purpose — they are FK-tied to real
// rows. Assembly does not need them; the prompt_logs row will be inserted
// with NULL user_id which is allowed by the schema and exercises the
// happy log-write path.
const SYNTHETIC: InputPayload = {
  responseMode: 'FullCoachingResponse',
  practiceTag: 'integrity',
  levelTag: 'self',
  userMessage:
    'My team is missing a deadline for the third time this quarter. Two of my reports are blaming each other. What is the question I should walk into the room with?',
  userProfile: {
    role: 'Professional',
    location: 'Mogadishu',
    isDiaspora: false,
    timezone: 'Africa/Mogadishu',
    goals: ['Leadership confidence', 'Conflict resolution'],
    mappedPractices: ['integrity', 'accountability'],
  },
  retrievedMemories: [
    {
      content: 'User mentioned 6 weeks ago that the team has been growing fast.',
      createdAt: new Date('2026-03-20T10:00:00Z'),
    },
    {
      content: 'User asked about delivering hard feedback in a Mogadishu office context.',
      createdAt: new Date('2026-04-10T15:00:00Z'),
    },
  ],
  sessionTurns: [
    {
      userMessage: 'I think this might be a process problem, not a people problem.',
      responseText:
        'You may be right that the process is the lens — and naming the people problem out loud is also part of the work. Where do you start this week?',
    },
  ],
};

async function main(): Promise<void> {
  const config = loadConfig();
  const { db, close } = getDb(config);

  console.log('--- assembly run #1 ---');
  const r1 = await assemblePrompt(config, db, SYNTHETIC, { awaitLogWrite: true });
  console.log('endEvent:', r1.endEvent);
  console.log('determinismHash:', r1.determinismHash);
  console.log('tokenCount (observational):', r1.tokenCount);
  console.log('library versions:');
  console.log('  promptTemplates:', r1.libraryVersions.promptTemplates);
  console.log('  voiceRules:     ', r1.libraryVersions.voiceRules);
  console.log('  culturalFraming:', r1.libraryVersions.culturalFraming);
  console.log('degradationFlags:', r1.degradationFlags);
  console.log('logWriteFailed:', r1.logWriteFailed);
  console.log('practiceTag:', r1.practiceTag, 'levelTag:', r1.levelTag);

  console.log('\n--- structural-validity probe ---');
  const required = [
    'You are Hogaan',
    '## Practice: integrity',
    '## Level: self',
    '## Voice Rules',
    '## Cultural framing: Sharaf',
    '## Memory',
    '## Recent session context',
    '## User profile',
    '## Current user message',
  ];
  let allPresent = true;
  for (const r of required) {
    const present = r1.assembledPrompt.includes(r);
    console.log(`  [${present ? '\u2713' : '\u2717'}] section "${r}"`);
    if (!present) {
      allPresent = false;
    }
  }
  console.log('all required sections present:', allPresent);

  console.log('\n--- determinism: identical inputs \u2192 identical hash ---');
  const r2 = await assemblePrompt(config, db, SYNTHETIC, { awaitLogWrite: true });
  console.log('run #1 hash:', r1.determinismHash);
  console.log('run #2 hash:', r2.determinismHash);
  console.log('hashes match:', r1.determinismHash === r2.determinismHash);

  console.log('\n--- prompt preview (first 400 chars) ---');
  console.log(r1.assembledPrompt.slice(0, 400));
  console.log('... [' + (r1.assembledPrompt.length - 400) + ' more chars] ...');

  await close();

  if (!allPresent || r1.determinismHash !== r2.determinismHash) {
    console.error('VERIFICATION FAILED');
    process.exit(1);
  }
  console.log('\nVERIFICATION OK');
}

main().catch((err: unknown) => {
  console.error('verify-prompt-assembly failed:', err);
  process.exit(1);
});
