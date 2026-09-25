# Order Desk — The Order Screen

An **adviser** picks a dealer, adds products at fixed USD prices, gives a discount on each line, sets
the day's SDG/USD rate and saves the order. An **owner** sets prices and the default rate, and
approves discounts above 5%. Specification: [`specs/001-order-screen/spec.md`](specs/001-order-screen/spec.md);
architecture and API contract: [`plan.md`](specs/001-order-screen/plan.md); UI: [`design.md`](specs/001-order-screen/design.md).

**Live:** https://delivery-order-nu.vercel.app (Vercel, region `dub1`, with Supabase Postgres in eu-west-1)

## Demo login

There are no passwords. On `/login`, pick **Adviser (Amina)** or **Owner (Yusuf)**. The session is an
HttpOnly, SameSite=Lax cookie holding an HS256 JWT (12 h). The JWT carries only the user id. On
every request the server reads the role from the `users` table, never from the request.

To call the API with `curl`, use **"Copy API token (for curl)"** on the login screen, or:

```bash
TOKEN=$(curl -s -X POST https://delivery-order-nu.vercel.app/api/auth/demo-login \
  -H 'Content-Type: application/json' -d '{"role":"adviser"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')
curl -s https://delivery-order-nu.vercel.app/api/catalog -H "Authorization: Bearer $TOKEN"
```

Anyone can log in as the owner. That is intended for this demo login (spec §2).

## Stack

- **Next.js 16.3.6**, pinned exactly: App Router, Route Handlers as a JSON API, and `src/proxy.ts`
  (Next 16 renamed Middleware to Proxy).
- TypeScript (strict) and Tailwind CSS v4.
- PostgreSQL 17 through Drizzle ORM and postgres-js (`prepare: false` for the Supabase pooler).
- zod v4 for request contracts and `jose` for sessions.
- Vitest for unit and integration tests, Playwright (Chromium) for e2e.
- A hand-written service worker, with `idb` for offline storage.

## Local setup

Requirements: Node 22, pnpm 10, Docker.

```bash
pnpm install
docker compose up -d            # Postgres 17 on host port 5434; creates order_screen, order_screen_test, order_screen_e2e
cp .env.example .env            # local URLs + a dev SESSION_SECRET
pnpm db:migrate                 # drizzle/0000_init, 0001_guards, 0002_approval_and_lock_guards
pnpm db:seed                    # idempotent: Amina/Yusuf, 4 dealers, 5 products, global rate 8,200
pnpm dev                        # http://localhost:3000 (use `pnpm dev -p 3010` if 3000 is taken)
```

`pnpm db:reset` drops the schema, then migrates and seeds again. It refuses to run when
`NODE_ENV=production` or when the database host is not localhost.

> Next.js loads `.env.production.local` for `next start`. If that file holds production database
> URLs, override `DATABASE_URL` in the shell when you run a local production build.

## Tests

| Command | What | Needs |
|---|---|---|
| `pnpm typecheck` / `pnpm lint` | strict TS; ESLint forbids framework, DB and server imports in `src/domain` | – |
| `pnpm test` | unit: domain module (AC1 numbers, R3 boundaries, rounding), contracts, offline outbox/sync, `RateInput` | – |
| `pnpm test:int` | route handlers called with real `Request`s, plus raw-SQL guard tests | docker Postgres (`order_screen_test`, rebuilt on each run) |
| `pnpm test:e2e` | Playwright: AC1 worked example and AC7 offline, on `next build && next start -p 3100` | docker Postgres (`order_screen_e2e`) |
| `pnpm verify` | typecheck, lint, unit, integration, build | docker Postgres |

## How AC2 is proven (server refusal)

AC2 is the rule that when an adviser saves directly through the API with a 7.25% line that has no
owner approval, the server returns a 4xx and **nothing is persisted**. Three independent proofs
cover it:

1. **Integration test against real Postgres:**
   [`tests/integration/ac2-server-refusal.int.test.ts`](tests/integration/ac2-server-refusal.int.test.ts).
   It uses an adviser Bearer token and the AC1 three-line payload.
   - (a) With a fresh order id that was never PUT, the save returns 422 `UNAPPROVED_BLOCKED_LINES`
     with `details.lineIds = [line3]`, and there are 0 rows in `orders` or `order_lines` for that id.
   - (b) With a draft first created through `PUT` (as the UI's autosave does), the save returns 422
     and the row stays `draft` with its previous content.
   - Variants: forged `role:"owner"`, `createdBy`, `status:"saved"`, `unitPriceCents`, `approval`
     are stripped and still refused; `pending` lines, empty orders and rate 7,999 are refused too.
   - Mechanism: the whole upsert-and-save runs in one transaction, and any refusal rolls it back.
2. **curl script:** [`scripts/prove-server-refusal.sh`](scripts/prove-server-refusal.sh). It needs
   only bash, curl and node, no jq. It logs in as the adviser, fetches the catalog, and saves a
   fresh order id with the 7.25% line. It then asserts:
   - the save is refused with 422 `UNAPPROVED_BLOCKED_LINES`;
   - a follow-up `GET` returns 404, so nothing was stored;
   - the adviser setting the global rate gets 403 (AC5);
   - an order rate of 7,999 gets 422 (AC3).

   It exits 0 only if every assertion holds.
   ```bash
   BASE_URL=https://delivery-order-nu.vercel.app scripts/prove-server-refusal.sh
   ```
   Sample output (trimmed):
   ```
   3. POST /api/orders/7fb1554e-…/save — fresh id (never PUT), AC1 lines incl. line 3 at 7.25%, no approval
       request:  {"dealerId":"2222…","rate":8200,"role":"owner","lines":[…{"id":"721c5f47-…","productId":"3333…0003","qty":1,"discountCents":15000,"unitPriceCents":1000000,"approval":{"status":"approved"}}]}
       response: HTTP 422 {"error":{"code":"UNAPPROVED_BLOCKED_LINES","message":"Line(s) need owner approval before saving.","details":{"lineIds":["721c5f47-…"]}}}
     PASS HTTP 422
     PASS error.code = UNAPPROVED_BLOCKED_LINES
     PASS details.lineIds names line 3 only (721c5f47-…)
   4. GET /api/orders/7fb1554e-… — nothing was persisted
       response: HTTP 404 {"error":{"code":"NOT_FOUND","message":"Not found."}}
     PASS HTTP 404 — no order row exists for that id
   5. AC5 — adviser PUT /api/settings/global-rate → 403
     PASS HTTP 403 FORBIDDEN
   6. AC3 — order with rate 7,999 → 422 (refused, not clamped)
     PASS HTTP 422 RATE_BELOW_MINIMUM
     PASS no order row created (GET → 404)
   All assertions passed: the server refuses the unapproved 7.25% line and persists nothing.
   ```
3. **Database guards:** [`drizzle/0001_guards.sql`](drizzle/0001_guards.sql) and
   [`drizzle/0002_approval_and_lock_guards.sql`](drizzle/0002_approval_and_lock_guards.sql), tested
   in [`tests/integration/db-guards.int.test.ts`](tests/integration/db-guards.int.test.ts).
   These hold even if the app code has a bug or someone writes SQL by hand.
   - `orders_validate_save` fires on the transition to `saved` and raises `OS422` in these cases:
     - any line with `discount×100 > 5×qty×price` lacks an approval whose stored terms equal the
       current terms (`UNAPPROVED_BLOCKED_LINES`, with the line ids in DETAIL);
     - the order has no lines;
     - a line's price differs from the product price.

     It raises `OS500` if the totals differ from the recomputed values.
   - `orders_insert_guard` means an order can only be inserted as `draft`.
   - `orders_immutable_guard` and `order_lines_immutable_guard` make saved orders and their lines
     immutable (`OS409`). The line guard locks the parent order `FOR SHARE`, so it cannot race a
     concurrent save.
   - `order_lines_void_approval` clears an approval whenever product, qty, price or discount changes.
   - `order_lines_approval_guard` allows a line to become `approved` only from `pending`, and only
     with `decided_by` set to a user whose role is owner.

## Acceptance criteria → tests

| AC | Unit | Integration | E2E / script |
|---|---|---|---|
| AC1 worked example | `src/domain/line.test.ts`, `order.test.ts` (1.94/4.32/7.25%, 29,274,000 / 45,018,000 SDG) | `ac1-worked-example.int.test.ts` (lines 1–2 saved; full flow: request approval, owner approves, save) | `tests/e2e/ac1-worked-example.spec.ts` |
| AC2 server refusal | – | `ac2-server-refusal.int.test.ts`, `db-guards.int.test.ts` | `scripts/prove-server-refusal.sh` |
| AC3 rate floor | `src/domain/rate.test.ts`, `RateInput.test.tsx` | `orders-draft.int.test.ts`, `catalog-settings.int.test.ts`, raw SQL CHECK | script step 6 |
| AC4 snapshot | – | `ac4-snapshot.int.test.ts` (rate 9,000 + price change → saved order unchanged; raw SQL → `OS409`) | – |
| AC5 roles | – | `ac5-roles.int.test.ts`, `auth.int.test.ts` (403 for price, rate and decisions; 401 for missing, tampered, expired or deleted-user tokens) | script step 5 |
| AC6 approval voiding | `src/domain/approval.test.ts` | `ac6-approval-voiding.int.test.ts` (discount 15,000 → 15,100 makes the line blocked, save returns 422; unchanged terms keep the approval) | – |
| AC7 offline | `src/client/offline/{outbox,sync}.test.ts` | `idempotency.int.test.ts` (replay → `replayed:true`; different content → 409; changed price → `priceChanges`) | `tests/e2e/ac7-offline.spec.ts` |

## Architecture (short)

- **`src/domain`** is pure TypeScript with no framework, DB or zod imports, and is enforced by
  ESLint. It holds all money rules in integer cents and integer SDG:
  - `lineValue`, `classify` (exact integer comparison, never the rounded %), `effectiveState`;
  - `computeOrder`, and `sdgTotal` (computed in BigInt, rounded half up);
  - `canonicalOrderKey`, `parseUsdToCents`, and the `format*` helpers.

  The UI and the server both use it, so the badge on screen always agrees with the server.
- **`src/contracts`** holds the zod request schemas, response types and the `ErrorCode` union shared
  by client and server. Unknown fields (`role`, `unitPriceCents`, …) are stripped.
- **`src/server`**:
  - `auth/session.ts`: Bearer token or cookie, then the user is loaded from the DB.
  - `http/`: the error envelope, SQLSTATE mapping, and a route wrapper. The wrapper returns 415 for
    a non-JSON mutation, as a CSRF defence.
  - `services/`: one `upsertAndTransition` transaction serves draft PUT, save and request-approval.
    It locks the order, takes prices from the DB (`FOR SHARE`), validates, upserts the lines,
    recomputes, then saves or rolls back.
  - `approvals.ts` handles owner decisions, bound to `expectedTerms`.
- **API:** 13 JSON endpoints (plan §6.3), including demo-login, catalog, price and rate (owner),
  orders list/read/PUT, save, request/withdraw approval, and line decisions (owner).
- **Database:** CHECK constraints (rate between 8,000 and 100,000, qty from 1 to 10,000,
  discount ≤ value, …) plus the triggers above.

## Offline behaviour (spec §6, bonus)

- The **service worker** (`public/sw.js`) is registered only in production builds, and only after
  sign-in. After one online visit, it caches the `/orders`, `/order` and `/login` page shells
  (network first) and the static assets. `/api/*` is never served from the SW cache.
- **IndexedDB** stores the catalog (dealers, products, global rate), orders you have viewed, and an
  outbox with one entry per order. An offline "Save" is queued there. The top bar shows
  online/offline status and "N pending sync".
- **Sync** runs on the `online` event, on app start, and from "Sync now". Each queued save is
  replayed through the same `POST /api/orders/:id/save` handler.
  - The order id is the idempotency key. An identical replay returns `replayed: true`; different
    content returns 409.
  - The server validates everything again, and the server's price wins (reported in `priceChanges`).
  - A rejection (for example, a price change that makes a discount blocked) is kept on the order and
    shown there, never silently dropped.
- Online-only actions: request approval, the owner screens, and price and rate edits.

## Known gaps and notes

- Order numbers can have gaps. `INSERT … ON CONFLICT DO NOTHING` uses up an identity value on
  each conflicting call. This is cosmetic (plan §11.13).
- A lowered product price can leave an existing draft with a discount above its new line value.
  The server then refuses that line with 422 `DISCOUNT_EXCEEDS_LINE_VALUE` (listing its line id)
  until the discount is reduced. It never fails with a 500.
- The owner can also be the one who creates an order. Their own over-limit lines still go through
  request approval and a decision.

## Deployment

- Vercel project `delivery-order`, git-connected: pushes to `main` deploy automatically.
  `vercel.json` pins the Next.js preset and the `dub1` region, next to the database.
- Environment variables: `DATABASE_URL` (Supabase **transaction pooler**, port 6543) and
  `SESSION_SECRET` (`openssl rand -base64 48`). In production the DB client uses `ssl: 'require'`,
  `max: 3` and `prepare: false`.
- Migrations and seed run from a dev machine, never during the Vercel build. Use the Supabase
  **session pooler** URI as `DIRECT_URL`:
  `NODE_ENV=production pnpm exec tsx --env-file=.env.production.local scripts/migrate.ts`, then
  the same command with `scripts/seed.ts`.

## What I would do differently in a real build

- **Real identity:** an IdP or SSO with per-organisation tenancy, roles managed there, short-lived
  tokens with refresh, and CSRF tokens rather than relying on SameSite plus a JSON-only rule.
- **Audit trail:** an append-only log of price changes, rate changes and approval decisions (who,
  when, old → new). Approvals would be separate rows with history, not columns on the line.
- **Offline with conflict resolution:** per-user encrypted local storage that is wiped on sign-out.
  Background Sync where supported, and an explicit merge UI when the server copy moved on.
  Consider a sync engine (e.g. Replicache or PowerSync) rather than a hand-rolled outbox.
- **Operations:**
  - migrations in CI/CD with a gated production step;
  - separate preview databases (Supabase branching);
  - error tracking and structured logs;
  - rate limiting on the API;
  - load tests on the save path.
- **Money and FX:** store the rate source and timestamp, support more currencies and decimal SDG if
  the business needs it, and generate invoices from saved-order snapshots.
- **Testing:** property-based tests for the money module, contract tests generated from the zod
  schemas (OpenAPI), and broader e2e coverage for AC3–AC6 in the UI.
