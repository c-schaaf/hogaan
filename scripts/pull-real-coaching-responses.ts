import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { and, asc, eq, isNotNull, like, ne, notInArray, sql } from 'drizzle-orm';
import { getDb } from '../src/shared/db/client.js';
import { decryptPlaintext, hashPhone } from '../src/shared/db/encryption.js';
import { turns } from '../src/shared/db/schema/turns.js';
import { users } from '../src/shared/db/schema/users.js';
import { loadConfig } from '../src/shared/secrets/config.js';

/**
 * Pulls every real coaching response from `turns`, EXCLUDING the synthetic
 * seed users in phone range +254700000001..+254700000060 (their phone hashes
 * are computed and excluded). Decrypts each user's first name + role + location
 * for context. Outputs a markdown blob ready to be embedded in
 * docs/voice-framework-workspace.md as Section 5.
 *
 * PII redaction: phone is omitted entirely. First name kept (as the user
 * intended that to flow into prompts). User-message and response-text are
 * passed through verbatim — Muhsin will hand-redact employer names / specific
 * people if needed during his drafting session.
 */

const SYNTHETIC_PHONE_PREFIX = '+25470000';
const SYNTHETIC_FIRST_INDEX = 1;
const SYNTHETIC_COUNT = 60;

function syntheticPhoneHashes(): string[] {
  const out: string[] = [];
  for (let i = 0; i < SYNTHETIC_COUNT; i++) {
    const phone = `${SYNTHETIC_PHONE_PREFIX}${String(SYNTHETIC_FIRST_INDEX + i).padStart(4, '0')}`;
    out.push(hashPhone(phone));
  }
  return out;
}

interface RealTurn {
  createdAt: Date;
  userMessage: string;
  responseText: string | null;
  practiceTag: string | null;
  levelTag: string | null;
  intent: string | null;
  responseMode: string | null;
  modelUsed: string | null;
  qaOutcome: string | null;
  libraryVersions: unknown;
  firstName: string | null;
  role: string | null;
  location: string | null;
  isDiaspora: boolean;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const { db, close } = getDb(config);
  const synthetic = syntheticPhoneHashes();
  try {
    const rows = await db
      .select({
        createdAt: turns.createdAt,
        userMessage: turns.userMessage,
        responseText: turns.responseText,
        practiceTag: turns.practiceTag,
        levelTag: turns.levelTag,
        intent: turns.intent,
        responseMode: turns.responseMode,
        modelUsed: turns.modelUsed,
        qaOutcome: turns.qaOutcome,
        libraryVersions: turns.libraryVersions,
        firstNameEncrypted: users.firstNameEncrypted,
        role: users.role,
        location: users.location,
        isDiaspora: users.isDiaspora,
        phoneHash: users.phoneHash,
      })
      .from(turns)
      .innerJoin(users, eq(users.id, turns.userId))
      .where(
        and(
          notInArray(users.phoneHash, synthetic),
          isNotNull(turns.responseText),
          ne(turns.userMessage, 'synthetic'),
          ne(turns.responseText, 'synthetic response'),
        ),
      )
      .orderBy(asc(turns.createdAt));

    const real: RealTurn[] = rows.map((r) => {
      let firstName: string | null = null;
      if (r.firstNameEncrypted !== null) {
        try {
          firstName = decryptPlaintext(config, r.firstNameEncrypted);
        } catch {
          firstName = null;
        }
      }
      const dateValue = r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt);
      return {
        createdAt: dateValue,
        userMessage: r.userMessage,
        responseText: r.responseText,
        practiceTag: r.practiceTag,
        levelTag: r.levelTag,
        intent: r.intent,
        responseMode: r.responseMode,
        modelUsed: r.modelUsed,
        qaOutcome: r.qaOutcome,
        libraryVersions: r.libraryVersions,
        firstName,
        role: r.role,
        location: r.location,
        isDiaspora: r.isDiaspora,
      };
    });

    console.log(`real coaching turns found: ${real.length}`);
    if (real.length === 0) {
      console.log(
        '(no production coaching turns yet outside the synthetic seed range — Section 5 will be empty/placeholder)',
      );
    }

    // Emit a markdown chunk ready to paste into Section 5.
    const lines: string[] = [];
    if (real.length === 0) {
      lines.push('_No production coaching turns recorded outside the synthetic seed range yet._');
      lines.push('');
      lines.push(
        '_When real Phase A users start coaching, this section auto-populates on re-run of `pnpm exec tsx scripts/pull-real-coaching-responses.ts`._',
      );
    } else {
      for (const t of real) {
        lines.push(`### Turn at ${t.createdAt.toISOString()}`);
        lines.push('');
        const ctx: string[] = [];
        if (t.firstName !== null) {
          ctx.push(`**User**: ${t.firstName}`);
        }
        if (t.role !== null) {
          ctx.push(`Role: ${t.role}`);
        }
        if (t.location !== null) {
          ctx.push(`Location: ${t.location}`);
        }
        ctx.push(`Diaspora: ${t.isDiaspora ? 'yes' : 'no'}`);
        lines.push(ctx.join(' · '));
        lines.push('');
        const tags: string[] = [];
        if (t.practiceTag !== null) {
          tags.push(`practice=${t.practiceTag}`);
        }
        if (t.levelTag !== null) {
          tags.push(`level=${t.levelTag}`);
        }
        if (t.intent !== null) {
          tags.push(`intent=${t.intent}`);
        }
        if (t.responseMode !== null) {
          tags.push(`mode=${t.responseMode}`);
        }
        if (t.qaOutcome !== null) {
          tags.push(`qa=${t.qaOutcome}`);
        }
        if (t.modelUsed !== null) {
          tags.push(`model=${t.modelUsed}`);
        }
        const lv = t.libraryVersions;
        if (lv !== null && typeof lv === 'object') {
          const lvObj = lv as Record<string, unknown>;
          for (const key of ['voiceRules', 'culturalFraming', 'promptTemplates']) {
            const entry = lvObj[key];
            if (entry !== undefined && entry !== null && typeof entry === 'object') {
              const v = (entry as { version?: unknown }).version;
              if (typeof v === 'string') {
                tags.push(`${key}=${v}`);
              }
            }
          }
        }
        if (tags.length > 0) {
          lines.push(`Tags: \`${tags.join(' · ')}\``);
          lines.push('');
        }
        lines.push('**User message:**');
        lines.push('');
        lines.push('> ' + t.userMessage.split('\n').join('\n> '));
        lines.push('');
        lines.push('**Bot response:**');
        lines.push('');
        const respText = t.responseText ?? '_(empty)_';
        lines.push(respText);
        lines.push('');
        lines.push('---');
        lines.push('');
      }
    }

    const outPath = path.resolve('docs/voice-framework-section-5.md');
    writeFileSync(outPath, lines.join('\n'), 'utf8');
    console.log(`wrote ${outPath}`);
  } finally {
    await close();
  }
}

main().catch((err: unknown) => {
  console.error('pull-real-coaching-responses fatal:', err);
  process.exit(1);
});

// Reference imports kept to silence "unused" while leaving the SQL builder
// vocabulary visible for any future query refinement.
void like;
void sql;
