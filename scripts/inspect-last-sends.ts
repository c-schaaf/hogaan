import 'dotenv/config';
import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '../src/shared/db/client.js';
import { hashPhone } from '../src/shared/db/encryption.js';
import { users } from '../src/shared/db/schema/users.js';
import { whatsappMessages } from '../src/shared/db/schema/whatsapp-messages.js';
import { loadConfig } from '../src/shared/secrets/config.js';

/**
 * Inspect the most recent outbound whatsapp_messages rows for a given phone.
 * Used after the Phase 8 verifier to read back exactly what text was sent.
 *
 *   pnpm exec tsx scripts/inspect-last-sends.ts +254768316220 [N]
 */

async function main(): Promise<void> {
  const phone = process.argv[2];
  const limit = Number(process.argv[3] ?? '5');
  if (phone === undefined) {
    throw new Error('phone required as first arg');
  }
  const config = loadConfig();
  const { db, close } = getDb(config);
  const ph = hashPhone(phone);
  const u = await db.select({ id: users.id }).from(users).where(eq(users.phoneHash, ph)).limit(1);
  if (u[0] === undefined) {
    console.log('no user for', phone);
    await close();
    return;
  }
  const rows = await db
    .select({
      createdAt: whatsappMessages.createdAt,
      callerProcessId: whatsappMessages.callerProcessId,
      status: whatsappMessages.status,
      terminalEndEvent: whatsappMessages.terminalEndEvent,
      contentText: whatsappMessages.contentText,
      metadata: whatsappMessages.metadata,
    })
    .from(whatsappMessages)
    .where(
      and(
        eq(whatsappMessages.userId, u[0].id),
        eq(whatsappMessages.direction, 'outbound'),
      ),
    )
    .orderBy(desc(whatsappMessages.createdAt))
    .limit(limit);
  for (const r of rows) {
    console.log('---');
    console.log('createdAt    ', r.createdAt.toISOString());
    console.log('caller       ', r.callerProcessId);
    console.log('status       ', r.status, '/', r.terminalEndEvent);
    console.log('metadata     ', JSON.stringify(r.metadata));
    console.log('contentText  :');
    console.log(r.contentText ?? '(null)');
  }
  await close();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
