import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { coachOnce } from '../coaching/engine.js';
import { getApprovedDigest } from '../libraries/knowledge-digest.js';
import { renderBriefBlock } from '../leader-context/render.js';
import { appendLine, getBrief } from '../leader-context/store.js';
import {
  cleanMomentText,
  createMoment,
  getMoment,
  listMoments,
  recordOutcome,
  renderMomentsBlock,
} from '../moments/store.js';
import type { Database } from '../shared/db/client.js';
import { isEnabled } from '../shared/flags/index.js';
import type { AppConfig } from '../shared/secrets/config.js';

/**
 * P3 — the Hogaan MCP server. One stateless server instance per request,
 * bound to the leader the bearer token belongs to.
 *
 * Tools (P3.2):
 *   get_leader_context     the brief + upcoming moments
 *   coach                  Hogaan's own engine on a situation -> Hogaan's reply
 *   get_practice_guidance  short excerpts of the framework (D6)
 *   log_moment / log_outcome / save_note   write back into Hogaan
 * Prompts (P3.3): prep_next_meeting, review_draft_tone, manage_up.
 *
 * P3.4: `audit(tool)` runs BEFORE each tool body and is fail-closed — if the
 * audit row cannot be written the tool returns an error and does nothing.
 * Every write goes through the same D2 PII filter as the app (createMoment,
 * appendLine and recordOutcome all filter).
 *
 * Tool descriptions and prompt texts are ENGINEERING PLACEHOLDERS, flagged
 * for the founder's review (they shape how other assistants present Hogaan).
 */

export interface McpDeps {
  config: AppConfig;
  db: Database;
  userId: string;
  audit: (tool: string) => Promise<void>;
}

const PRACTICES: [string, string][] = [
  ['Purpose', 'Self'],
  ['Integrity', 'Self'],
  ['Accountability', 'Self'],
  ['Dignity', 'Team'],
  ['Empathy', 'Team'],
  ['Inclusion', 'Team'],
  ['Assets', 'Organization'],
  ['Innovation', 'Organization'],
  ['Prosperity', 'Organization'],
  ['Humility', 'Community'],
  ['Peace', 'Community'],
  ['Democracy', 'Community'],
];

/** D6 — at most 2 excerpts per request, each at most this many characters. */
export const MAX_EXCERPTS = 2;
export const MAX_EXCERPT_CHARS = 600;

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });
const fail = (t: string) => ({ content: [{ type: 'text' as const, text: t }], isError: true });

async function guarded<T>(
  deps: McpDeps,
  tool: string,
  body: () => Promise<T>,
): Promise<T | ReturnType<typeof fail>> {
  try {
    await deps.audit(tool);
  } catch {
    return fail(
      'Hogaan could not record this request, so it was not carried out. Please try again.',
    );
  }
  return body();
}

export function buildMcpServer(deps: McpDeps): McpServer {
  const { config, db, userId } = deps;
  const server = new McpServer({ name: 'hogaan', version: '0.1.0' });

  server.registerTool(
    'get_leader_context',
    {
      title: 'Get leader context',
      description:
        'Returns what Hogaan knows about this leader (role, team, goals, recent notes, upcoming moments). Use it before helping them prepare for a conversation. The leader can see and edit all of it in Hogaan.',
      inputSchema: {},
    },
    () =>
      guarded(deps, 'get_leader_context', async () => {
        const parts: string[] = [];
        if (isEnabled(config, 'leaderBrief')) {
          parts.push(renderBriefBlock(await getBrief(config, db, userId)));
        }
        if (isEnabled(config, 'moments')) {
          parts.push(renderMomentsBlock(await listMoments(config, db, userId)));
        }
        const out = parts.filter((p) => p.length > 0).join('\n\n');
        return text(out.length > 0 ? out : 'Hogaan does not have any context for this leader yet.');
      }),
  );

  server.registerTool(
    'coach',
    {
      title: 'Coach with Hogaan',
      description:
        "Ask Hogaan, a leadership coach, about a situation. Returns Hogaan's own coaching reply, in its own voice, using what it knows about this leader. Pass the situation in the leader's words plus any relevant details (a meeting description, a draft). Relay the reply to the leader as Hogaan's.",
      inputSchema: { situation: z.string().min(1).max(4500) },
    },
    ({ situation }) =>
      guarded(deps, 'coach', async () => {
        const r = await coachOnce(config, db, userId, situation);
        return text(r.text);
      }),
  );

  server.registerTool(
    'get_practice_guidance',
    {
      title: 'Get practice guidance',
      description:
        "Short excerpts from Hogaan's twelve-practice transformational leadership framework relevant to a situation. Optionally name a practice.",
      inputSchema: {
        situation: z.string().min(1).max(2000),
        practice: z.string().max(40).optional(),
      },
    },
    ({ situation, practice }) =>
      guarded(deps, 'get_practice_guidance', async () => {
        const digest = isEnabled(config, 'knowledgeDigest') ? await getApprovedDigest(db) : null;
        if (digest === null || digest.excerpts.length === 0) {
          return text(
            [
              'The twelve practices of transformational leadership, by arena:',
              ...PRACTICES.map(([p, a]) => `- ${p} (${a})`),
              '',
              'Detailed guidance is not available through this connection yet. Use the `coach` tool for help with a specific situation.',
            ].join('\n'),
          );
        }
        const words = new Set(
          situation
            .toLowerCase()
            .split(/\W+/)
            .filter((w) => w.length > 3),
        );
        const scored = digest.excerpts
          .map((e) => ({
            e,
            score:
              (practice !== undefined && e.practice.toLowerCase() === practice.toLowerCase()
                ? 100
                : 0) +
              e.text
                .toLowerCase()
                .split(/\W+/)
                .filter((w) => words.has(w)).length,
          }))
          .sort((a, b) => b.score - a.score)
          .slice(0, MAX_EXCERPTS);
        return text(
          scored
            .map(({ e }) => `${e.practice}: ${e.text.slice(0, MAX_EXCERPT_CHARS)}`)
            .join('\n\n'),
        );
      }),
  );

  server.registerTool(
    'log_moment',
    {
      title: 'Log an upcoming moment',
      description:
        'Tell Hogaan about an upcoming conversation the leader is preparing for, so Hogaan can check in afterwards. Describe the other person by role ("my director"), never by name. `when` is an ISO 8601 date-time if known.',
      inputSchema: {
        what: z.string().min(1).max(160),
        with_whom: z.string().max(60).optional(),
        when: z.string().max(40).optional(),
      },
    },
    ({ what, with_whom, when }) =>
      guarded(deps, 'log_moment', async () => {
        if (!isEnabled(config, 'moments'))
          return fail('Moments are not turned on for this account.');
        const d = when !== undefined ? new Date(when) : null;
        const m = await createMoment(config, db, userId, {
          what,
          withWhom: with_whom ?? null,
          happensAt: d !== null && !Number.isNaN(d.getTime()) ? d : null,
          source: 'assistant',
        });
        return text(
          m === null
            ? 'Hogaan already has this moment.'
            : `Saved. Moment id: ${m.id}. It now appears in the leader's Moments in Hogaan.`,
        );
      }),
  );

  server.registerTool(
    'log_outcome',
    {
      title: 'Log how a moment went',
      description:
        'Record how a conversation went (well, mixed or hard) and what the leader would do differently. Pass moment_id from log_moment or get_leader_context if known; otherwise describe it in `what`.',
      inputSchema: {
        how_it_went: z.enum(['well', 'mixed', 'hard']),
        moment_id: z.string().uuid().optional(),
        what: z.string().max(160).optional(),
        differently: z.string().max(500).optional(),
      },
    },
    ({ how_it_went, moment_id, what, differently }) =>
      guarded(deps, 'log_outcome', async () => {
        if (!isEnabled(config, 'moments'))
          return fail('Moments are not turned on for this account.');
        let id = moment_id ?? null;
        if (id !== null && (await getMoment(config, db, userId, id)) === null) id = null;
        if (id === null) {
          if (what === undefined) return fail('Pass moment_id or describe the moment in `what`.');
          const m = await createMoment(config, db, userId, { what, source: 'assistant' });
          id = m?.id ?? null;
          if (id === null) {
            const wanted = cleanMomentText(what).toLowerCase();
            const existing = (await listMoments(config, db, userId))
              .filter((x) => x.status === 'upcoming' && x.outcome === null)
              .find((x) => x.what.toLowerCase() === wanted);
            id = existing?.id ?? null;
          }
        }
        if (id === null) return fail('Could not find or create that moment.');
        await recordOutcome(config, db, userId, id, {
          howItWent: how_it_went,
          ...(differently !== undefined ? { differently } : {}),
        });
        return text('Saved. Hogaan will bring this into the next conversation.');
      }),
  );

  server.registerTool(
    'save_note',
    {
      title: 'Save a note to Hogaan',
      description:
        "Save one short insight about the leader to Hogaan (an insight in your own words, never a copy of an email or transcript). kind: 'goal', 'note' or 'profile'. The leader sees it and can delete it.",
      inputSchema: {
        text: z.string().min(1).max(240),
        kind: z.enum(['goal', 'note', 'profile']).default('note'),
      },
    },
    ({ text: note, kind }) =>
      guarded(deps, 'save_note', async () => {
        if (!isEnabled(config, 'leaderBrief'))
          return fail('Notes are not turned on for this account.');
        const doc = kind === 'goal' ? 'goals' : kind === 'profile' ? 'profile' : 'notes';
        const line = await appendLine(config, db, userId, doc, note, 'assistant');
        return text(
          line === null ? 'Nothing to save.' : 'Saved to what Hogaan knows about the leader.',
        );
      }),
  );

  // ---- P3.3 ready-made prompts --------------------------------------------
  server.registerPrompt(
    'prep_next_meeting',
    {
      title: 'Prepare me for my next meeting',
      description: 'Use your calendar to find the meeting, then get Hogaan coaching for it.',
      argsSchema: { meeting: z.string().optional() },
    },
    ({ meeting }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Help me prepare for ${meeting ?? 'my next meeting'}. Look it up in my calendar if you can. Then call Hogaan's get_leader_context tool, call log_moment for the meeting (describe people by role, not name), and call Hogaan's coach tool with the meeting's purpose and what I want from it. Give me Hogaan's coaching as Hogaan's words.`,
          },
        },
      ],
    }),
  );
  server.registerPrompt(
    'review_draft_tone',
    {
      title: 'Review the tone of this draft',
      description: 'Ask Hogaan how a draft message will land.',
      argsSchema: { draft: z.string() },
    },
    ({ draft }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Call Hogaan's coach tool with this situation: "I am about to send the draft below. How is it likely to land, and what do I want the other person to feel?" Include the draft. Do not rewrite it for me unless I ask; keep the words mine.\n\n${draft}`,
          },
        },
      ],
    }),
  );
  server.registerPrompt(
    'manage_up',
    {
      title: 'Help me manage up on this',
      description: 'Coaching on raising something with a manager or board.',
      argsSchema: { situation: z.string() },
    },
    ({ situation }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Call Hogaan's get_leader_context tool, then its coach tool with: "I need to manage up on this: ${situation}"`,
          },
        },
      ],
    }),
  );

  return server;
}
