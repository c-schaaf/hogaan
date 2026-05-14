# Hogaan Web App — Visual Prototypes

Static HTML mockups of the Hogaan web app screens. Built for design review with Hamse before backend wiring.

## How to preview

Just open any `.html` file in a browser. No build step, no server. Files are self-contained (Tailwind via CDN, Google Fonts).

```
# Easiest — double-click to open in default browser
prototypes/index.html
```

Or serve them locally if you want hot-reload:

```
npx serve prototypes
```

Then visit `http://localhost:3000`.

## Screen index

| File           | What it is                                                     |
| -------------- | -------------------------------------------------------------- |
| `index.html`   | Preview navigation — links to all screens                      |
| `landing.html` | Public homepage at hogaan.com — hero + email signup            |
| `signup.html`  | "Check your inbox" magic-link confirmation                     |
| `onboard.html` | Consent + 12-practice picker (the time-to-value path)          |
| `home.html`    | Signed-in home — greeting, input, suggestions, recent sessions |
| `chat.html`    | Coaching session view with real Hamse-arc response             |

## Design system

Defined in `_tokens.css` (loaded by each screen via Tailwind config). Summary:

| Token           | Value     | Use                                          |
| --------------- | --------- | -------------------------------------------- |
| `hogaan-bg`     | `#FAF6F1` | Cream — warm base background                 |
| `hogaan-text`   | `#0A1F4D` | Deep navy — primary text + structure         |
| `hogaan-accent` | `#C49B4A` | Gold — accents, CTAs, highlights             |
| `hw-navy`       | `#00004D` | Hamse Warfa parent-brand navy (bridge color) |
| `hw-blue`       | `#0086FF` | Hamse Warfa blue (attribution moments only)  |

**Fonts:** Fraunces (serif, for "Hogaan" wordmark + headings), Inter (sans, for body + UI).

## Iterate

Send Hamse screenshots. Capture feedback. Edit the HTML directly. When approved → I convert to Eta templates and wire into the Fastify backend.

## What's hard-coded in these mockups

- All copy and sample data is illustrative — names ("Khadija"), session titles, suggestion chips
- The Hamse-arc coaching response in `chat.html` is a fresh sample showing the bot's actual capability post-Khadija-UX-Reframe (Insight + Action, no clarifier-only)
- **English-only across all screens.** Somali/bilingual UX is deferred to a later release. v1 audience is English-speaking professionals.

## Not yet in mockups (build phase)

- Real auth flow (magic-link via Resend)
- Real user data
- Crisis routing visible UI (will surface inline when triage fires)
- Sessions/Growth/Profile tabs (placeholders in bottom nav for now)
