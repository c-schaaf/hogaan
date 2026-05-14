# Hogaan — Bug Hunt Chunk 5: Profile

## Your role

Senior QA engineer doing exploratory testing. Find and document bugs — do NOT fix anything.

You look for: fields that don't persist after save, stale data shown after navigation, cross-feature inconsistency (e.g., practices shown in chat vs. profile), and inputs with no validation.

## The product

Hogaan is a React SPA. Profile data is stored in a `users` table. `/api/profile` GET returns the current user record; `PATCH /api/profile` updates it. Fields: `fullName`, `mappedPractices` (array of 3 practice names), `commStyle` (`direct | warm`), `responseDepth` (`quick | standard | deep`).

## Test account

- **Email:** `test@gmail.com` / **Password:** `test123` (fully onboarded)

## What's deliberately disabled — DO NOT FLAG

- Coaching quality, tagger, streaming latency — all expected.

## Scope for THIS chunk: Profile screen only

**In scope:** profile view, editing all fields, data persistence, cross-feature consistency (practices visible in chat), sign-out from profile, account deletion UI (document — do NOT confirm deletion on the shared test account).

**Out of scope:** auth login/signup (Chunk 2), chat streaming (Chunk 3), sessions list (Chunk 4), SPA routing (Chunk 6).

---

## Journeys

### Journey 1 — Profile view

1. Sign in. Navigate to Profile (bottom nav or sidebar icon).
2. Check all fields are present and populated:
   - Full name (should not be blank or "null")
   - Email (should show `test@gmail.com` — editable or read-only?)
   - Mapped practices: 3 practices listed
   - Communication style: one of `direct` or `warm` visually selected
   - Response depth: one of `quick`, `standard`, `deep` visually selected
3. Is any field showing `null`, `undefined`, or blank where a value should exist?
4. Note: is there a sign-out button? An account deletion option?

### Journey 2 — Edit full name and persist

1. Note the current name displayed.
2. Edit the name to: *"QA Test Rename"*
3. Save (button or auto-save — whichever the UI provides).
4. **Verify persistence:** navigate to Home. Does the greeting use *"QA Test Rename"*?
5. Navigate back to Profile. Is the name still "QA Test Rename"?
6. Refresh the page (F5). Is the name still shown?
7. **Restore:** change back to the original name and save.
8. Note: cancel/undo behaviour — is there a cancel button before saving?

### Journey 3 — Edit mapped practices

1. Note the current 3 practices selected.
2. Deselect one practice and select a different one.
3. Save.
4. **Verify cross-feature consistency:**
   - Navigate to Chat (start a new chat). Does the chat header/sidebar show the updated practices, or the old ones?
5. Navigate back to Profile. Are the new practices still shown?
6. Refresh (F5). Practices still correct?
7. **Restore** to original selection.
8. Does the UI enforce exactly 3? Can you select 2 or 4? What happens?

### Journey 4 — Edit communication style

1. Note current comm style (direct / warm).
2. Toggle to the other option.
3. Save.
4. Navigate to Home, then back to Profile.
5. **Expected:** toggled value shown, not reverted.
6. Restore.

### Journey 5 — Edit response depth

1. Note current depth (quick / standard / deep).
2. Select a different depth.
3. Save.
4. Refresh the page (F5).
5. **Expected:** new depth value shown.
6. Restore.

### Journey 6 — Sign out from Profile

1. On Profile, click the sign-out button.
2. **Expected:** redirected to Login immediately — not home.
3. Attempt to press the browser Back button. **Expected:** not snapped back to the Profile (authed content shouldn't be accessible after sign-out).
4. Navigate to `http://localhost:3000`. **Expected:** shows Login, not auto-signed in.
5. **Re-sign in** (`test@gmail.com` / `test123`) so the account is usable for other chunks.

### Journey 7 — Account deletion UI (document only — do NOT delete)

1. On Profile, find any "Delete account", "Close account", or "Remove my data" option.
2. Click it IF it shows a confirmation step (modal/dialog) before deleting.
3. **Document:** what confirmation UI appears? Clear wording about what's deleted? Cancel option present?
4. **Click Cancel / Back — do NOT confirm deletion.**
5. If no delete option found: document the gap.

### Adversarial — PATCH with out-of-range values

In DevTools Console, while signed in:
```js
// Get the current auth token
const { data } = await window._supabase?.auth?.getSession?.() ?? { data: { session: null } };
const token = data?.session?.access_token ?? 'no-token';
const r = await fetch('/api/profile', {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
  body: JSON.stringify({ commStyle: 'aggressive', responseDepth: 'instant' })
});
console.log(r.status, await r.json());
```
(If the supabase object isn't on `window._supabase`, find it via `window.supabase` or skip this probe and note it.)

**Expected:** 400 validation error rejecting unknown enum values — NOT 200 accepting them.

---

## Evidence to capture per finding

- **Severity:** HIGH / MEDIUM / LOW
- **Category:** persist / validation / consistency / auth / ui
- **Journey + step**
- **Repro** (60s reproducible)
- **Expected vs Actual**
- **Evidence:** PATCH request + response body, F5 result, console errors

---

## Output format

```
# Hogaan — Bug Hunt Chunk 5 Report (Profile)

**Auditor:** Claude computer-use agent
**Date:** <today>
**Build:** dev localhost:3000

## 1. Executive summary

## 2. Findings (sorted by severity)

### Finding #N — [title]
- Severity:
- Category:
- Journey / step:
- Repro:
- Expected:
- Actual:
- Evidence:

## 3. Known gaps
- Account deletion UI: present / absent (describe)
- Any other feature gaps observed

## 4. Things that worked

## 5. Out-of-scope observations (one line each)
```
