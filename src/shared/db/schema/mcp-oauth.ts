import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.js';

/**
 * P3.1b — one row per assistant a leader connected with "Sign in with
 * Hogaan" (MCP OAuth). Revoking the row ends the connection: every access
 * and refresh token names its grant and is checked against this table.
 * Only hashes of client ids and refresh-token ids are stored.
 */
export const mcpOAuthGrants = pgTable('mcp_oauth_grants', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** sha256 of the OAuth client_id. */
  clientKey: text('client_key').notNull(),
  /** Display name the client gave, shown on Profile. */
  clientName: text('client_name').notNull(),
  /** Host the leader was sent back to (e.g. claude.ai), shown on Profile. */
  redirectHost: text('redirect_host').notNull(),
  scope: text('scope').notNull(),
  /** The authorization code's id: unique, so a code can be exchanged once. */
  codeJti: text('code_jti').notNull(),
  /** sha256 of the current refresh token's id (rotated on every refresh). */
  refreshJtiHash: text('refresh_jti_hash').notNull(),
  /** sha256 of the previous refresh token's id, kept briefly for a benign retry. */
  prevRefreshJtiHash: text('prev_refresh_jti_hash'),
  rotatedAt: timestamp('rotated_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});
