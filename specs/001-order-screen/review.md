# Code review — 001 The Order Screen

Scope: every commit from `077d0bc` to `59c4df8` (B0–B11a, F1–F10). Reviewed against `spec.md`,
`plan.md`, `tasks.md` and `plan-review.md`. Reviewer: code-reviewer agent, 2026-09-25.

## Verdict: **CHANGES REQUESTED** (0 blockers, 4 majors, 7 minors)

The **server is solid**. All of R1–R9 and AC1–AC6 hold under direct API attack. Every bypass probe
listed below was refused with the right code, and nothing was persisted. The DB guards stop a raw-SQL
flip to `saved`. Money math uses integers and BigInt throughout. The problems are in the
**offline/client layer**:
- An offline order can be saved under a **different user** (M-1).
- A lowered price makes an existing draft **impossible to open** (M-2).
- An offline order the server refused is findable only by its URL (M-3).
- The spec §6 "user is told if the price changed" notice was never built (M-4).

Several F7/F9 DoD items are ticked in `tasks.md` but not implemented (M-3, M-4, m-5). B11b
(redeploy) and B12 (README, a spec §9 deliverable) are still open.

## What was run

| Check | Result |
|---|---|
| `pnpm typecheck` / `pnpm lint` | clean |
| `pnpm test` (unit) | 91/91 pass |
| `pnpm test:int` (real Postgres) | 81/81 pass |
| `pnpm build` | pass (Next 16.3.6) |
| `pnpm test:e2e` (AC1 + 2× AC7) | 3/3 pass |
| `scripts/prove-server-refusal.sh` vs local `next start -p 3020` | all assertions pass |
| curl probes vs local server (below) | all refused correctly except F-m1 (500 instead of 400) |
| raw SQL vs local `order_screen` DB | guards hold for single transactions; concurrency hole m-2; forged approval m-3 |
| Playwright probes (scratch scripts, local server) | reproduced M-1, M-2, M-3 |

The probes left demo rows in the local `order_screen` DB. The Battery price and the global rate
were restored. Nothing was run against Supabase or the production URL.

### API bypass probes (adviser bearer token, local server) — all PASS

| Probe | Result |
|---|---|
| Save a 7.25% unapproved line with forged `role:"owner"`, `createdBy`, `status:"saved"`, `unitPriceCents:1`, `approval`, `approvalStatus`, `state` | 422 `UNAPPROVED_BLOCKED_LINES`, 0 rows |
| PUT with `unitPriceCents:1` / `clientUnitPriceCents:1` | stored price 51,500 (DB price) |
| rate 7,999 / 100,001 / 8000.5 / `"8200"` / -1 / null | 422 `RATE_BELOW_MINIMUM` / 422 `RATE_ABOVE_MAXIMUM` / 400 / 400 / 422 / 400. Never clamped, no row created |
| discount > line value, discount -1, 100.5, 1e300, 2^53+1 | 422 `DISCOUNT_EXCEEDS_LINE_VALUE` / 400 ×4 |
| qty 0, -5, 1.5, 10,001, 1e20; 51 lines; duplicate line ids | 400 |
| Adviser approves a line (E13) | 403 |
| Adviser PATCH price / PUT global rate | 403 / 403 |
| Adviser PUT while `pending_approval` | 409 `ORDER_NOT_EDITABLE` |
| Stale approval: approved discount 150 → save with 150.01 | 422. Rollback keeps the approval (nothing persisted) |
| Stale approval: PUT 150.01, then back to 150, then save | approval voided by trigger 4 → 422 |
| Owner raises price after approval → adviser saves the identical payload | 422 (server rewrites price → approval voided). After the price is restored to the approved value → 200 (terms match exactly: correct under R4) |
| Idempotent replay: same payload | 200 `replayed:true`, one row |
| Replay with changed qty / changed rate | 409 `ORDER_ALREADY_SAVED` |
| PUT / request-approval / withdraw on a saved order | 409 `ORDER_IMMUTABLE` |
| Adviser GET/PUT/save/withdraw on the owner's order; owner PUT/save on the adviser's draft; owner replays the adviser's saved order | 404 |
| `text/plain` mutation; no token; tampered token | 415 / 401 / 401 |
| Owner sets global rate 7,999 / 8000.5 | 422 / 400 |

### Raw SQL probes (local DB)

| Probe | Result |
|---|---|
| `UPDATE orders SET status='saved'` with correct totals, draft with 7.25% unapproved line | `OS422 UNAPPROVED_BLOCKED_LINES` ✓ |
| Same via `pending_approval` | `OS422` ✓ |
| `INSERT … status='saved'` | `ORDER_MUST_START_AS_DRAFT` ✓ |
| Self-approve the line in SQL (`decided_by` = the adviser), then flip to saved | **succeeds** (m-3) |
| T1 flips a clean draft to saved (not yet committed) while T2 inserts a 72%-discount line | **both commit**. The saved order has an unapproved blocked line and `total_usd_cents` 202,000 ≠ Σ lines 259,000 (m-2) |

## Findings

| id | severity | file:line | problem | reproduction | suggested fix |
|---|---|---|---|---|---|
| M-1 | **major** | `src/components/TopBar.tsx:55`; `src/client/offline/sync.ts:26-100`; `src/client/offline/db.ts` (no per-user scoping); `src/client/hooks/useMe.ts:31` | **Logout does not clear IndexedDB, and the outbox is replayed with whoever is signed in next.** An adviser's queued offline order gets saved as the owner's (or another adviser's) order, so `created_by` is wrong. The previous user's cached orders and cached `me` also stay on the device. Offline after logout, `/orders` still shows "Amina · Sign out" from the cached `me`, and new orders can be queued under her name. | Playwright against the local server: adviser logs in → offline → creates Pump 4×, $40 → "Save (offline)" → cookies cleared (12 h session expiry) → online: sync gets 401 and keeps the queue (correct) → owner logs in on the same browser → app-start sync replays it. `SELECT … created_by` → **`saved | Yusuf | owner`**. | Store `userId` in each outbox entry and each `LocalOrder`. `runSync` replays only entries whose `userId` equals the current `/api/me` user; other users' entries are left alone, never sent. On explicit Sign out, clear `orders` + `outbox` + `meta.me` (warn first if the outbox is non-empty). Add a unit test "entries of user A are not replayed under user B". |
| M-2 | **major** | `src/client/hooks/useOrder.ts:186-203` (client `computeOrder` with cached/catalog prices); `src/domain/line.ts:18` throws | The **order screen crashes** ("This page couldn't load") when a line's discount exceeds its value at the *current* catalog price. This happens whenever the owner lowers a price below an existing draft's discount. The domain module's `lineTotal` throws `DomainError` inside `useMemo` during render. The adviser can no longer open, fix or delete that draft. The same can happen offline with a stale cached catalog. | PUT a draft: Battery qty 1, discount 150,000 (blocked; valid as a draft). Owner PATCH Battery → 100,000. Open `/order?id=…` as the adviser → page error `discount 150000 exceeds line value 100000`, error screen. | Never let render-path domain calls throw. In `useOrder`, detect `discountCents > qty × price` before `computeOrder` and show that line as an error state ("Discount exceeds the new line value — reduce it"), with the numbers computed defensively. Alternatively clamp only for display and keep the server authoritative. Add a component/unit test for this case. |
| M-3 | **major** | `src/app/orders/page.tsx:20-33, 94`; `src/client/offline/db.ts:91` (`listLocalOrders` unused); `src/client/hooks/useOrder.ts:69-86` | **Local-only orders never appear in the orders list**, online or offline. F7 DoD says "orders list merge of local-only orders" and is ticked. Take a new order created offline that the server rejects on sync (422 rolls back the whole transaction, so no server row exists). After the adviser leaves the page, its only copy is in IndexedDB and can be reached only if the URL is known. Spec §6 requires it to be "never silently lost". Also, offline `/orders` shows a permanent skeleton, because the list only calls the API. | Playwright: offline new order Battery $90 → owner lowers the price to $1,000 → Save (offline) → online: "Couldn't save" shows ✓ → go to `/orders`: order **not listed** (server has 0 rows, local `syncState:'rejected'`). Offline `/orders`: 0 rows, 4 skeleton rows forever. | Merge `listLocalOrders()` (with status chips "Queued" / "Rejected" / "Local") into the list, both online and offline. Offline, render the list from IndexedDB instead of a skeleton. Consider keeping queued and rejected drafts pinned at the top. |
| M-4 | **major** | `src/client/hooks/useOrder.ts:205-211` (`buildInput` omits `clientUnitPriceCents`); no UI consumer of `priceChanges` in `src/app`, `src/components` | Spec §6 requires that "the server's price wins on sync and **the user is told if it changed**". The client never sends `clientUnitPriceCents`, so the server's `priceChanges` is always `[]`. No component renders `priceChanges` either (`grep priceChanges src/app src/components` finds only API routes). The F7 DoD item "price-change notice shown once from `priceChanges`" is ticked but not implemented. After an offline save goes through at a changed price, the adviser sees different totals with no explanation. The same gap means plan §11.12 (owner price change voids an approval, explained by the banner) has no explanation in the UI. | Code inspection plus the M-3 run: the server price differed from the cached one and no notice appeared. The integration tests only cover the server side of `priceChanges`. | Send `clientUnitPriceCents` (the cached catalog price) for every line in `buildInput`. Render a one-time banner from `priceChanges` on the order and saved views. Refresh the catalog cache after any response with `priceChanges`. |
| m-1 | minor | `src/contracts/api.ts:29-37` vs `src/server/services/orders.ts:25-31` | The duplicate-line-id check is case-sensitive, but the service lower-cases ids afterwards. Two ids that differ only in case pass zod, then Postgres fails with "ON CONFLICT DO UPDATE command cannot affect row a second time" and the API returns 500 `INTERNAL`. Not a bypass: the transaction rolls back. | PUT with lines `[{id:X},{id:upper(X)}]` → **500**. | Lower-case uuids in the zod schema (`.transform(s => s.toLowerCase())`) before the uniqueness refine, or compare case-insensitively. |
| m-2 | minor | `drizzle/0001_guards.sql:52,58` (`order_lines_immutable_guard`) | The parent-status read in the line trigger takes no lock. A concurrent raw-SQL line insert or update that commits while another transaction flips the order to `saved` escapes both the immutability guard and `orders_validate_save`. The result is a saved order with an unapproved blocked line and wrong totals. The app itself is safe because every app mutation locks the order `FOR UPDATE` first. The gap is in the "DB-level guard" claim (AC2c / R9). | Two psql sessions (see Raw SQL table): result `saved | 202000 | 2 lines | Σ 259000`. | `SELECT status … FOR SHARE` (or `FOR KEY SHARE` plus a re-check) in the trigger, so it waits for the saving transaction and then sees `saved`. |
| m-3 | minor | `drizzle/0001_guards.sql` (save guard trusts `approval_status`) | The DB guard accepts any row with `approval_status='approved'` and matching `approved_*` columns. It does not check that `decided_by` is an owner, or that the line went through `pending`. A raw-SQL writer can self-approve, so AC2(c) holds against "unapproved" lines only as long as the approval columns are trusted. | SQL self-approval by the adviser, then flip → `saved`. | Optional hardening: CHECK/trigger requiring `approval_status='approved'` ⇒ `decided_by` references a user with role `owner` and `decided_at` is not null. Only transitions from `pending` can set it. |
| m-4 | minor | `src/client/hooks/useOrder.ts:266-274` | Autosave (PUT) silently ignores every non-network error, for example 422 `DISCOUNT_EXCEEDS_LINE_VALUE` after a price drop, 409 `ORDER_IMMUTABLE`, or 422 `RATE_*`. The adviser believes the draft is stored when it isn't. | Code inspection. | Surface non-network autosave errors via `setError`, and mark the line rows as with save errors. |
| m-5 | minor | `src/client/offline/sync.ts:70-73`; no UI text | The 401 branch keeps the queue (correct), but the "Sign in to sync" prompt from plan §8.3 / F9 is not implemented (`grep "Sign in to sync"` finds nothing). The chip just shows "N pending sync" forever. | Code inspection plus the M-1 run. | Expose a `needsSignIn` flag from the sync engine and render the prompt in `OnlineOfflineIndicator`. |
| m-6 | minor | `src/client/hooks/useOrder.ts:69-86` | Load is server-first: `getOrder` 200 overwrites the local copy (`saveLocalInput(... syncState:'synced')`). Consider an order that has a server draft, was edited offline, and whose queued save was rejected. Reopening it online shows the old server draft, and the rejected local edits plus the error are overwritten, with no notice. A never-persisted rejected order only reappears because of an `onSyncChange` side effect of the app-start sync. | Code inspection (second half of the M-3 run confirms the side-effect path). | When a local copy is `rejected` / `queued` / `local`, prefer it (or offer "keep my changes / discard") over the server copy. |
| m-7 | minor | `src/server/services/settings.ts` / error copy | Owner global-rate 7,999 returns the message "Order rate must be at least 8,000…". The code is correct; only the copy is wrong for the settings screen. | curl above. | Use a context-neutral message, or override it in E6. |

## Rules / AC traceability (verified)

| Item | Server | DB | Evidence |
|---|---|---|---|
| R1 fixed prices | ✓ price read from DB `FOR SHARE`, client price ignored | ✓ `PRICE_MISMATCH` | curl forged price; int tests |
| R2 bounds | ✓ zod + `DISCOUNT_EXCEEDS_LINE_VALUE` | ✓ CHECKs | curl table |
| R3 classify | ✓ integer compare (`line.ts`) | ✓ same predicate | unit boundaries incl. 5.0001% |
| R4 approval binding | ✓ upsert never writes approval cols; `expectedTerms` | ✓ trigger 4 + save equality | curl stale approval, owner price change |
| R5 rate floor | ✓ 422, never clamps | ✓ CHECK | curl, AC2 script |
| R6/R7 snapshot | ✓ | ✓ immutability triggers (see m-2) | AC4 int test |
| R8 totals | ✓ BigInt SDG, half-up | ✓ cross-check | AC1 unit/int/e2e (29,274,000 / 45,018,000) |
| R9 authority | ✓ | ✓ (m-2, m-3 hardening) | all probes |
| AC1–AC6 | pass | | tests + probes |
| AC7 | passes as specified by e2e; see M-1, M-3, M-4 | | e2e 2/2 + probes |

Service worker: `/api/*` is never intercepted. Only static route shells (`/order`, `/orders`,
`/login`) are cached, and only when `ok && !redirected && basic`. These shells contain no user data,
so the HTTP cache does not leak one user's data to another after logout. The cross-user exposure is
entirely in IndexedDB (M-1). Idempotency: server-side replay is correct (same content → `replayed`,
different content → 409, other user → 404). The client treats 409 `ORDER_ALREADY_SAVED` as synced
with the server copy, so the local edits are replaced by the saved version. That is acceptable per
plan §8.3, but the user should be told.

## Code quality

Small and readable: one mutation service (`upsertAndTransition`), a pure domain module with
safe-integer assertions, an error envelope with SQLSTATE mapping, and a hand-written SW of about
100 lines. `useOrder.ts` (~420 lines) is the one hotspot: it mixes load, sync reconciliation,
autosave and a synthetic `OrderView`. Splitting local/server reconciliation out of it would make
M-2, M-3 and m-6 easier to fix and test. `tasks.md` has F7/F9 ticked with unimplemented DoD items
(M-3, M-4, m-5). Please untick them or finish them.

## Required before sign-off

1. Fix M-1 through M-4, with a test for each (unit for M-1 and M-2; e2e or unit for M-3 and M-4).
2. m-1 (500 → 400) is a one-liner; m-2 is a one-line trigger change plus a concurrency test. Both recommended.
3. Complete B12 (README, a spec §9 deliverable) and B11b (redeploy).

---

## Re-review — 2026-09-25 (backend 042efd3, README 111295c, frontend 8b19c57)

### Verdict: **CHANGES REQUESTED** — one new major issue (N-1), caused by the M-1 fix; everything else is fixed

The M-1 fix stops the cross-user save. However, it wipes the previous user's queued offline orders
on sign-out and on a different-user sign-in. The result is silent loss of unsynced orders, which
spec §6 forbids ("never silently lost"). This needs a small follow-up. All other findings are
verified fixed.

### Suite (local, `DATABASE_URL` overridden; nothing run against Supabase or the prod URL)

| Check | Result |
|---|---|
| `pnpm typecheck` / `pnpm lint` | clean |
| `pnpm test` | 102/102 pass |
| `pnpm test:int` | 88/88 pass |
| `pnpm build` | pass |
| `pnpm test:e2e` | 3/3 pass |
| migration 0002 on local `order_screen` | applied (`order_lines_approval_guard` present) |

### Per-finding status (original reproductions re-run against `next start -p 3020`)

| id | status | evidence |
|---|---|---|
| M-1 cross-user replay | **fixed** (the cross-user save), but see **N-1** | Same Playwright flow as before: adviser queues an offline save → session expires → 401 keeps the queue and "Sign in to sync" is shown → owner signs in. The order is **not** saved under Yusuf (0 rows). Outbox and local orders now carry `userId`; `runSync` skips other users' entries. |
| M-2 crash on price drop | **fixed** | Draft Battery ×1 with discount $1,500; owner lowers the price to $1,000; open `/order` → no page error. The row shows "Invalid" and "Discount ($1,500) exceeds the new line value ($1,000) — reduce the discount or remove this line." Save is disabled. |
| M-3 local-only orders not listed | **fixed** | An offline order rejected on sync (server has 0 rows) is listed online as "Draft · Rejected — not saved". Offline `/orders` renders from IndexedDB with the "Showing cached orders" banner and no endless skeleton. Note: the offline list holds only orders *viewed* on this device, not every listed order (plan §8.2 says "viewed or listed"). The README describes this correctly. Acceptable. |
| M-4 price-change notice | **fixed** | Offline save of Battery at the cached $2,070; owner raises it to $2,100; on reconnect a toast reads "Note: the price of Battery changed from $2,070 to $2,100. Totals reflect the new price." `buildInput` now sends `clientUnitPriceCents`. |
| m-1 case-variant duplicate ids → 500 | **fixed** | Same payload → 400 `VALIDATION_FAILED` "Duplicate line id". |
| m-2 line-trigger race | **fixed** | Two-session psql race re-run. A line insert during an uncommitted save now waits, then gets `OS409 ORDER_IMMUTABLE` (order stays with 1 line). Reverse order (uncommitted line insert, then save) → the save waits, then gets `OS422 UNAPPROVED_BLOCKED_LINES`. |
| m-3 SQL self-approval | **fixed** | Approval from `none` → `APPROVAL_REQUIRES_OWNER`. From `pending` with `decided_by` = the adviser → `APPROVAL_REQUIRES_OWNER`. With `decided_by` = an owner the SQL still succeeds. That is inherent: the DB cannot authenticate a raw SQL writer. Acceptable. |
| m-4 autosave errors swallowed | **fixed** | Owner lowers the price under the draft's discount, then the adviser edits → "Couldn't save — A discount can't exceed its line value." is shown. |
| m-5 "Sign in to sync" | **fixed** | The prompt appears after the 401 (M-1 flow). |
| m-6 server copy overwrites local edits | **fixed** | Reopening the rejected order online shows the local edits plus "Couldn't save…" (local copy wins while not `synced`). |
| m-7 settings rate copy | **fixed** | Owner global rate 7,999 → 422 "Global rate can't be below 8,000 SDG/USD. The current rate was kept." |

### New findings

| id | severity | file:line | problem | reproduction | suggested fix |
|---|---|---|---|---|---|
| N-1 | **major** | `src/app/login/page.tsx:33-37` (`clearAll()` when the cached `me` differs); `src/components/TopBar.tsx:22-39` (sign-out `clearAll()` after a confirm) | **Unsynced offline orders are deleted.** (a) Consider a different user signing in on the same device, which happens naturally after the 12 h session expiry. This wipes the previous user's outbox and local orders with no warning. The queued save is lost: it is in neither IndexedDB nor the server. (b) On explicit sign-out with pending entries, the confirm says *"They will not upload until you sign back in as Amina"*, but the code then calls `clearAll()`. After Amina signs back in, the outbox is empty and the order was never saved. The dialog promises the opposite of what happens. This also contradicts `sync.ts`'s own comment that another user's entries are "left untouched … until that user signs back in". | (a) M-1 flow → owner signs in → outbox `[]`, orders `[]` → adviser signs back in → outbox `[]`; `SELECT … WHERE id=<order>` → 0 rows. (b) Adviser queues an offline save → API unreachable → Sign out → the dialog above → Accept → adviser signs in again → outbox `[]`, 0 rows on the server. | The per-user scoping already added (`userId` on entries, filtered `runSync`, `listLocalOrders`, `outboxCount`) makes wiping unnecessary for correctness. On a different-user sign-in, clear only `meta.me` (and optionally the SW caches). Keep other users' `orders`/`outbox` rows: they are already hidden and never replayed. On sign-out, keep this user's pending entries as the dialog promises, or, if wiping for privacy is preferred, change the copy to "…will be **discarded**" and only wipe after that explicit confirmation. Add a unit/e2e test: "user A's queued save survives user B's session and syncs when A signs back in". |

### README check

The README is accurate against the code:
- The commands and scripts exist (`db:migrate` → `scripts/migrate.ts` using `DIRECT_URL || DATABASE_URL`, `db:reset` guard, `verify`).
- Port 5434 and the three DBs match.
- "Copy API token (for curl)" exists on `/login`.
- The AC2 section matches `ac2-server-refusal.int.test.ts`, `prove-server-refusal.sh` (no jq; steps 3–6) and the 0001/0002 guards.
- The AC6 15,000 → 15,100 case matches the test.
- The auth tests cover expired and deleted-user tokens.
- The offline section says "orders you have viewed", which matches the code.

One note: the README's `.env.production.local` warning is good. Also consider mentioning in the offline section that sign-out wipes local data, once N-1 is resolved.

Local DB note: the probes left extra demo orders in the local `order_screen` DB. The Battery price is back at 207,000. The global rate was found at 8,000 (not changed by these probes) and has been set back to the seed value 8,200.
