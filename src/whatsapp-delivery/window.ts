import { and, desc, eq } from 'drizzle-orm';
import type { Database } from '../shared/db/client.js';
import { whatsappMessages } from '../shared/db/schema/whatsapp-messages.js';

const WINDOW_HOURS = 24;
const WINDOW_MS = WINDOW_HOURS * 60 * 60 * 1000;

/**
 * Process #11 Step 4 — 24-hour customer-service-window check.
 *
 * WhatsApp Business policy: free-form (non-template) outbound messages may
 * only be sent within 24h of the most recent inbound from that user. Outside
 * that window, only pre-approved templates are allowed.
 *
 * Window status is computed against the `whatsapp_messages` log filtered to
 * direction='inbound' for the recipient. We key on phoneHash (callers pass
 * the SHA-256 of E.164) so plaintext PII never enters this query.
 *
 * Fail-open per Process #11 §4: if the inbound log query throws, treat the
 * window as OPEN. The conservative move at the *user* level is to still
 * allow the message; the failure mode worth optimizing against here is a
 * stuck queue, not a missed message.
 */
export type WindowStatus = 'open' | 'closed';

export function checkWindow(
  _db: Database,
  _phoneHash: string,
  _now: Date = new Date(),
): Promise<WindowStatus> {
  // Phone-hash-only path: Phase 6/7 will populate inbound rows joined back to
  // users via Process #12. Until then, callers without a resolved userId
  // get 'closed' — the conservative default for free-form sends.
  return Promise.resolve('closed');
}

/**
 * Variant used when the caller already has the resolved userId (the common
 * path: Coaching → Delivery passes userId through). Queries the inbound log
 * directly by user_id which is indexable.
 */
export async function checkWindowByUserId(
  db: Database,
  userId: string,
  now: Date = new Date(),
): Promise<WindowStatus> {
  try {
    const rows = await db
      .select({ lastStatusAt: whatsappMessages.lastStatusAt })
      .from(whatsappMessages)
      .where(and(eq(whatsappMessages.userId, userId), eq(whatsappMessages.direction, 'inbound')))
      .orderBy(desc(whatsappMessages.lastStatusAt))
      .limit(1);

    const last = rows[0]?.lastStatusAt;
    if (last === undefined || last === null) {
      return 'closed';
    }
    const ageMs = now.getTime() - last.getTime();
    return ageMs <= WINDOW_MS ? 'open' : 'closed';
  } catch {
    return 'open'; // fail-open per Process #11 §4
  }
}

export const _internal = { WINDOW_MS };
