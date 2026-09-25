# Plan review — 001 The Order Screen

Reviewed: `spec.md` (source of truth), `design.md`, `plan.md`, `tasks.md`, plus three stakeholder
decisions received after the docs were written (blocked visual, discount in cents, Vercel + Supabase).
Reviewer stance: adversarial but pragmatic; budget assumed **~1.5 days of agent work**.

## Verdict: **APPROVE WITH CHANGES**

The architecture is sound and every spec rule (R1–R9) and acceptance criterion (AC1–AC7) has a
server-side enforcement path, a DB guard where the spec demands one, and a named test. The integer
money math reproduces AC1 exactly (verified below). Three things must change before coding starts:
(1) the discount-granularity decision contradicts design/plan/tasks in four places, (2) the service
worker precache design as written would cache the login redirect as the order shell and break AC7,
and (3) the task list is a comfortable 2-day plan, not a 1.5-day one — a cut list is given.
Everything else is a targeted correction, not a redesign.

### Verified (no change needed)

- **AC1 arithmetic** — `4000×10000/206000 = 194.17 → 194 → 1.94%`, `7000×10000/162000 = 432.10 → 432`,
  `15000×10000/207000 = 724.64 → 725 → 7.25%`; classification `400,000 ≤ 618,000` sand,
  `700,000 > 486,000 ∧ ≤ 810,000` red, `1,500,000 > 1,035,000` blocked; totals
  `357,000×8,200/100 = 29,274,000` and `549,000×8,200/100 = 45,018,000`. Boundaries 3.00 % → sand,
  5.00 % → red, 5.0001 % → blocked hold under the integer comparisons. All intermediates stay below
  2^53 given the limits in plan §3 (worst case `discount×10000 ≤ 1e15`); `totalCents×rate` is BigInt.
  DB formula `(total×rate + 50)/100` with bigint truncation equals half-up for non-negative values.
- **Server authority** — role only from `users.role` looked up by JWT `sub`; unit price only from
  the `FOR SHARE` product read; `clientUnitPriceCents` is informational; approval bound to
  `(product, qty, unit price, discount)` by `approved_*` columns + trigger 4 + save-trigger equality
  + E13 `expectedTerms`; rate floor by domain (422, never clamped) + CHECKs on `orders` and
  `app_settings`; zod `strip` drops forged `role`/`approval`/`unitPriceCents`.
- **Triggers vs legitimate flows** — walked every transition: draft PUT (parent draft → guards 2/3
  pass; trigger 4 fires only when terms differ), request-approval (upsert then status change, no
  guard on `draft→pending_approval`), withdraw (only `approval_status` changes, terms untouched),
  approve/reject (terms untouched → trigger 4 no-op; `approved_has_terms` CHECK satisfied in both
  branches), save (`OLD.status='draft'` → guard 2 passes; alphabetical order puts `orders_i…` before
  `orders_v…` and `order_lines_i…` before `order_lines_v…` as the plan claims). No legitimate path is
  blocked. See M-1 for the one way the *service* could trip trigger 4 unintentionally.
- **Idempotent replay** — E10 on an already-`saved` id never touches rows: equal
  `canonicalOrderKey` (dealer, rate, ordered `(id, productId, qty, discountCents)`, price excluded
  by design) → 200 `replayed`; different → 409 `ORDER_ALREADY_SAVED`; other user's id → 404. A
  changed payload cannot be saved under an old key. A refused replay (422) rolls back and keeps
  the previous draft (or no row). Correct.
- **Supabase** — transaction pooler (6543) with `prepare: false` is right for postgres-js;
  migrations through the session pooler (5432, IPv4) is right because the direct host is IPv6-only;
  `SELECT … FOR UPDATE/FOR SHARE` inside `sql.begin()` is pinned to one backend under transaction
  pooling, so the locking story holds. Custom SQLSTATEs `OS409/OS422/OS500` are valid 5-char codes.
- **Hand-written SW instead of Serwist/next-pwa** — agreed: Next 16 builds with Turbopack and the
  plugins assume webpack; `public/sw.js` needs no bundling. The install-time precache strategy is
  the only broken part (B-2).
- **Contract consistency** — plan resolves design OQ3 (auto-return to draft) and tasks follow the
  plan; the `Rejected` list status maps to `hasRejectedLines` on a `draft`; all design copy strings
  have an API code behind them.

## Findings

| id | severity | location | problem | required change |
|---|---|---|---|---|
| B-1 | blocker | design §4.2, design OQ2, plan §7 (Discount entry), plan §11.9, tasks F2 DoD | Stakeholder decided discount input accepts **cents (up to 2 decimals)**. All four places still say "whole dollars only". (Note: the stakeholder note cites "plan §11 item 7"; item 7 is percent display and is unaffected — the discount item is **§11.9**. Flagging so the wrong item is not edited.) | Design §4.2: input is `inputmode="decimal"`, accepts `0–2` decimals, parsed with `parseUsdToCents` (already supports `"40.5"`, `"1,550.50"`), rejects `>2` decimals / non-numeric with copy *"Enter a dollar amount with up to 2 decimals."*; clamp copy uses `formatUsd` so `$X` may show cents. Plan §7 + §11.9: "UI accepts cents (2 dp); API cents". Tasks F2 DoD: replace "whole dollars" with "up to 2 decimals via `parseUsdToCents`; `4.555` rejected". Mark design OQ2 resolved. Also apply the same parser to F5 price edit (free, same component). |
| B-2 | blocker | plan §8.1 (`install` precache), §5 (`proxy.ts` redirect), tasks F8 | `sw-register.tsx` runs on every page including `/login` before login; the SW `install` handler fetches `/order`, `/orders` with the (absent) cookie, `proxy.ts` answers with a redirect to `/login`. Result: either the login HTML is cached under `/order` (served offline as the "order screen"), or, since Chromium refuses to answer a navigation with a `redirected` response, the offline load fails. Either way **AC7 fails as designed**. The regex-parse-HTML-for-`/_next/static` step is also fragile. | Replace install-time precache with **runtime caching**: on a successful navigation response for `/order`, `/orders`, `/login` (`response.ok && !response.redirected && response.type === 'basic'`) `cache.put` it; `/_next/static/*` cache-first on first request. Drop the HTML parsing. Additionally either (a) register the SW only after `GET /api/me` succeeds, or (b) exclude `/order`, `/orders` from the `proxy.ts` redirect and redirect client-side from `me` in IndexedDB. Update F8 DoD: "after one online visit of `/orders` and `/order`, both reload offline". AC7 e2e already visits online first, so this loses nothing. |
| B-3 | blocker | tasks (whole), plan §12 "Time" | 23 tasks incl. full offline stack, 6 Playwright specs "green 3 runs in a row", 2 component tests, README, deploy — realistic for 2 days, not 1.5. Playwright + SW + offline is the flakiest, most expensive item and is scheduled last, so it is what gets starved. | Cut before starting (in this order): (1) **F10**: keep `ac1-worked-example.spec` and `ac7-offline.spec` only; AC3–AC6 are fully covered by integration tests; drop "3 runs in a row". (2) **§8.3 sync triggers**: keep `online` event + app start + manual "Sync now"; drop 30 s timer, `visibilitychange`, `navigator.locks`. (3) **§8.1**: per B-2, runtime caching only. (4) **design §3.2 mobile `OrderLineCard`**: responsive table with horizontal scroll instead; drop dealer/product search (plain `<select>`), Cmd+S, "A" shortcut, Undo-toast on remove (plain remove). (5) **Component tests**: keep `RateInput.test.tsx`, drop `OrderLinesTable.test.tsx` (AC1 UI numbers are asserted in the e2e). (6) Optional if still late: E12 withdraw + "Cancel request" (spec lifecycle has no withdraw; owner decision always returns the order to draft). Keep everything on the server side — it is cheap and it is where the ACs live. |
| M-1 | major | plan §6.4 step 5, tasks B7 | "Upsert lines (`ON CONFLICT DO UPDATE`) … changed terms void approvals (service does it explicitly)". If the `DO UPDATE` set-list writes `approval_status`/`approved_*` unconditionally, **every autosave PUT voids every approval even when terms are unchanged**, breaking the AC1 approved path (adviser opens the returned draft, autosave fires, line is blocked again). | Specify: the `DO UPDATE` set-list is exactly `product_id, qty, unit_price_cents, discount_cents, position`; approval columns are never written by the upsert; voiding is left to trigger 4 (or done conditionally with `IS DISTINCT FROM`). Add to B7 DoD: "PUT with unchanged terms keeps `approval.status='approved'`". |
| M-2 | major | design §1.1, §3.2/§3.4/§3.6 wireframes, §6 icon list, design OQ1, plan §11.11 | Stakeholder accepted **grey badge + lock icon + dashed red border**. Design still says "⛔ octagon / lock", wireframes use ⛔, icon list offers `ShieldOff`/`Lock`, and both OQ1 and plan §11.11 say the question is open. | Design §1.1: icon = `Lock` (lucide), no octagon alternative; replace ⛔ with a lock glyph in wireframes; §6 icon list: `Lock` only. Mark design OQ1 and plan §11.11 **resolved**. Add to F1 DoD: "blocked badge renders `Lock` icon + 'Blocked' + dashed `danger-500` row border". |
| M-3 | major | plan §1 (Framework row), tasks B0 | "Next.js latest stable (16.x at scaffold time)" is unpinned; `proxy.ts` (vs `middleware.ts`), Turbopack default and the SW registration all depend on the exact version, and a version drift mid-build costs hours. | B0 DoD: pin the exact `next` version that `create-next-app` installs, record it in plan §1 and README; verify in B0 that the file is `src/proxy.ts` in that version (fall back to `middleware.ts` if not); note that the static `/order` shell using `useSearchParams` must be wrapped in `<Suspense>` or `next build` fails. |
| M-4 | major | tasks B11 (depends on F9), plan §10 | Deployment is the last dependency in the graph; on a 1.5-day budget it is the thing most likely to be skipped, and it is a delivery requirement (spec §9). | Make B11 two steps: **B11a** (after B10, end of Day 1): Supabase migrate + seed, Vercel deploy, `prove-server-refusal.sh` against prod — required, not "encouraged". **B11b** (after F9): redeploy. Stakeholder supplies accounts; B11a is blocked until they arrive, so ask for them at B0. |
| M-5 | major | plan §6.4 E10 refused-save rollback, §11.4, tasks B8/B10 DoD "row count = 0" | AC2 "nothing persisted" test asserts `orders` row count = 0, but the online client autosaves drafts via PUT 800 ms before Save, so the assertion only holds for a fresh id with no prior PUT. Not a bug, but the DoD is ambiguous and a developer may "fix" the test by disabling autosave. | State in B8 DoD and the curl script: "for an id that was never PUT: row count 0; for a pre-existing draft: status still `draft`, content unchanged, zero rows with `status='saved'`". Both cases are already listed in B8 — just make the two assertions explicit and separate. |
| m-1 | minor | plan §10, §12 | Supabase pooler requires TLS in practice and postgres-js does not negotiate it automatically from the bare URI; `max: 1` needlessly serialises concurrent requests inside one Vercel instance. | Client: `ssl: 'require'` when `NODE_ENV=production`; `max: 3` (transaction pooler absorbs it). Add `?sslmode=require` to `.env.example` comments. |
| m-2 | minor | tasks B3 ↔ B4 | B3's `db-guards.int.test` uses B4's `seed(db)` but B4 depends on B3. | Move `src/server/db/seed-data.ts` + `seed(db)` into B3; B4 keeps only the CLI scripts. |
| m-3 | minor | plan §8.2/§8.3, design §3.2 `pending-sync`, tasks F7/F9 | A locally saved-but-queued order ("Queued" tag) is still editable; edits replace the outbox `save` payload. Server validates the final payload so this is not a bypass, but it contradicts "saved = immutable" and can surprise the user. | F7 DoD: an order with outbox intent `save` renders read-only (`SavedOrderView` with "Queued" tag) until synced or rejected; on rejection it becomes editable again. |
| m-4 | minor | design §3.2 approved helper copy, plan §11 | Unit price is part of the approval terms, so an owner price change voids an approval on the adviser's next PUT/Save (correct per R4) — but the helper copy says only "Changing qty or discount will void this approval" and nothing tells the adviser why it happened. | Copy: "Changing qty, discount, or a price change by the owner voids this approval." Plan §11: add item "Owner price change after approval → approval voided on next sync; `priceChanges` banner + line returns to blocked; adviser re-requests." |
| m-5 | minor | design §3.4 | Still shows a **"Return to adviser"** button; plan (and F4) auto-return the order to draft after the last decision. | Update design §3.4: replace the button with the plan's "All lines decided — returned to {adviser}" message + back link. |
| m-6 | minor | plan §6.3 E8, tasks F2 | Owner may `GET` an adviser's order and open `/order?id=`; nothing says how the screen renders for a non-creator. | F2 DoD: non-creator viewer gets the read-only rendering (same as `pending_approval`), no Save/Request buttons; owner on a pending order is routed to `/approvals/[id]` (F3 already does this from the list). |
| m-7 | minor | plan §6.3 E13 `expectedTerms` | Because pending orders are read-only (PUT → 409), line terms cannot change while pending; `LINE_TERMS_CHANGED` is unreachable through the API. Harmless defence in depth (~10 lines). | Keep, but drop the dedicated e2e/int assertions beyond one "stale terms → 409" case; do not spend UI effort on the reload flow in F4 beyond a toast. |
| m-8 | minor | plan §4.1 `orders.number` | `INSERT … ON CONFLICT DO NOTHING` on every E9/E10/E11 burns an identity value per conflict → gappy order numbers. Cosmetic. | Either accept (README note) or `INSERT … WHERE NOT EXISTS`. |
| m-9 | minor | plan §1 Styling vs design §1.1 | Design gives a Tailwind v3 `tailwind.config.ts`; plan uses v4 `@theme`. Plan already notes it; tasks F1 says `@theme`. | Add a one-line `@theme` excerpt to design §1.1 so the frontend agent does not scaffold v3 config. |

## Coverage matrix (spot-check)

| Spec item | Enforced server | Enforced DB | Tested | Notes |
|---|---|---|---|---|
| R1 | E9/E10/E11 step 3 | save trigger `PRICE_MISMATCH` | orders-draft.int, db-guards.int | ✓ |
| R2 | zod + `DISCOUNT_EXCEEDS_LINE_VALUE` | CHECKs | unit/int/raw SQL | ✓ |
| R3 | `classify` | save trigger | line.test boundaries | ✓ exact integers |
| R4 | `expectedTerms`, trigger 4 | trigger 4 + save equality | AC6 int + spec | ✓ (see M-1) |
| R5/R6 | `RATE_BELOW_MINIMUM` 422, E6 owner-only | CHECKs | AC3, AC5 | ✓ never clamps |
| R7 | saved immutable | triggers 2/3 | AC4 int + raw SQL | ✓ |
| R8 | `computeOrder`, BigInt | save trigger cross-check | AC1 | ✓ |
| R9 | all above | guards §4.2 | AC2, AC5 | ✓ |
| AC7 | E10 replay §8.4 | – | idempotency.int, sync.test, ac7 e2e | ✓ after B-2 |

## Summary of required edits

- design.md: §1.1 (lock icon, resolved OQ1), §3.4 (auto-return), §4.2 (cents), §6 (icon), OQ1/OQ2 → resolved, helper copy (m-4), `@theme` excerpt.
- plan.md: §1 pin Next version; §6.4 step 5 upsert set-list (M-1); §7 + §11.9 cents; §11.11 resolved; §8.1 runtime caching + register-after-auth (B-2); §8.3 trimmed triggers; §10 ssl/max; §12 explicit cut list (B-3).
- tasks.md: B0 pin + Suspense note; B3 absorbs seed data; B7 DoD unchanged-terms keeps approval; B8/B10 DoD two AC2 assertions; B11 split; F1/F2/F5/F7/F8/F10 DoD per B-1, B-2, B-3, m-3, m-6.
