# Tasks 001 — The Order Screen

Source: `plan.md` (architecture, contract), `design.md` (UI), `spec.md` (rules R1–R9, AC1–AC7).
Owners: `backend` (backend-dev), `frontend` (frontend-dev). Tick `[x]` when the DoD passes.

Parallelism: after **B0, B1, B2** (scaffold, domain, contracts) the two tracks are independent.
Frontend develops against the contract in `src/contracts` and the running backend when available;
its unit/component tests mock `fetch`. E2E tasks (F10) need the backend done.

Global DoD for every task: `pnpm typecheck && pnpm lint` clean; the listed tests pass; no floats in
money code; no application logic outside the files listed unless noted.

Suggested schedule: Day 1 — B0–B9, F1–F3. Day 2 — B10–B12, F4–F10. Offline (F8, F9) is last on
purpose; cut-lines are in plan.md §12.

---

## Backend

### [ ] B0 — Project scaffold and tooling  `backend`
- **Goal:** runnable empty app + DB + test runners that every other task builds on.
- **Files:** `package.json` (scripts: `dev build start typecheck lint test test:int test:e2e verify db:generate db:migrate db:seed db:reset`), `tsconfig.json` (strict), `next.config.ts` (`generateBuildId`, `NEXT_PUBLIC_BUILD_ID`), `src/app/layout.tsx`, `src/app/globals.css`, `eslint.config.mjs`, `vitest.config.ts` (projects `unit`, `integration`), `playwright.config.ts` (skeleton), `docker-compose.yml`, `docker/initdb/01-test-db.sql` (creates `order_screen_test`, `order_screen_e2e`), `.env.example`, `.gitignore`.
- **Depends on:** –
- **DoD:** `docker compose up -d` gives a healthy Postgres 17 with 3 DBs; `pnpm build`, `pnpm test` (one placeholder test), `pnpm typecheck`, `pnpm lint` pass; `git init` done.

### [ ] B1 — Shared pure domain module  `backend`  (R2, R3, R4, R5, R8; AC1, AC3, AC6)
- **Goal:** `src/domain/*` exactly as plan.md §3.1, no framework imports.
- **Files:** `src/domain/{money,line,approval,rate,order,limits,index}.ts` + colocated `*.test.ts`.
- **Depends on:** B0
- **DoD:** unit tests pass and cover: AC1 table (plan §3.2) for bp, class, line totals, order totals, SDG totals 29,274,000 and 45,018,000; boundaries 3.00% sand, 5.00% red, 5.0001% blocked; `sameTerms`/`effectiveState` for each changed field; `checkRate` 7,999/8,000/100,001; `divRoundHalfUp` (…49/…50); `parseUsdToCents` (`"40"`, `"40.5"`, `"1,550.50"`, rejects `"1e3"`, `"-1"`, `"4.555"`); `formatUsd/Sdg/Percent/Rate` strings from design.md §2/§4.4; `canonicalOrderKey` order-insensitive to object key order but sensitive to line order; safe-integer assertions throw. An ESLint `no-restricted-imports` rule forbids `next`, `react`, `@/server` in `src/domain`.

### [ ] B2 — API contracts  `backend`  (contract for both tracks)
- **Goal:** zod schemas + TS types + `ErrorCode` union from plan.md §6.1–6.2.
- **Files:** `src/contracts/api.ts`, `src/contracts/errors.ts`, `src/contracts/api.test.ts`.
- **Depends on:** B1
- **DoD:** schemas for `OrderInput`, decision body, price body, global-rate body, demo-login body; response types `OrderView`, `LineView`, `OrderSummary`, `Catalog`, `PriceChange`; unit tests: unknown keys stripped (`role`, `unitPriceCents`, `createdBy`), qty 0 / 10,001 rejected, 51 lines rejected, duplicate line ids rejected, rate 7,999 **passes zod** (domain rejects it with its own code).

### [ ] B3 — DB schema, migrations and guards  `backend`  (R1, R2, R4, R5, R7, R8, R9; AC2c, AC4)
- **Goal:** tables (plan §4.1) and triggers (plan §4.2).
- **Files:** `src/server/db/schema.ts`, `src/server/db/client.ts` (postgres-js singleton, `prepare:false`), `drizzle.config.ts`, `drizzle/0000_*.sql`, `drizzle/0001_guards.sql`, `tests/helpers/db.ts` (migrate/truncate/seed helpers), `tests/integration/global-setup.ts`, `tests/integration/db-guards.int.test.ts`.
- **Depends on:** B0 (B4 seed can be developed in parallel; tests use B4's seed function)
- **DoD:** `pnpm db:migrate` on empty DB succeeds; `db-guards.int.test.ts` passes, asserting SQLSTATE for: rate 7,999 on orders and app_settings (CHECK), qty 0, discount > value, insert order with `status='saved'` (`OS422`), save transition with unapproved 7.25% line (`OS422`, DETAIL lists line id), save with approved line whose approved terms match (succeeds), save with price ≠ product price (`OS422 PRICE_MISMATCH`), wrong totals (`OS500`), update/delete saved order and insert/update/delete its lines (`OS409`), terms update on approved line clears approval (trigger 4).

### [ ] B4 — Seed and DB scripts  `backend`
- **Goal:** deterministic, idempotent seed (plan §4.3 table).
- **Files:** `scripts/seed.ts` (exports `seed(db)`), `scripts/reset-db.ts`, `src/server/db/seed-data.ts` (fixed UUIDs, exported for tests/scripts).
- **Depends on:** B3
- **DoD:** `pnpm db:reset` works locally; running `pnpm db:seed` twice changes nothing and does not overwrite an edited price; integration test asserts products 51,500 / 81,000 / 207,000, ≥3 dealers, users Amina (adviser) and Yusuf (owner), `global_rate = 8200`; `reset-db.ts` refuses when `NODE_ENV=production` or URL host is not localhost.

### [ ] B5 — Auth, session and HTTP plumbing  `backend`  (spec §2, R9; AC5)
- **Goal:** plan.md §5 + error envelope/mapping.
- **Files:** `src/server/auth/session.ts`, `src/server/http/errors.ts` (ApiError, pg SQLSTATE → code map, zod → `VALIDATION_FAILED`), `src/server/http/route.ts` (wrapper: JSON content-type check, error handling), `src/app/api/auth/demo-login/route.ts`, `src/app/api/auth/logout/route.ts`, `src/app/api/me/route.ts`, `src/proxy.ts`, `tests/helpers/http.ts` (request builder, token factory), `tests/integration/auth.int.test.ts`.
- **Depends on:** B2, B4
- **DoD:** tests: demo-login returns token + `Set-Cookie` (HttpOnly, SameSite=Lax); `/api/me` works with cookie and with Bearer; missing/tampered/expired token → 401 `UNAUTHENTICATED`; token for a deleted user → 401; role only from DB (token contains no role claim); mutation with `text/plain` → 415.

### [ ] B6 — Catalog and owner settings endpoints  `backend`  (R1, R5, R6; AC3, AC5)
- **Goal:** E4, E5, E6.
- **Files:** `src/server/services/{catalog,settings}.ts`, `src/app/api/catalog/route.ts`, `src/app/api/products/[id]/route.ts`, `src/app/api/settings/global-rate/route.ts`, `tests/integration/catalog-settings.int.test.ts`, `tests/integration/ac5-roles.int.test.ts` (catalog/settings part).
- **Depends on:** B5
- **DoD:** catalog returns seeded data + `globalRate: 8200`; owner PATCH price → 200 and reflected in catalog; owner PUT 9,000 → 200; PUT 7,999 → 422 `RATE_BELOW_MINIMUM` and value unchanged (no clamp); adviser PATCH/PUT → 403 `FORBIDDEN` and DB unchanged; price 0 → 400.

### [ ] B7 — Order draft endpoints (create/update/read/list)  `backend`  (R1, R2, R4, R5, R6; AC3, AC6)
- **Goal:** E7, E8, E9 with the shared `upsertAndTransition` service (plan §6.4 steps 1–6, E9 branch) and `views.ts` (OrderView/OrderSummary built with `computeOrder`).
- **Files:** `src/server/services/{orders,views}.ts`, `src/app/api/orders/route.ts`, `src/app/api/orders/[id]/route.ts`, `tests/integration/orders-draft.int.test.ts`.
- **Depends on:** B6
- **DoD:** PUT new id creates draft (201 not required — 200 per contract); unit price taken from DB even if body has `unitPriceCents`/`clientUnitPriceCents` (latter reported in `priceChanges`); removed lines deleted; rate 7,999 → 422 and no row created; unknown dealer/product → 422; discount > qty×DB price → 422 with `lineIds`; changing an approved line's terms resets approval (AC6, service + trigger); PUT on saved → 409 `ORDER_IMMUTABLE`; PUT on pending → 409 `ORDER_NOT_EDITABLE`; adviser B cannot GET/PUT adviser A's order (404; test inserts a second adviser); list: adviser sees own only, owner sees all, `status=pending_approval` filter and `counts.pendingApproval`.

### [ ] B8 — Save endpoint with idempotency  `backend`  (R1, R7, R8, R9; AC1, AC2, AC4, AC7-server)
- **Goal:** E10 (plan §6.4 E10 branch + §8.4).
- **Files:** `src/app/api/orders/[id]/save/route.ts`, `src/server/services/orders.ts`, `tests/integration/{ac1-worked-example,ac2-server-refusal,ac4-snapshot,idempotency}.int.test.ts`.
- **Depends on:** B7
- **DoD:** AC1 lines 1–2 at 8,200 → 200, totals `{357000, 29274000}`, status `saved`; **AC2**: adviser Bearer, 3 lines incl. 7.25% unapproved → 422 `UNAPPROVED_BLOCKED_LINES`, `details.lineIds = [line3]`, `orders` row count for that id = 0, zero `saved` rows; same with forged `role:'owner'`, `approval` and `unitPriceCents` fields → still 422; a pre-existing draft whose save is refused keeps its previous content and status; AC4: saved at 8,200 → owner rate 9,000 + price change → GET shows 8,200, original unit prices, same totals; idempotency: identical replay → 200 `replayed:true` (single row); different content → 409 `ORDER_ALREADY_SAVED` with saved order; price changed since client cached it → saved at DB price, `priceChanges` populated; price change that makes a line blocked → 422.

### [ ] B9 — Approval workflow endpoints  `backend`  (R4; AC1-approved path, AC5, AC6)
- **Goal:** E11, E12, E13 (plan §6.4).
- **Files:** `src/server/services/approvals.ts`, `src/app/api/orders/[id]/request-approval/route.ts`, `src/app/api/orders/[id]/withdraw-approval/route.ts`, `src/app/api/orders/[id]/lines/[lineId]/decision/route.ts`, `tests/integration/{approvals,ac6-approval-voiding}.int.test.ts`, extend `ac1-worked-example` and `ac5-roles`.
- **Depends on:** B8
- **DoD:** request-approval with 7.25% line → `pending_approval`, line `pending`; with no blocked lines → 422 `NO_LINES_NEED_APPROVAL`; owner approve with matching `expectedTerms` → line `approved`, order auto-returns to `draft` when nothing pending; adviser then saves → totals `{549000, 45018000}` (**AC1 full**); stale `expectedTerms` → 409 `LINE_TERMS_CHANGED`; decision on non-pending line → 409 `LINE_NOT_PENDING`; adviser calling decision → 403 (AC5); reject → line `rejected`, save → 422; AC6: approve → PUT discount 15,000→15,100 → line `state:'blocked'`, `approval.status:'none'` → save 422; withdraw → `draft`, pending lines → `none`.

### [ ] B10 — AC2 curl proof script  `backend`  (AC2b)
- **Goal:** `scripts/prove-server-refusal.sh` (bash, needs `curl` + `node` for JSON parsing — no `jq` dependency).
- **Files:** `scripts/prove-server-refusal.sh`.
- **Depends on:** B9
- **DoD:** with `BASE_URL` (default `http://localhost:3000`): logs in as adviser via E1, fetches catalog, generates a UUID, POSTs E10 with the AC1 3-line payload (7.25% line unapproved), prints request/response, asserts HTTP 422 + `UNAPPROVED_BLOCKED_LINES`, then GET E8 → 404 (nothing persisted); also asserts adviser PUT global rate → 403 and rate 7,999 → 422. Exits 0 only if all assertions hold; runs green against `pnpm build && pnpm start` locally.

### [ ] B11 — Deployment (Vercel + Supabase)  `backend`  (spec §9)
- **Goal:** working public URL (plan §10). Requires stakeholder-supplied accounts — ask the user for access; do not create accounts.
- **Files:** `.env.example` (final), README deployment section.
- **Depends on:** B10, F9 (deploy the finished app; an early deploy after B10 is encouraged)
- **DoD:** migrations + seed applied to Supabase via session-pooler `DIRECT_URL`; Vercel env vars set (`DATABASE_URL` transaction pooler, `SESSION_SECRET`); `BASE_URL=<prod> scripts/prove-server-refusal.sh` exits 0; login + AC1 flow manually verified on prod.

### [ ] B12 — README  `backend`  (spec §9)
- **Goal:** README with: local setup (docker, env, migrate, seed, dev), test commands, **how AC2 is proven** (integration test file names, curl script, DB trigger), AC → test table (copy from plan §9.1), architecture summary, "what I would do differently in a real build".
- **Files:** `README.md`.
- **Depends on:** B11, F10
- **DoD:** a fresh clone following the README reaches a working app and green `pnpm verify`.

---

## Frontend

### [ ] F1 — App shell, tokens, API client, login  `frontend`  (spec §2; design §1, §3.1)
- **Goal:** design tokens in Tailwind `@theme`, global layout/top bar, typed API client, login screen.
- **Files:** `src/app/globals.css` (tokens from design.md §1), `src/app/layout.tsx`, `src/components/{TopBar,OnlineOfflineIndicator(stub),Toast,EmptyState,Skeleton,DiscountStateBadge,OrderStatusChip,RoleLoginCard}.tsx`, `src/client/api.ts`, `src/client/hooks/useMe.ts`, `src/app/login/page.tsx`, `src/client/api.test.ts`.
- **Depends on:** B0, B2
- **DoD:** login posts E1 and redirects to `/orders`; "Copy API token (for curl)" copies the returned token; `api.ts` test maps network error → `NETWORK`, 422 envelope → typed error; `DiscountStateBadge` renders icon + label for sand/red/blocked/approved/rejected (not colour alone); owner-only nav items hidden for adviser.

### [ ] F2 — Order screen (online)  `frontend`  (R1–R6, R8; AC1, AC3, AC6 UI)
- **Goal:** design.md §3.2 + §4 using `computeOrder`/`format*` from `src/domain` only.
- **Files:** `src/app/order/page.tsx`, `src/client/hooks/useOrder.ts`, `src/components/{DealerPicker,ProductPickerModal,RateInput,OrderLinesTable,OrderLineCard,TotalsPanel,ActionBar,ErrorBanner}.tsx`, `src/components/RateInput.test.tsx`, `src/components/OrderLinesTable.test.tsx`.
- **Depends on:** F1, B1, B2
- **DoD:** new order gets `crypto.randomUUID()` id and catalog `globalRate` prefill; unit price read-only; discount in whole dollars → cents via `parseUsdToCents`; clamp to line value on blur with design copy; rate `< 8000` on blur/Enter → 8,000 + message (component test); worked-example component test shows `1.94%`/`OK`, `4.32%`/`Warning`, `7.25%`/`Blocked`, `$5,490`, `45,018,000 SDG`, Save disabled with tooltip; debounced PUT autosave (not when pending/saved); Save → E10, Request approval → E11, Cancel request → E12; server `details.lineIds` outline rows; `RATE_BELOW_MINIMUM` banner refocuses rate; pending_approval renders read-only; saved status renders `SavedOrderView` (F6).

### [ ] F3 — Orders list  `frontend`  (spec §5.3)
- **Goal:** design.md §3.3 via E7.
- **Files:** `src/app/orders/page.tsx`, `src/components/OrdersTable.tsx`.
- **Depends on:** F1
- **DoD:** adviser list; owner sees all + "Awaiting approval (N)" filter chip using `counts.pendingApproval`; row click → `/order?id=` (or `/approvals/[id]` for owner on pending orders); empty state; "New order" button; statuses via `OrderStatusChip` incl. rejected marker from `hasRejectedLines`.

### [ ] F4 — Approval view (owner)  `frontend`  (R4; AC1 approved path, AC6)
- **Goal:** design.md §3.4 via E8 + E13.
- **Files:** `src/app/approvals/[id]/page.tsx`, `src/components/ApprovalLineCard.tsx`.
- **Depends on:** F2 (shared line components)
- **DoD:** only lines with `approval.status='pending'` get Approve/Reject; decision sends `expectedTerms` from the displayed line; 409 `LINE_TERMS_CHANGED` → reload + message "This line changed — review again."; reject requires inline confirm; when the order returns to draft shows "All lines decided — returned to {adviser}" + back link; "Nothing pending on this order." state.

### [ ] F5 — Owner settings  `frontend`  (R5, R6; AC3, AC5)
- **Goal:** design.md §3.5 via E4, E5, E6.
- **Files:** `src/app/settings/page.tsx`, `src/components/PriceEditRow.tsx`.
- **Depends on:** F2 (reuses `RateInput`)
- **DoD:** global rate uses `RateInput` reset behaviour; inline price edit (dollars → cents via domain parser); success toasts; adviser direct URL shows full-page 403 state; catalog cache in IndexedDB refreshed after edits (once F7 exists; before that, no-op hook).

### [ ] F6 — Saved order view  `frontend`  (R7; AC4)
- **Goal:** design.md §3.6 — read-only component rendered by `/order` for `status==='saved'`.
- **Files:** `src/components/SavedOrderView.tsx`, `src/components/LockedFieldTooltip.tsx`.
- **Depends on:** F2
- **DoD:** shows order number, saved date, snapshot rate with lock tooltip, stored unit prices and `totals` from the server (never recomputed from current catalog); approved badges persist; no editable controls.

### [ ] F7 — Offline data layer and sync engine  `frontend`  (spec §6; AC7)
- **Goal:** plan.md §8.2–8.3.
- **Files:** `src/client/offline/{db,catalog,orders,outbox,sync,useOnline}.ts`, `src/client/offline/{outbox,sync}.test.ts` (fake-indexeddb), wire into `useOrder`, `OnlineOfflineIndicator`, orders list merge of local-only orders.
- **Depends on:** F2, F3
- **DoD:** unit tests: outbox coalescing (latest payload wins, `save` not downgraded), sync 200 → synced + removed, 409 `ORDER_ALREADY_SAVED` → synced, 422 → `rejected` with `lastError` and order kept, 401 → queue kept + stop, network/5xx → kept + backoff; offline Save button reads "Save (offline)" and enqueues; top bar shows "N pending sync"; offline banner copy from design.md; price-change notice shown once from `priceChanges`; request-approval/owner actions disabled offline.

### [ ] F8 — Service worker  `frontend`  (spec §6)
- **Goal:** plan.md §8.1.
- **Files:** `public/sw.js`, `public/manifest.webmanifest`, `src/app/sw-register.tsx` (production only, `?v=NEXT_PUBLIC_BUILD_ID`).
- **Depends on:** F7
- **DoD:** in `pnpm build && pnpm start`: after first online load, DevTools offline → `/order`, `/orders` reload and render from cache with catalog from IndexedDB; new build id replaces old caches; `/api/*` never served from SW cache (verified in F10 test by asserting API requests fail offline, not stale-succeed).

### [ ] F9 — Offline integration polish  `frontend`  (AC7)
- **Goal:** end-to-end offline behaviour on real screens: create/edit order offline, "Queued" tag, sync on reconnect, rejected-order display with line errors, "Sign in to sync" on 401.
- **Files:** components touched in F2/F3/F7 only.
- **Depends on:** F8, B8
- **DoD:** manual run-through documented in the PR/summary + F10 AC7 spec green.

### [ ] F10 — E2E suite  `frontend`  (AC1, AC3, AC4, AC5, AC6, AC7)
- **Goal:** Playwright specs from plan.md §9.1 against the production build.
- **Files:** `playwright.config.ts` (webServer `pnpm build && pnpm start -p 3100`, env `DATABASE_URL=…/order_screen_e2e`), `tests/e2e/global-setup.ts` (db reset + seed), `tests/e2e/{ac1-worked-example,ac3-rate-floor,ac4-snapshot,ac5-roles,ac6-voiding,ac7-offline}.spec.ts`, `tests/e2e/helpers.ts` (login as role, add line).
- **Depends on:** F2–F9, B9
- **DoD:** `pnpm test:e2e` green locally 3 runs in a row; AC7 spec waits for `navigator.serviceWorker.ready` + controller before `context.setOffline(true)`, covers both "syncs and appears as saved" and "shows the server's rejection" (owner raises Battery price while adviser is offline so the unapproved discount becomes blocked → rejection visible on the line).

---

## Traceability

| Spec item | Plan sections | Tasks | Key tests |
|---|---|---|---|
| R1 fixed prices | §4.2 (PRICE_MISMATCH), §6.4 step 3 | B3, B7, B8, F2 | `orders-draft.int`, `db-guards.int` |
| R2 line value/total bounds | §3.1, §4.1 CHECKs, §6.1 | B1, B2, B3, B7, F2 | `line.test`, `db-guards.int`, `orders-draft.int` |
| R3 % + classification | §3.1–3.2, §4.2 | B1, B3, F2 | `line.test` boundaries |
| R4 approval bound to terms | §4.1, §4.2 trig 4–5, §6.4 E13 | B1, B3, B7, B9, F4 | `approval.test`, `ac6-approval-voiding.int`, `ac6-voiding.spec` |
| R5 rate floor | §3.1, §4.1 CHECK, §6.1, §7 | B1, B3, B6, B7, F2, F5 | `rate.test`, `RateInput.test`, `ac3-rate-floor.spec` |
| R6 global rate | §4.1 app_settings, §6.3 E4/E6, §8.2 | B6, F2, F5 | `catalog-settings.int` |
| R7 snapshot | §4.2 trig 2–3, §6.2 totals | B3, B8, F6 | `ac4-snapshot.int`, `ac4-snapshot.spec` |
| R8 totals | §3.1 `sdgTotal`, §4.2 trig 5 | B1, B3, B8, F2 | `order.test`, `ac1-worked-example.int` |
| R9 server authority | §4.2, §5, §6.4, §8.4 | B3, B5–B9 | `ac2-server-refusal.int`, `ac5-roles.int` |
| AC1 worked example | §3.2, §9.1 | B1, B8, B9, F2, F4, F10 | unit + `ac1-worked-example.int` + `.spec` |
| AC2 server refusal | §4.2 trig 5, §6.4 E10, §9.1 | B3, B8, B10 | `ac2-server-refusal.int`, `db-guards.int`, `prove-server-refusal.sh` |
| AC3 rate floor | §6.1, §7 | B1, B6, B7, F2, F10 | `rate.test`, `RateInput.test`, int, `ac3-rate-floor.spec` |
| AC4 snapshot | §4.2, §9.1 | B3, B8, F6, F10 | `ac4-snapshot.int`, `.spec` |
| AC5 roles | §5, §6.3 | B5, B6, B9, F1, F5, F10 | `ac5-roles.int`, `.spec` |
| AC6 approval voiding | §4.2 trig 4, §6.4 | B1, B3, B7, B9, F4, F10 | `ac6-approval-voiding.int`, `.spec` |
| AC7 offline | §8 | B8 (idempotency), F7, F8, F9, F10 | `idempotency.int`, `sync.test`, `ac7-offline.spec` |
