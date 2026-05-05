import 'dotenv/config';
import { eq, inArray, like } from 'drizzle-orm';
import { getDb } from '../src/shared/db/client.js';
import { hashPhone } from '../src/shared/db/encryption.js';
import { accessCodes } from '../src/shared/db/schema/access-codes.js';
import { crisisEvents } from '../src/shared/db/schema/crisis-events.js';
import { memories } from '../src/shared/db/schema/memories.js';
import { sessions } from '../src/shared/db/schema/sessions.js';
import { turns } from '../src/shared/db/schema/turns.js';
import { users } from '../src/shared/db/schema/users.js';
import { whatsappMessages } from '../src/shared/db/schema/whatsapp-messages.js';
import { loadConfig } from '../src/shared/secrets/config.js';

/**
 * Reverses scripts/seed-realistic-cohort-data.ts. Removes ALL synthetic
 * users in the +254700000001..+254700000060 phone range and every row
 * that hangs off them (sessions, turns, memories, whatsapp_messages,
 * crisis_events).
 *
 * Safety:
 *   - Operates ONLY on phone hashes computed from the +254700000xxx range.
 *     A user with a real phone outside that range cannot be touched.
 *   - audit_log rows would block user deletion via the append-only trigger.
 *     Synthetic users are inserted directly without going through Process #12,
 *     so they have no audit_log entries — DELETE on users will not trigger
 *     SET NULL on audit_log.user_id.
 *   - Order respects FKs:
 *     1. crisis_events (FK userId set null on delete; we DELETE rows)
 *     2. memories (FK userId cascade; explicit delete is fine)
 *     3. whatsapp_messages (FK userId set null on delete; DELETE rows)
 *     4. sessions (cascades turns)
 *     5. users
 *
 * Run BEFORE Phase A goes live with real users to leave a clean slate.
 */

const PHONE_PREFIX = '+25470000';
const PHONE_FIRST_INDEX = 1;
const USER_COUNT = 60;
const SEED_TAG = 'realistic-cohort-seed-v1';

function phoneFor(index: number): string {
  return `${PHONE_PREFIX}${String(index).padStart(4, '0')}`;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const { db, close } = getDb(config);

  try {
    const phones: string[] = [];
    for (let i = 0; i < USER_COUNT; i++) {
      phones.push(phoneFor(PHONE_FIRST_INDEX + i));
    }
    const phoneHashes = phones.map((p) => hashPhone(p));

    console.log(
      `looking up synthetic users in phone range ${phoneFor(PHONE_FIRST_INDEX)}..${phoneFor(PHONE_FIRST_INDEX + USER_COUNT - 1)}...`,
    );
    const userRows = await db
      .select({ id: users.id })
      .from(users)
      .where(inArray(users.phoneHash, phoneHashes));
    const userIds = userRows.map((r) => r.id);
    console.log(`  found ${userIds.length} synthetic user rows\n`);

    if (userIds.length === 0) {
      console.log('nothing to remove.');
      return;
    }

    // ----- access_codes ---------------------------------------------------
    // Codes carry a generation_note marker we set in the seed script. Delete
    // by that marker so we don't accidentally remove codes from real cohorts.
    const codeDel = await db
      .delete(accessCodes)
      .where(eq(accessCodes.generationNote, SEED_TAG))
      .returning({ id: accessCodes.id });
    console.log(`access_codes deleted: ${codeDel.length}`);

    // ----- crisis_events --------------------------------------------------
    // Two paths: rows attached to a synthetic user (most), and any rows
    // tagged with the seed marker even if the user FK has already been
    // null'd by a prior partial teardown.
    const crisisByUserDel = await db
      .delete(crisisEvents)
      .where(inArray(crisisEvents.userId, userIds))
      .returning({ id: crisisEvents.id });
    const crisisByMarkerDel = await db
      .delete(crisisEvents)
      .where(like(crisisEvents.errorReason, `${SEED_TAG}%`))
      .returning({ id: crisisEvents.id });
    console.log(
      `crisis_events deleted: ${crisisByUserDel.length} by user_id + ${crisisByMarkerDel.length} by marker`,
    );

    // ----- memories -------------------------------------------------------
    const memDel = await db
      .delete(memories)
      .where(inArray(memories.userId, userIds))
      .returning({ id: memories.id });
    console.log(`memories deleted: ${memDel.length}`);

    // ----- whatsapp_messages ---------------------------------------------
    const waDel = await db
      .delete(whatsappMessages)
      .where(inArray(whatsappMessages.userId, userIds))
      .returning({ id: whatsappMessages.id });
    console.log(`whatsapp_messages deleted: ${waDel.length}`);

    // ----- turns + sessions ----------------------------------------------
    // Sessions cascade turns, but explicit delete keeps the count visible.
    const turnDel = await db
      .delete(turns)
      .where(inArray(turns.userId, userIds))
      .returning({ id: turns.id });
    console.log(`turns deleted: ${turnDel.length}`);

    const sessDel = await db
      .delete(sessions)
      .where(inArray(sessions.userId, userIds))
      .returning({ id: sessions.id });
    console.log(`sessions deleted: ${sessDel.length}`);

    // ----- users ----------------------------------------------------------
    const userDel = await db
      .delete(users)
      .where(inArray(users.id, userIds))
      .returning({ id: users.id });
    console.log(`users deleted: ${userDel.length}`);

    console.log('\nteardown complete.');
  } finally {
    await close();
  }
}

main().catch((err: unknown) => {
  console.error('teardown-realistic-cohort-data fatal:', err);
  process.exit(1);
});
