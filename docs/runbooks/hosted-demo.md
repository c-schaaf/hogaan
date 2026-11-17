# Hosted demo

A public link to the new features, for showing people. It is demo mode
(`pnpm demo`) running on a host, with two protections added: an access code
and a daily cap on AI calls.

## What it is, and is not

- **No accounts, nothing kept.** Every visitor is the same sample leader,
  "Amina". The database lives in memory and is wiped whenever the server
  restarts or is redeployed.
- **Shared.** Everyone with the link sees and changes the same data,
  including what others typed. Give the link to people you trust, and do not
  type anything sensitive.
- **Not production.** It has no connection to the live app or its data. It
  refuses to start as `NODE_ENV=production` or `staging`.
- **Real AI answers** when `ANTHROPIC_API_KEY` is set; scripted replies
  otherwise.

## Limiting what it can spend

Two layers. Use both.

1. **On the key (the hard limit).** In the Claude Console, create a new
   workspace for the demo, set a monthly spend limit on that workspace, and
   create the API key inside it. Calls stop when the limit is reached. The
   Default workspace cannot have a spend limit, so it must be a new one.
2. **In the app.** `DEMO_DAILY_MODEL_CALLS` (default 200) caps real AI calls
   per UTC day. After that the coach answers with a scripted reply that says
   the day's budget is used up. One chat message uses about two calls (the
   reply, and a session title); finishing a session uses one more, on the
   stronger background model, to update "What Hogaan knows about you".

## Access

A hosted demo will not start without `DEMO_ACCESS_CODE` (8 or more
characters). Share the link with the code in it:

    https://YOUR-DEMO-ADDRESS/?access=YOUR-CODE

Opening it once sets a cookie for 30 days. Someone who opens the bare address
sees a page asking for the code. To cut off access, change the code in the
host's settings and restart.

The MCP endpoint (`/mcp`) is not behind the access code. It has its own keys.

## Connecting an AI assistant to the demo

A key created on the demo's Profile page is stored in memory, so it stops
working whenever the demo restarts or wakes from sleep. For a hosted demo, set
`DEMO_MCP_KEY` instead (`hgn_` followed by 20 or more random characters). That
key is registered for the sample leader every time the demo starts.

Two ways to give it to an assistant:

- Address `https://YOUR-DEMO-ADDRESS/mcp`, with the request header
  `Authorization: Bearer YOUR-KEY`. This is how the real app works.
- Address `https://YOUR-DEMO-ADDRESS/mcp/key/YOUR-KEY`, with no sign-in. This
  form exists in demo mode only, for assistants whose connector form accepts
  an address and nothing else.

Either way the assistant acts as the sample leader, "Amina". Its calls to the
coach count against the daily AI-call cap. To cut off access, change
`DEMO_MCP_KEY` and redeploy.

## Memory and cost

Measured on this branch: the embedded database needs about 400 MB by itself
and the running demo about 600 MB. A 512 MB instance is killed for running out
of memory, so `render.yaml` asks for Render's Standard plan (2 GB), which is
paid. Check Render's pricing page for the current price; it is billed for the
time the service exists, so delete it when the demo is over. On a paid plan the
service does not sleep, so the shared demo data lasts until the next deploy or
restart.

The hosted demo is compiled first and started with `node dist/demo/main.js`.
`pnpm demo` (through tsx, building the web app on start) uses about 1 GB and is
meant for your own computer.

## Setting it up on Railway

Railway bills for what the service uses, so there is no plan to pick. Create an
empty service, set the variables below, set the build command to
`pnpm build:api && pnpm demo:build` and the start command to
`node dist/demo/main.js`, set the health check path to `/healthz`, then connect
the GitHub repository and branch and generate a domain. Turning on "sleep when
idle" (serverless) means it only costs money while someone is using it; the
shared demo data resets each time it wakes.

## Setting it up on Render

1. Sign in to Render and choose New > Blueprint.
2. Connect the GitHub repository and pick the branch that has `render.yaml`.
3. Enter `DEMO_ACCESS_CODE` and `ANTHROPIC_API_KEY` when asked.
4. Wait for the first deploy, then open the address with `?access=` and the
   code.

## Variables

| Variable | Meaning |
|---|---|
| `NODE_ENV` | Must be `development`. Demo mode refuses `production` and `staging`. |
| `DEMO_HOSTED` | `true` marks a public demo and makes the access code required. Also assumed when running on Render or Railway. |
| `DEMO_ACCESS_CODE` | The shared code. |
| `DEMO_DAILY_MODEL_CALLS` | Real AI calls allowed per UTC day. |
| `ANTHROPIC_API_KEY` | Optional. Without it the coach is scripted. |
| `LLM_CHAT_MODEL` | Optional. The live-chat model; defaults to the one production uses today. |
