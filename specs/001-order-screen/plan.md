# Plan 001 — The Order Screen

**Status: READY FOR IMPLEMENTATION** (plan-review.md APPROVE WITH CHANGES — all blockers, majors
and minors applied; see Revision log at the end).

Inputs: `spec.md` (source of truth, APPROVED), `design.md` (UI). This plan defines architecture,
data model, API contract, the shared domain module, offline design, tests and deployment.
Tasks are in `tasks.md`. No application code here.

Guiding principle for a 2-day build: **one pure domain module, one Postgres schema with guards,
one small set of JSON endpoints, one hand-written service worker.** No extra services, no queues,
no state libraries.

---

## 1. Stack and library choices

| Concern | Choice | Why |
|---|---|---|
| Framework | Next.js 16.x, **exact version pinned in B0** (the one `create-next-app@latest` installs; recorded here and in README — no `^`), App Router, `src/` dir, TypeScript `strict` | Fixed by brief. Route Handlers give us a plain JSON API testable without a browser. B0 verifies that this version uses `src/proxy.ts` (fallback: `src/middleware.ts`) and builds with Turbopack. Static `/order` shell reads `useSearchParams` → must be wrapped in `<Suspense>` or `next build` fails. |
| Styling | Tailwind CSS v4 (CSS-first `@theme` in `globals.css`) + `lucide-react` icons | Fixed by brief; design.md tokens map 1:1 into `@theme` (design shows a v3-style `tailwind.config.ts` excerpt — same values, expressed as `--color-sand-100` etc.). |
| DB | PostgreSQL 17 (docker locally, Supabase in prod) | Fixed. |
| DB access | Drizzle ORM + `postgres` (postgres-js) | Typed queries, SQL-first migrations, custom SQL migrations for triggers, tiny runtime. `prepare: false` so it works with Supabase's transaction pooler. |
| Validation | `zod` (v4) | One schema set in `src/contracts` used by route handlers and the client. |
| Session | `jose` (HS256 JWT) | Edge/Node compatible, no auth framework needed for a demo login. |
| Unit + integration tests | `vitest` (two projects: `unit`, `integration`) + `fake-indexeddb` for client storage tests + `@testing-library/react` (jsdom) for 2–3 component tests | One runner for everything except e2e. |
| E2E | Playwright (Chromium only) against `next build && next start` | Service worker only runs in the production build. |
| Offline | Hand-written `public/sw.js` + `idb` | Serwist's Next integration is tied to webpack while Next 16 builds with Turbopack by default; a ~120-line SW we fully understand is lower risk than a plugin fight. `idb` is a thin promise wrapper over IndexedDB. |
| Package manager / runtime | pnpm 10, Node 22 | Installed. |

Explicitly **not** used: NextAuth/Auth.js (overkill for demo login), React Query/Redux (a small
`useOrder` hook + IndexedDB is enough), Supabase JS client/RLS (Supabase is plain Postgres here),
Background Sync API (not in Safari; replay is triggered from the page instead).

---

## 2. Folder structure

```
order-screen/
├─ docker-compose.yml            # postgres:17, creates order_screen + order_screen_test DBs
├─ docker/initdb/01-test-db.sql  # CREATE DATABASE order_screen_test;
├─ drizzle.config.ts             # uses DIRECT_URL ?? DATABASE_URL
├─ drizzle/                      # generated SQL migrations (+ custom 0001_guards.sql)
├─ next.config.ts                # generateBuildId + NEXT_PUBLIC_BUILD_ID for SW versioning
├─ playwright.config.ts
├─ vitest.config.ts              # projects: unit (node/jsdom), integration (node, real PG)
├─ .env.example
├─ scripts/
│  ├─ seed.ts                    # idempotent seed (tsx)
│  ├─ reset-db.ts                # drop schema, migrate, seed (local/test only; refuses if NODE_ENV=production)
│  └─ prove-server-refusal.sh    # AC2 curl proof
├─ public/
│  ├─ sw.js                      # service worker (hand-written)
│  └─ manifest.webmanifest
├─ src/
│  ├─ domain/                    # PURE: no imports from next, db, react, zod, browser APIs
│  │  ├─ money.ts                # cents helpers, divRoundHalfUp, parse/format USD/SDG/percent
│  │  ├─ line.ts                 # lineValue, lineTotal, discountBasisPoints, classify
│  │  ├─ approval.ts             # LineTerms, sameTerms, effectiveState
│  │  ├─ rate.ts                 # MIN_RATE=8000, MAX_RATE, checkRate
│  │  ├─ order.ts                # computeOrder (lines + totals + canSave + blockingLineIds), canonicalize
│  │  ├─ limits.ts               # MAX_QTY, MAX_UNIT_PRICE_CENTS, MAX_LINES
│  │  └─ index.ts
│  ├─ contracts/                 # zod schemas + inferred TS types + ErrorCode union (shared server/client)
│  │  ├─ api.ts
│  │  └─ errors.ts
│  ├─ server/                    # server-only (import 'server-only')
│  │  ├─ db/{schema.ts,client.ts}
│  │  ├─ auth/session.ts         # sign/verify, getSession(req), requireUser(req, role?)
│  │  ├─ http/{errors.ts,route.ts}  # ApiError, toErrorResponse, pg error mapping, route() wrapper
│  │  └─ services/{catalog.ts,orders.ts,approvals.ts,settings.ts,views.ts}
│  ├─ app/
│  │  ├─ layout.tsx, globals.css, sw-register.tsx
│  │  ├─ login/page.tsx
│  │  ├─ orders/page.tsx               # orders list (client component; offline-capable)
│  │  ├─ order/page.tsx                # order screen + saved view, ?id=<uuid> (static shell; offline-capable)
│  │  ├─ approvals/[id]/page.tsx       # owner approval view (online only)
│  │  ├─ settings/page.tsx             # owner settings (online only)
│  │  └─ api/ … (see §6)
│  ├─ client/
│  │  ├─ api.ts                  # typed fetch wrapper → { ok, data } | { ok:false, error }
│  │  ├─ offline/{db.ts,catalog.ts,orders.ts,outbox.ts,sync.ts,useOnline.ts}
│  │  └─ hooks/useOrder.ts
│  ├─ components/                # design.md §6 inventory, 1:1 names
│  └─ proxy.ts                   # Next 16 "proxy" (ex-middleware): page redirect to /login if no cookie
└─ tests/
   ├─ integration/               # route handlers + DB guards against real Postgres
   ├─ helpers/                   # db reset, token factory, request builder
   └─ e2e/                       # Playwright specs
```

Why `/order?id=` instead of `/orders/[id]`: the order screen must open offline for orders created
offline. A single static route (query param read on the client) is one cacheable HTML document for
the service worker; dynamic segments would each need to be cached individually.

---

## 3. Shared pure domain module (`src/domain`)

All values are JS `number`s that are **integers**; every function asserts
`Number.isSafeInteger` on inputs/outputs and throws `DomainError` otherwise. Input limits keep every
intermediate in the safe range (checked by zod on the server, by the UI on input):

| Limit | Value | Rationale |
|---|---|---|
| `MAX_QTY` | 10,000 | |
| `MAX_UNIT_PRICE_CENTS` | 10,000,000 ($100,000) | line value ≤ 1e11 cents |
| `MAX_LINES` | 50 | order total ≤ 5e12 cents |
| `MIN_RATE` / `MAX_RATE` | 8,000 / 100,000 | SDG total ≤ 5e15 < 2^53 |

The only multiplication that could exceed 2^53 (`totalCents × rate`) is done in `BigInt` inside
`sdgTotal` and converted back after a safe-range check.

### 3.1 API of the module

```ts
type Cents = number;           // integer USD cents
type Sdg = number;             // integer SDG
type LineState = 'sand' | 'red' | 'blocked' | 'approved';
type ApprovalStatus = 'none' | 'pending' | 'approved' | 'rejected';
interface LineTerms { productId: string; qty: number; unitPriceCents: Cents; discountCents: Cents }
interface LineApproval { status: ApprovalStatus; terms: LineTerms | null } // terms = approved_* columns

lineValue(qty, unitPriceCents): Cents                       // R2
lineTotal(qty, unitPriceCents, discountCents): Cents        // R2 (throws if discount<0 or > value)
discountBasisPoints(discountCents, lineValueCents): number  // R3 display: round-half-up(discount*10000/value), integer "hundredths of a percent"
classify(discountCents, lineValueCents): 'sand'|'red'|'blocked'   // R3, integer comparisons only:
   //  d*100 <= 3*v → sand ; d*100 <= 5*v → red ; else blocked
sameTerms(a: LineTerms, b: LineTerms): boolean              // R4
effectiveState(terms, approval): LineState                  // blocked + approved + sameTerms → 'approved'
checkRate(rate): { ok: true } | { ok: false; code: 'RATE_BELOW_MINIMUM' | 'RATE_ABOVE_MAXIMUM' | 'RATE_NOT_INTEGER' } // R5
sdgTotal(totalCents, rate): Sdg                             // R8: divRoundHalfUp(totalCents*rate, 100) via BigInt
computeOrder({ rate, lines: (LineTerms & { id; approval })[] }) → {
   lines: { id, lineValueCents, lineTotalCents, discountBasisPoints, classification, state }[],
   totalUsdCents, totalSdg, blockingLineIds: string[], canSave: boolean }   // R8, lifecycle save rule
canonicalOrderKey({ dealerId, rate, lines }) : string        // idempotency comparison (lines sorted by position: id,productId,qty,discountCents)
divRoundHalfUp(n, d)                                        // exact integer rounding via remainder, no float division
parseUsdToCents("40" | "40.5" | "40.50" | "1,550"): Cents | null   // string parsing, no parseFloat
formatUsd(cents)   // 202000 → "$2,020"; 155050 → "$1,550.50"  (design.md §2)
formatSdg(sdg)     // 29274000 → "29,274,000 SDG"
formatPercent(bp)  // 194 → "1.94%"
formatRate(rate)   // 8200 → "8,200 SDG/USD"
```

Formatting uses integer arithmetic + `Intl.NumberFormat('en-US')` on integers only (dollars part);
never divides cents as floats.

### 3.2 AC1 numbers the unit tests must reproduce

| Line | value (cents) | discount | `d*100` vs `3v` / `5v` | class | bp → display | total |
|---|---|---|---|---|---|---|
| 4×51,500 | 206,000 | 4,000 | 400,000 ≤ 618,000 | sand | 194.17→194 → 1.94% | 202,000 |
| 2×81,000 | 162,000 | 7,000 | 700,000 > 486,000, ≤ 810,000 | red | 432.09→432 → 4.32% | 155,000 |
| 1×207,000 | 207,000 | 15,000 | 1,500,000 > 1,035,000 | blocked | 724.64→725 → 7.25% | 192,000 |

Totals: 357,000 × 8,200 / 100 = 29,274,000 SDG; 549,000 × 8,200 / 100 = 45,018,000 SDG.
Boundaries: discount exactly 3.00% (e.g. 3,000 of 100,000) → sand; exactly 5.00% → red; 5,001 of
100,000 → blocked; a value whose % *displays* as 5.00% but is > 5 (e.g. 50,001 of 1,000,000 =
5.0001%) → blocked (proves no display rounding in classification).

---

## 4. Data model (PostgreSQL)

### 4.1 Tables (migration `0000_init`, generated by drizzle-kit from `schema.ts`)

```sql
CREATE TYPE user_role       AS ENUM ('adviser', 'owner');
CREATE TYPE order_status    AS ENUM ('draft', 'pending_approval', 'saved');
CREATE TYPE approval_status AS ENUM ('none', 'pending', 'approved', 'rejected');

CREATE TABLE users (
  id    uuid PRIMARY KEY,
  name  text NOT NULL,
  role  user_role NOT NULL
);

CREATE TABLE dealers (
  id    uuid PRIMARY KEY,
  name  text NOT NULL UNIQUE,
  city  text NOT NULL
);

CREATE TABLE products (
  id               uuid PRIMARY KEY,
  sku              text NOT NULL UNIQUE,
  name             text NOT NULL,
  unit_price_cents integer NOT NULL CHECK (unit_price_cents > 0 AND unit_price_cents <= 10000000),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app_settings (               -- singleton row
  id          smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  global_rate integer NOT NULL CHECK (global_rate >= 8000 AND global_rate <= 100000),   -- R5/R6
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES users(id)
);

CREATE TABLE orders (
  id               uuid PRIMARY KEY,         -- client-generated; the idempotency key (offline)
  number           integer GENERATED ALWAYS AS IDENTITY UNIQUE,   -- display "#1042"
  created_by       uuid NOT NULL REFERENCES users(id),
  dealer_id        uuid NOT NULL REFERENCES dealers(id),
  status           order_status NOT NULL DEFAULT 'draft',
  rate             integer NOT NULL CHECK (rate >= 8000 AND rate <= 100000),   -- R5, R7 snapshot
  total_usd_cents  bigint,                   -- set only when saved (R8 snapshot)
  total_sdg        bigint,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  saved_at         timestamptz,
  CONSTRAINT saved_has_snapshot CHECK (
    (status = 'saved') = (saved_at IS NOT NULL AND total_usd_cents IS NOT NULL AND total_sdg IS NOT NULL))
);
CREATE INDEX orders_created_by_idx ON orders(created_by, updated_at DESC);
CREATE INDEX orders_status_idx ON orders(status);

CREATE TABLE order_lines (
  order_id                   uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  id                         uuid NOT NULL,          -- client-generated line id
  position                   integer NOT NULL CHECK (position >= 0),
  product_id                 uuid NOT NULL REFERENCES products(id),
  qty                        integer NOT NULL CHECK (qty >= 1 AND qty <= 10000),                 -- R2
  unit_price_cents           integer NOT NULL CHECK (unit_price_cents > 0),                      -- R1/R7 snapshot
  discount_cents             bigint  NOT NULL CHECK (discount_cents >= 0),
  approval_status            approval_status NOT NULL DEFAULT 'none',
  approved_product_id        uuid,
  approved_qty               integer,
  approved_unit_price_cents  integer,
  approved_discount_cents    bigint,
  decided_by                 uuid REFERENCES users(id),
  decided_at                 timestamptz,
  PRIMARY KEY (order_id, id),
  CONSTRAINT discount_le_value CHECK (discount_cents <= qty::bigint * unit_price_cents),          -- R2
  CONSTRAINT approved_has_terms CHECK (
    (approval_status = 'approved') = (approved_product_id IS NOT NULL AND approved_qty IS NOT NULL
      AND approved_unit_price_cents IS NOT NULL AND approved_discount_cents IS NOT NULL))
);
```

Approval is stored on the line together with the **exact terms approved** (R4). A line is
"approved" only if `approval_status='approved'` AND the approved_* columns equal the current terms.

### 4.2 Guards (custom migration `0001_guards.sql`, `drizzle-kit generate --custom`)

All trigger errors use custom SQLSTATEs so the API can map them (`src/server/http/errors.ts`):
`OS409` → 409 `ORDER_IMMUTABLE`, `OS422` → 422 with the code in `MESSAGE` (`UNAPPROVED_BLOCKED_LINES`,
`EMPTY_ORDER`, `PRICE_MISMATCH`), `OS500` → 500 `TOTALS_MISMATCH` (should be impossible; indicates a bug).

1. **`orders_insert_guard`** — `BEFORE INSERT ON orders`: `NEW.status` must be `'draft'`
   (an order can only become saved through the validated transition below). → `OS422`.
2. **`orders_immutable_guard`** — `BEFORE UPDATE OR DELETE ON orders`: if `OLD.status = 'saved'` → `OS409`.
3. **`order_lines_immutable_guard`** — `BEFORE INSERT OR UPDATE OR DELETE ON order_lines`: if the
   parent order's status is `'saved'` → `OS409`. (R7: saved lines/prices can never change.)
4. **`order_lines_void_approval`** — `BEFORE UPDATE ON order_lines`: if
   `(product_id, qty, unit_price_cents, discount_cents) IS DISTINCT FROM OLD.(…)` then set
   `approval_status='none'`, clear `approved_*`, `decided_*`. (R4/AC6 in the DB: an approval never
   survives a terms change even if the app forgets.)
5. **`orders_validate_save`** — `BEFORE UPDATE OF status ON orders WHEN (NEW.status = 'saved' AND OLD.status <> 'saved')`:
   - no lines → `OS422 EMPTY_ORDER`;
   - any line with `discount_cents*100 > 5*qty*unit_price_cents` **and not**
     (`approval_status='approved'` and `approved_*` = current terms) → `OS422 UNAPPROVED_BLOCKED_LINES`
     with `DETAIL` = comma-separated line ids;  **(AC2 DB-level guard)**
   - any line whose `unit_price_cents <> products.unit_price_cents` → `OS422 PRICE_MISMATCH` (R1 in DB:
     a saved order's prices are the DB prices at save time);
   - `NEW.total_usd_cents` must equal `Σ(qty*unit_price_cents − discount_cents)` and `NEW.total_sdg`
     must equal `(total*rate + 50) / 100` (integer division, non-negative ⇒ half-up) → else `OS500`.
     (R8 cross-check of the domain module; same formula.)

Trigger ordering note: Postgres fires same-event triggers alphabetically; names above are chosen so
guards run before validation. The save transaction locks the referenced product rows `FOR SHARE`
so an owner price edit cannot race between the app's price read and the trigger's check.

### 4.3 Migrations and seed

- `pnpm db:generate` (drizzle-kit generate) → SQL in `drizzle/`; committed.
- `pnpm db:migrate` (drizzle-kit migrate) uses `DIRECT_URL` if set, else `DATABASE_URL`.
- `pnpm db:seed` (`tsx scripts/seed.ts`) — idempotent: `INSERT … ON CONFLICT (id) DO NOTHING`
  (never overwrites an owner-edited price or rate). Fixed UUIDs so tests/scripts can reference them.
- `pnpm db:reset` — local/test only: drop & recreate `public` + `drizzle` schemas, migrate, seed.

Seed data (names from design.md):

| Kind | Rows |
|---|---|
| users | `Amina` (adviser), `Yusuf` (owner) |
| dealers | Al-Noor Trading (Khartoum), Kordofan Supplies (El-Obeid), Blue Nile Traders (Wad Madani), Red Sea Agro (Port Sudan) |
| products | `PUMP-01` Water pump $515 (51,500), `FILT-02` Filter $810 (81,000), `BATT-03` Battery $2,070 (207,000), `HOSE-04` Hose kit $45 (4,500), `CTRL-05` Controller $120 (12,000) |
| app_settings | `global_rate = 8200` |

---

## 5. Auth and session

- `POST /api/auth/demo-login { role }` finds the seeded user with that role, signs a JWT
  (`jose`, HS256, `SESSION_SECRET` ≥ 32 bytes) with claims `{ sub: userId, iat, exp: +12h }` —
  **no role in the token**. Sets cookie `os_session` (`HttpOnly; SameSite=Lax; Path=/; Secure` in
  production; Max-Age 12h) and returns `{ token, user }` so reviewers can `curl` with
  `Authorization: Bearer <token>` (design.md "Copy API token").
- `getSession(req: Request)` reads `Authorization: Bearer` first, else the `os_session` cookie from
  `req.headers` (not `next/headers`, so handlers are directly callable in integration tests), verifies
  the JWT, then **loads the user from the DB** → role comes from `users.role` only. Anything like
  `role`/`userId`/`createdBy` in a request body is not part of any schema and is ignored (zod
  `strip`).
- `requireUser(req, 'owner')` → 401 `UNAUTHENTICATED` / 403 `FORBIDDEN`.
- `src/proxy.ts` only redirects page navigations without a cookie to `/login` (UX, not security);
  every API handler authenticates itself.
- CSRF: `SameSite=Lax` cookie + all mutations require `Content-Type: application/json` (rejected with
  415 otherwise), which a cross-site form cannot send without a CORS preflight. Adequate for a demo.
- Demo caveat (documented in README): anyone can log in as owner — it is a demo login by spec.

---

## 6. HTTP API contract

Base: same origin, JSON only. Auth: cookie **or** `Authorization: Bearer <token>`.
Money: integer cents (`…Cents`), SDG integers, rate integer, percentages as integer basis points
(`discountBasisPoints: 725` = 7.25%). IDs: UUID v4 strings.

### 6.1 Error envelope

```json
{ "error": { "code": "UNAPPROVED_BLOCKED_LINES", "message": "Line(s) need owner approval before saving.",
             "details": { "lineIds": ["…"] } } }
```

| HTTP | `code` | When | `details` |
|---|---|---|---|
| 400 | `VALIDATION_FAILED` | zod failure (types, qty < 1 or > max, negative discount, bad uuid, > 50 lines, duplicate line ids) | `{ issues: [{ path, message }] }` |
| 401 | `UNAUTHENTICATED` | missing/invalid/expired token | |
| 403 | `FORBIDDEN` | wrong role (AC5) | |
| 404 | `NOT_FOUND` | unknown id, or an adviser accessing another user's order | |
| 409 | `ORDER_ALREADY_SAVED` | save replay whose content differs from the saved order | `{ order: OrderView }` |
| 409 | `ORDER_IMMUTABLE` | PUT / request-approval / withdraw on a saved order (also DB `OS409`) | |
| 409 | `ORDER_NOT_EDITABLE` | adviser PUT/save on an order in `pending_approval` (must withdraw first) | |
| 409 | `LINE_TERMS_CHANGED` | owner decision whose `expectedTerms` ≠ current line terms | `{ line: LineView }` |
| 409 | `LINE_NOT_PENDING` | owner decision on a line that is not `pending` | |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | mutation without `application/json` | |
| 422 | `RATE_BELOW_MINIMUM` | rate < 8,000 (AC3) — never clamped | `{ min: 8000 }` |
| 422 | `RATE_ABOVE_MAXIMUM` | rate > 100,000 | `{ max: 100000 }` |
| 422 | `UNKNOWN_DEALER` | | |
| 422 | `UNKNOWN_PRODUCT` | | `{ lineIds }` |
| 422 | `DISCOUNT_EXCEEDS_LINE_VALUE` | discount > qty × **DB** price | `{ lineIds }` |
| 422 | `EMPTY_ORDER` | save / request-approval with 0 lines | |
| 422 | `UNAPPROVED_BLOCKED_LINES` | save with a blocked line lacking a valid approval (AC2; also DB `OS422`) | `{ lineIds }` |
| 422 | `NO_LINES_NEED_APPROVAL` | request-approval when no line is blocked-and-unapproved | |
| 422 | `PRICE_MISMATCH` | DB guard only (should not reach clients) | `{ lineIds }` |
| 500 | `INTERNAL` / `TOTALS_MISMATCH` | bugs | |

Validation order in order mutations: auth → zod → ownership/status → rate → dealer/products →
discount ≤ value → lifecycle rule. First failing class wins; line-level codes list **all** offending
lines.

### 6.2 Shared shapes (`src/contracts/api.ts`)

```ts
OrderInput = {                       // body of PUT /api/orders/:id, /save, /request-approval
  dealerId: uuid,
  rate: int,                         // domain checks >= 8000 → RATE_BELOW_MINIMUM (not a zod error)
  lines: Array<{
    id: uuid, productId: uuid, qty: int 1..10000, discountCents: int >= 0,
    clientUnitPriceCents?: int       // OPTIONAL, informational only: used to report priceChanges; NEVER used for math (R1)
  }>  // max 50, unique ids; array order = position
}

LineView = {
  id, position, product: { id, sku, name },
  qty, unitPriceCents, discountCents,
  lineValueCents, lineTotalCents, discountBasisPoints,
  classification: 'sand'|'red'|'blocked',     // raw R3 class
  state: 'sand'|'red'|'blocked'|'approved',   // effective (R4)
  approval: { status: 'none'|'pending'|'approved'|'rejected', decidedBy: { id, name } | null, decidedAt: string | null }
}

OrderView = {
  id, number, status: 'draft'|'pending_approval'|'saved',
  createdBy: { id, name }, dealer: { id, name, city }, rate,
  lines: LineView[],
  totals: { usdCents, sdg },                  // saved: stored snapshot; otherwise computed live
  canSave: boolean, blockingLineIds: string[],
  createdAt, updatedAt, savedAt: string | null
}

OrderSummary = { id, number, status, dealer: { id, name }, createdBy: { id, name }, rate,
                 totalUsdCents, lineCount, blockedLineCount, hasRejectedLines, updatedAt, savedAt }

Catalog = { dealers: {id,name,city}[], products: {id,sku,name,unitPriceCents,updatedAt}[],
            globalRate: int, fetchedAt: string }

PriceChange = { lineId, productId, clientUnitPriceCents, serverUnitPriceCents }
```

### 6.3 Endpoints

| # | Method & path | Role | Request | 2xx response | Errors |
|---|---|---|---|---|---|
| E1 | `POST /api/auth/demo-login` | public | `{ role: 'adviser'\|'owner' }` | 200 `{ token, expiresAt, user: {id,name,role} }` + Set-Cookie | 400 |
| E2 | `POST /api/auth/logout` | any | – | 204, cookie cleared | |
| E3 | `GET /api/me` | any authed | – | 200 `{ user }` | 401 |
| E4 | `GET /api/catalog` | any authed | – | 200 `Catalog` (`Cache-Control: no-store`) | 401 |
| E5 | `PATCH /api/products/:id` | **owner** | `{ unitPriceCents }` | 200 `{ product }` | 400, 401, 403, 404 |
| E6 | `PUT /api/settings/global-rate` | **owner** | `{ globalRate }` | 200 `{ globalRate, updatedAt }` | 401, 403, 422 `RATE_BELOW_MINIMUM` |
| E7 | `GET /api/orders?status=&limit=` | any authed | `status` ∈ draft\|pending_approval\|saved (optional) | 200 `{ orders: OrderSummary[], counts: { pendingApproval } }` — adviser: own only; owner: all | 400, 401 |
| E8 | `GET /api/orders/:id` | creator or owner | – | 200 `OrderView` | 401, 404 |
| E9 | `PUT /api/orders/:id` | adviser/owner (creator) | `OrderInput` | 200 `OrderView` (created or updated **draft**), `+ priceChanges` | 400, 401, 404, 409 `ORDER_IMMUTABLE`/`ORDER_NOT_EDITABLE`, 422 rate/dealer/product/discount |
| E10 | `POST /api/orders/:id/save` | creator | `OrderInput` | 200 `{ order: OrderView, replayed: boolean, priceChanges: PriceChange[] }` | 400, 401, 404, 409 `ORDER_ALREADY_SAVED`/`ORDER_NOT_EDITABLE`, 422 (incl. `UNAPPROVED_BLOCKED_LINES`) |
| E11 | `POST /api/orders/:id/request-approval` | creator | `OrderInput` | 200 `{ order, priceChanges }` (status `pending_approval`) | as E9 + 422 `NO_LINES_NEED_APPROVAL`, `EMPTY_ORDER` |
| E12 | `POST /api/orders/:id/withdraw-approval` | creator | `{}` | 200 `{ order }` (status `draft`, `pending` lines → `none`) | 401, 404, 409 |
| E13 | `POST /api/orders/:id/lines/:lineId/decision` | **owner** | `{ decision: 'approve'\|'reject', expectedTerms: { productId, qty, unitPriceCents, discountCents } }` | 200 `{ order }` | 401, 403, 404, 409 `LINE_TERMS_CHANGED`/`LINE_NOT_PENDING` |

Order ownership: orders belong to `created_by`. Adviser sees/edits only own orders (others → 404).
Owner can read all orders and create/edit/save their own (spec: owner can do everything an adviser
can), and decides lines on any `pending_approval` order.

### 6.4 Order mutation semantics (one service: `upsertAndTransition`)

All of E9/E10/E11 run in **one transaction**:

1. `INSERT INTO orders (id, created_by, dealer_id, rate, status) VALUES (…, 'draft') ON CONFLICT (id) DO NOTHING`
   (only after rate + dealer validation, so an invalid request never creates a row);
   `SELECT … FOR UPDATE` the order.
2. Not creator → 404. `saved`: for E10 compare `canonicalOrderKey(input)` with the saved order →
   equal ⇒ return it with `replayed: true` (200, idempotent replay); different ⇒ 409
   `ORDER_ALREADY_SAVED` (with the saved order so the client can show it). For E9/E11 → 409
   `ORDER_IMMUTABLE`. `pending_approval` → 409 `ORDER_NOT_EDITABLE` for E9/E10/E11 (design.md:
   pending orders are read-only until withdrawn or fully decided; once the owner decides the last
   pending line the order is `draft` again, so no exception is needed). The client never autosaves
   a pending order.
3. Load products `FOR SHARE`; unknown → 422 `UNKNOWN_PRODUCT`. **Unit prices come from this read
   (R1).** `priceChanges` = lines whose `clientUnitPriceCents` differs.
4. Validate `discountCents ≤ qty × dbPrice` for every line → 422 `DISCOUNT_EXCEEDS_LINE_VALUE`.
5. Upsert lines (`ON CONFLICT (order_id,id) DO UPDATE`), delete lines absent from input, update
   `dealer_id, rate, updated_at`. The `DO UPDATE SET` list is **exactly**
   `product_id, qty, unit_price_cents, discount_cents, position` — the upsert **never writes**
   `approval_status`, `approved_*` or `decided_*`. Voiding is done solely by trigger 4, which fires
   only when a term is `IS DISTINCT FROM` the old value; an autosave with unchanged terms therefore
   keeps an approval (M-1). New lines are inserted with `approval_status='none'`.
6. Re-read lines, `computeOrder()` (domain).
   - E9: done (commit), return view.
   - E11: `EMPTY_ORDER` if no lines; `NO_LINES_NEED_APPROVAL` if `blockingLineIds` empty; else set
     blocking lines `approval_status='pending'` (rejected lines are re-requested), order →
     `pending_approval`.
   - E10: if `!canSave` → throw 422 `UNAPPROVED_BLOCKED_LINES { lineIds: blockingLineIds }` →
     **ROLLBACK** (nothing persisted: no saved order, not even the draft rows from this request —
     AC2). Else `UPDATE orders SET status='saved', total_usd_cents, total_sdg, saved_at=now()` — the
     DB trigger re-checks everything (defence in depth). Any `OS4xx` from the trigger is mapped to
     the same error codes.

E13 (owner decision): lock order + line; order must be `pending_approval`, line `pending` (else
`LINE_NOT_PENDING`); `expectedTerms` must equal current terms (else `LINE_TERMS_CHANGED`);
approve ⇒ `approval_status='approved'`, `approved_* = current terms`, `decided_by/at`; reject ⇒
`'rejected'`, `approved_*` NULL, `decided_*` set. **When no line of the order remains `pending`, the
order automatically returns to `draft`** (resolves design.md open question 3: no separate "Return to
adviser" call; the approval view shows "All lines decided — returned to Amina" and a back link).
The adviser then saves (approved lines count as `approved`) or edits rejected lines.

---

## 7. Frontend architecture (summary; UI details in design.md)

- All app pages are **client components inside static route shells** (no `cookies()` in pages), so
  the HTML is cacheable by the SW. Data comes from the JSON API (online) or IndexedDB (offline).
- `src/client/api.ts` — typed fetch returning `{ ok: true, data } | { ok: false, status, error }`;
  network failure → `{ ok: false, status: 0, error: { code: 'NETWORK' } }`.
- **All numbers on screen go through `src/domain`** (`computeOrder`, `format*`). Components never do
  money arithmetic.
- Order screen state = `OrderInput` + server snapshot; live `computeOrder` using catalog prices for
  immediate feedback; server response replaces it after each save/draft sync.
- Discount entry (stakeholder decision): the UI accepts dollars **with up to 2 decimals**
  (`inputmode="decimal"`, e.g. `40`, `40.5`, `1,550.50`), parsed with `parseUsdToCents` (string
  parsing, no floats); more than 2 decimals or non-numeric → field error "Enter a dollar amount with
  up to 2 decimals." The API takes integer cents. The owner's price edit uses the same parser.
  Discount > value → reset to value on blur (UI, copy uses `formatUsd`, so `$X` may show cents);
  server still rejects with `DISCOUNT_EXCEEDS_LINE_VALUE`.
- Rate field: on blur/Enter, `< 8000` → value set to 8000 + message "Rate can't be below 8,000
  SDG/USD — reset to the minimum." (AC3 UI). Server 422 `RATE_BELOW_MINIMUM` → banner + refocus.
- Server errors with `details.lineIds` outline those rows (`ErrorBanner` + row state).
- Drafts are auto-synced (debounced 800 ms `PUT`) while online; offline they go to the outbox (§8).
- Role-aware nav: Settings + Awaiting approval only for owner; direct URL → full-page 403 state
  based on `GET /api/me` (server still returns 403 on any owner API).
- Read-only rendering of `/order` (m-6): when the viewer is not the creator (owner opening an
  adviser's order), or the order is `pending_approval`, or the order has a queued `save` in the
  outbox (m-3, shown as `SavedOrderView` with a "Queued" tag), the screen renders without inputs or
  Save/Request buttons. An owner opening a pending order from the list is routed to `/approvals/[id]`.

Routes: `/login`, `/orders`, `/order?id=` (new order: client generates `crypto.randomUUID()` and
replaces URL), `/approvals/[id]` (owner), `/settings` (owner). `/order` renders `SavedOrderView`
when `status === 'saved'` (design.md §3.6 "saved orders route to their own view" — same URL, separate
read-only component tree).

---

## 8. Offline architecture (spec §6, AC7)

### 8.1 Service worker (`public/sw.js`, registered only in production builds)

- **Registered only after authentication** (B-2): `sw-register.tsx` calls
  `navigator.serviceWorker.register` only once `GET /api/me` has returned 200 (i.e. on `/orders` or
  `/order`, never on `/login` before sign-in), so the SW never observes the unauthenticated
  `proxy.ts` redirect as a shell page.
- Registered as `/sw.js?v=<NEXT_PUBLIC_BUILD_ID>`; the SW reads its version from
  `self.location.search` and names caches `shell-<v>`, `static-<v>`; `activate` deletes old caches,
  `clients.claim()`; `skipWaiting()` on install. **No install-time precache and no HTML parsing.**
- `fetch` (runtime caching only):
  - navigations to `/order`, `/orders`, `/login` → network-first (3 s timeout). A network response
    is `cache.put` under its pathname (search stripped) **only if**
    `response.ok && !response.redirected && response.type === 'basic'`. Offline/timeout → cached
    shell for that pathname (`ignoreSearch: true`); if none, cached `/orders`; if none, a minimal
    inline "You're offline" response. Other navigations → network only.
  - `/_next/static/*`, fonts, icons → cache-first, populated on first request.
  - Consequence (accepted): a screen works offline after it has been visited online once in the
    current build — the AC7 e2e visits `/orders` and `/order` online first.
  - `/api/*` → **not intercepted** (data offline comes from IndexedDB, not HTTP caches; avoids
    serving stale authenticated JSON).
- Links between offline-capable pages use plain `<a href>` (full navigation served by the SW) rather
  than `next/link` soft navigation, which would need cached RSC payloads.

### 8.2 IndexedDB (`idb`, database `order-screen`, version 1)

| Store | Key | Value |
|---|---|---|
| `meta` | key | `me` (user), `catalog` (`Catalog`), `lastSyncAt` |
| `orders` | `id` | `LocalOrder = { id, input: OrderInput, server: OrderView \| null, syncState: 'local'\|'queued'\|'syncing'\|'synced'\|'rejected', lastError: ApiError \| null, priceChanges: PriceChange[], updatedAt }` |
| `outbox` | `orderId` | `{ orderId, intent: 'draft'\|'save', payload: OrderInput, enqueuedAt, attempts, nextAttemptAt }` — one entry per order (latest wins; `save` never downgraded to `draft`) |

- Catalog refreshed on app start/online and after owner edits; `me` stored at login and on `/api/me`.
- Orders viewed or listed online are written to `orders` (so they open offline).
- New orders offline are pre-filled with the cached `globalRate` (R6) and cached prices (§6 spec).

### 8.3 Sync engine (`src/client/offline/sync.ts`)

- Triggers (trimmed, B-3): `online` event, app start, and manual "Sync now" on the pending chip.
  Single-flight per tab (in-memory flag). No timer, no `visibilitychange`, no cross-tab locks —
  server idempotency makes a duplicate replay from a second tab harmless.
- For each outbox entry (FIFO): `save` → `POST /api/orders/:id/save`; `draft` → `PUT /api/orders/:id`.
  - 2xx → remove from outbox, `orders.server = response`, `syncState='synced'`, store `priceChanges`
    (UI shows design.md "price changed" banner once).
  - 409 `ORDER_ALREADY_SAVED` → `synced` with server copy + notice.
  - 401 → stop the run, keep queue, UI "Sign in to sync".
  - other 4xx → remove from outbox, `syncState='rejected'`, `lastError` stored, order stays locally
    and is shown with the error on its lines (**never silently dropped**); it becomes editable again
    and user edits → re-queued.
- An order whose outbox intent is `save` is **read-only locally** (`SavedOrderView` + "Queued" tag)
  until it syncs or is rejected (m-3), so a locally "saved" order is never silently changed.
  - 0 (network) / 5xx → keep, `attempts++`, stop this run (retried on the next trigger).
- Indicator: `OnlineOfflineIndicator` = `navigator.onLine` + last request outcome; `N pending sync`
  = count of outbox entries.
- Request approval, withdraw, owner screens: online-only (buttons disabled offline with a tooltip).

### 8.4 Why replay cannot bypass validation

The replay calls exactly the same E10 handler as an online save: role from session, prices from DB,
full recompute, same DB trigger. The idempotency key only short-circuits when an order with that id
is **already saved with identical canonical content**; differing content → 409, and an order id
belonging to another user → 404.

---

## 9. Testing strategy

| Layer | Tool | Scope | DB |
|---|---|---|---|
| Unit | vitest (`tests` colocated `src/**/*.test.ts`) | domain module (100% branch target), contracts, client outbox/sync with `fake-indexeddb` + mocked fetch, 1 component test (`RateInput` reset); AC1 on-screen numbers are asserted in e2e | none |
| Integration | vitest `integration` project, `tests/integration/**` | route handlers imported and called with real `Request` objects; DB guards via raw SQL | real Postgres `order_screen_test` (docker); `globalSetup` runs migrations; each file `beforeEach` truncates + seeds; `fileParallelism: false` |
| E2E | Playwright, `tests/e2e/**` | **two specs only (B-3): AC1 and AC7**; AC3–AC6 are covered by integration + unit tests. Full UI flows on `next build && next start` (port 3100), DB `order_screen_e2e` reset in `globalSetup` | real Postgres |
| Script | `scripts/prove-server-refusal.sh` | AC2 via HTTP against any base URL | server's DB |

Commands: `pnpm test` (unit), `pnpm test:int`, `pnpm test:e2e`, `pnpm typecheck`, `pnpm lint`,
`pnpm build`. `pnpm verify` runs all but e2e.

### 9.1 Acceptance criteria → tests

| AC | Unit | Integration | E2E / script |
|---|---|---|---|
| AC1 | `domain/line.test.ts` (3 lines: bp, class, totals), `domain/order.test.ts` (357,000 → 29,274,000; 549,000 → 45,018,000) | `ac1-worked-example.int.test.ts`: save lines 1–2 at 8,200 → `totals {usdCents:357000, sdg:29274000}`; full flow request-approval → owner approve → save → `{549000, 45018000}` | `ac1-worked-example.spec.ts`: enter 3 lines, assert "1.94% OK", "4.32% Warning", "7.25% Blocked", "$5,490", "45,018,000 SDG", Save disabled; remove line 3 → "$3,570", "29,274,000 SDG", save → saved view; second order with approval via owner → saved |
| AC2 | – | `ac2-server-refusal.int.test.ts`: adviser bearer token → E10 with 7.25% unapproved line → 422 `UNAPPROVED_BLOCKED_LINES` naming the line; two separate assertions (M-5): (a) **id never PUT** → `SELECT count(*) FROM orders WHERE id=$1` = 0; (b) **pre-existing draft** (created by E9 first, as the UI's autosave would) → row still `status='draft'`, content unchanged; both cases: zero rows with `status='saved'`; variants: body with `role:'owner'`, `unitPriceCents: 1`, `approval:{…}` fields → still 422; `db-guards.int.test.ts`: raw SQL draft + 7.25% line + `UPDATE status='saved'` with correct totals → SQLSTATE `OS422`; `INSERT … status='saved'` → rejected | `scripts/prove-server-refusal.sh` (fresh id, never PUT: exit 0 iff 422 + follow-up GET 404) |
| AC3 | `domain/rate.test.ts` (7,999 ✗, 8,000 ✓) ; `RateInput.test.tsx` (blur 7999 → 8000 + message) | E9/E10 rate 7,999 → 422 `RATE_BELOW_MINIMUM`, no row; E6 7,999 → 422; raw SQL rate 7,999 → CHECK violation | (e2e cut, B-3) — UI covered by `RateInput.test.tsx` |
| AC4 | – | `ac4-snapshot.int.test.ts`: save at 8,200 → owner E6 9,000 + E5 price → E8 still rate 8,200, old unit prices, totals 29,274,000; raw `UPDATE orders SET rate=9000` on saved → `OS409`; `UPDATE order_lines` → `OS409` | (e2e cut, B-3) |
| AC5 | – | `ac5-roles.int.test.ts`: adviser → E5, E6, E13 each 403 and DB unchanged; no token → 401; tampered token → 401; second adviser reading first adviser's order → 404 | (e2e cut, B-3) |
| AC6 | `domain/approval.test.ts` (changed qty/discount/price/product → not approved) | `ac6-approval-voiding.int.test.ts`: approve → withdraw not needed (order back to draft) → E9 discount 150→151 → line `state:'blocked'`, `approval.status:'none'` → E10 422; raw SQL update on approved line → approval cleared (trigger 4); one stale `expectedTerms` case → 409 `LINE_TERMS_CHANGED` (m-7); **E9 with unchanged terms keeps `approval.status='approved'`** (M-1) | (e2e cut, B-3) |
| AC7 | `offline/sync.test.ts`: 200 → synced; 422 → rejected & kept; network → retained; 409 already saved → synced | `idempotency.int.test.ts`: same save twice → 200 then 200 `replayed:true`, one row; different content → 409; replay with changed server price → saved at server price + `priceChanges` | `ac7-offline.spec.ts`: login online, visit `/orders` and `/order` online (runtime cache, B-2), wait for SW controller, `context.setOffline(true)`, reload (served by SW), create order, save → "1 pending sync"; `setOffline(false)` → becomes Saved; second case: offline order that the server rejects (price raised by owner so the discount becomes blocked) → shows server rejection on the line |

### 9.2 Spec rules → enforcement and tests

| Rule | UI (feedback) | Server (route/service) | DB | Tests |
|---|---|---|---|---|
| R1 fixed prices | unit price read-only | price read from DB, client price ignored (only `priceChanges`) | save trigger `PRICE_MISMATCH` | int: client `unitPriceCents`/`clientUnitPriceCents` ignored |
| R2 line value/total, qty, discount bounds | inputs clamp | zod + `DISCOUNT_EXCEEDS_LINE_VALUE` | CHECKs `qty>=1`, `discount_le_value` | unit + int + raw SQL |
| R3 %, classification | badge via domain | domain `classify` | save trigger integer compare | unit boundaries |
| R4 approval bound to terms | helper copy | `expectedTerms`, void on change | trigger 4 + save trigger equality | AC6 |
| R5 rate floor | reset to 8,000 | `RATE_BELOW_MINIMUM`, no clamp | CHECK on orders + settings | AC3 |
| R6 global rate | prefill from catalog | E6 owner-only | CHECK | AC5, AC3 |
| R7 snapshot | lock icons | saved immutable | immutability triggers | AC4 |
| R8 totals | domain | domain `computeOrder` | save trigger cross-check | AC1 |
| R9 server authority | – | everything above | guards §4.2 | AC2, AC5 |

---

## 10. Deployment (Vercel + Supabase)

| Env var | Local | Vercel |
|---|---|---|
| `DATABASE_URL` | `postgres://postgres:postgres@localhost:5432/order_screen` | Supabase **transaction pooler** URI (port 6543); client uses `prepare: false`, `max: 3`, `ssl: 'require'` when `NODE_ENV=production` (`.env.example` shows `?sslmode=require`) |
| `DIRECT_URL` | same as above | not needed at runtime; used locally/CI for migrations: Supabase **session pooler** URI (port 5432 on the pooler host, IPv4-reachable; the direct `db.<ref>.supabase.co` host is IPv6-only) |
| `SESSION_SECRET` | any 32+ chars | `openssl rand -base64 48` |
| `TEST_DATABASE_URL` | `…/order_screen_test` | – |
| `NEXT_PUBLIC_BUILD_ID` | set by `next.config.ts` from `VERCEL_GIT_COMMIT_SHA` or timestamp | automatic |

Steps: create Supabase project → `DIRECT_URL=… pnpm db:migrate && pnpm db:seed` from the dev
machine → Vercel project from the Git repo with env vars → deploy → run
`BASE_URL=https://… scripts/prove-server-refusal.sh`. Migrations are **not** run inside the Vercel
build (keeps builds reproducible and avoids build-time DB access).

Scheduling (M-4): deployment is its own task in two steps — **B11a** right after the backend core
(B10) and **B11b** redeploy after the frontend is done. Accounts are supplied by the stakeholder
later; B11a waits for them but **nothing else depends on it**, so it never blocks other tasks.

---

## 11. Resolved ambiguities (spec/design gaps → decision)

1. **"draft/ready" state** — not a stored status; `ready` = `draft` with `canSave=true` (derived).
2. **After owner decides all pending lines** → order auto-returns to `draft` (no extra "Return to
   adviser" call). Rejected lines keep `approval.status='rejected'` (state `blocked`) until edited.
3. **Editing while `pending_approval`** — read-only for the adviser (design.md); `withdraw-approval`
   (E12) returns it to draft. PUT/save on pending → 409 `ORDER_NOT_EDITABLE`.
4. **Refused save persists nothing** — the whole upsert+save transaction rolls back (strongest reading
   of AC2). Drafts are persisted by the separate autosave `PUT`.
5. **Price changed while offline** — server price wins and the save proceeds if still valid; response
   `priceChanges` drives a one-time notice. If the new price makes a line blocked/invalid, the save is
   refused and surfaced (AC7 second case).
6. **SDG rounding** — `divRoundHalfUp(totalCents × rate, 100)`; exact for AC1 and all whole-dollar
   totals. Same formula in DB trigger.
7. **Percent display** — basis points rounded half-up from exact integers; classification never uses it.
8. **Owner's own orders** — owner can create/save orders; saving a blocked line still needs an
   approval (owner may approve their own line via request-approval → decision). Owner cannot edit
   an adviser's order content, only decide lines.
9. **Discount entry granularity** — stakeholder decision: UI accepts up to 2 decimals (cents),
   parsed by `parseUsdToCents`; API cents. (B-1)
10. **Upper bounds** (qty, price, rate, lines) — added only to keep integer math in safe range.
11. **Blocked visual** — RESOLVED by stakeholder: grey badge + lucide `Lock` icon + "Blocked" label +
    dashed `danger-500` row border (design.md §1.1, OQ1 closed). (M-2)
12. **Owner price change after approval** (m-4) — unit price is part of the approved terms, so an
    owner price change voids the approval on the adviser's next PUT/save (trigger 4 fires because
    the server rewrites `unit_price_cents` from the DB). The `priceChanges` banner explains it, the
    line returns to `blocked`, and the adviser re-requests approval. Helper copy in design.md §3.2
    says so.
13. **Order number gaps** (m-8) — accepted: `INSERT … ON CONFLICT DO NOTHING` consumes an identity
    value on each conflicting call, so `number` has gaps. Cosmetic; noted in README. Not worth a
    `WHERE NOT EXISTS` variant (which still races).
14. **Withdraw approval** (B-3 item 6) — kept on the server (E12, ~15 lines, already tested);
    the "Cancel request" UI link is a cut-line item (F2) if time runs short.

Review findings rejected: none. m-7 is applied as "keep the check, one test, toast only".

---

## 12. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Service worker flakiness in Playwright / Next 16 build output changes | Hand-written SW with minimal surface; e2e waits for `navigator.serviceWorker.ready` + controller before going offline; the outbox logic is covered separately by unit tests so AC7 does not rest on e2e alone. Offline is implemented **last** (tasks F8/F9) so it cannot starve core ACs. |
| Supabase pooler + prepared statements + TLS | `prepare: false`; `max: 3`; `ssl: 'require'` in production; documented. |
| IPv6-only direct DB host | migrations via session pooler URI. |
| `bigint` columns returned as strings | drizzle `bigint({ mode: 'number' })` + safe-integer assertions. |
| Trigger error mapping drift | custom SQLSTATEs + integration tests that assert both HTTP code and SQLSTATE. |
| Race: owner edits price during adviser save | `FOR SHARE` on product rows in the save transaction. |
| Demo login lets anyone be owner | By spec; README "what I'd do differently": real IdP, per-user orgs, audit log. |
| Time (~1.5 days of agent work) | Order: domain → schema/guards → API + AC2 → **deploy (B11a, end of day 1, once accounts arrive)** → core UI → owner screens → offline → redeploy. **Already cut (B-3):** e2e reduced to AC1 + AC7, no "3 runs in a row"; sync triggers = online + start + manual; SW runtime caching only; no mobile `OrderLineCard` (responsive table with horizontal scroll); plain `<select>` for dealer/product (no search); no Cmd+S, no "A" shortcut, no Undo toast (plain remove); one component test. **Cut next if late:** "Cancel request" UI (E12 stays), price-change banner styling, orders-list search. Server-side work is never cut. |

---

## Revision log

2026-09-25 — applied `plan-review.md` (APPROVE WITH CHANGES) + final stakeholder decisions.

| Finding | Change |
|---|---|
| B-1 | Discount input accepts cents (≤ 2 dp) via `parseUsdToCents`, error copy for > 2 dp; plan §7, §11.9; design §4.2 + OQ2 resolved; tasks F2 (and F5 price edit uses same parser). |
| B-2 | §8.1 rewritten: no install-time precache, no HTML parsing; runtime caching of navigations only when `ok && !redirected && type==='basic'`; SW registered only after `GET /api/me` succeeds; tasks F8 DoD + F10 AC7 spec visit pages online first. |
| B-3 | Cut list applied: e2e = AC1 + AC7 only (no "3 runs in a row"); sync triggers = online/start/manual; SW runtime caching; no mobile `OrderLineCard`, plain `<select>`, no shortcuts/Undo toast; one component test. §9, §9.1, §12, tasks F2/F7/F10, design §3.2/§4.3/§6 updated. E12 kept server-side; its UI is a cut-line (§11.14). |
| M-1 | §6.4 step 5: upsert `DO UPDATE SET` limited to terms + position; approval columns never written; voiding only via trigger 4. B7 DoD + AC6 int test: unchanged-terms PUT keeps approval. |
| M-2 | Blocked = grey badge + `Lock` + "Blocked" + dashed `danger-500` border; design §1.1/§3/§6, OQ1 resolved; plan §11.11; F1 DoD. |
| M-3 | §1: exact Next version pinned in B0, `proxy.ts` vs `middleware.ts` verified, `<Suspense>` around `useSearchParams`; B0 DoD. |
| M-4 | Deploy split into B11a (after B10, required) and B11b (after F9); accounts requested at B0, supplied later, non-blocking; §10. |
| M-5 | AC2 test has two explicit assertions (never-PUT id → 0 rows; pre-existing draft → unchanged draft); §9.1, B8, B10 DoD. |
| m-1 | DB client `ssl: 'require'` in production, `max: 3`; §10, §12, `.env.example`. |
| m-2 | Seed data + `seed(db)` moved into B3; B4 keeps CLI scripts only. |
| m-3 | Order with queued `save` renders read-only with "Queued" tag until synced/rejected; §7, §8.3, F7 DoD, design §3.2. |
| m-4 | §11.12 + design approved-line helper copy mention owner price changes. |
| m-5 | Design §3.4: "Return to adviser" button removed; auto-return message + back link. |
| m-6 | §7 + F2 DoD: non-creator / pending / queued → read-only rendering; owner on pending → `/approvals/[id]`. |
| m-7 | Kept `expectedTerms` check; one int test; F4 shows a toast only. |
| m-8 | Accepted order-number gaps; §11.13, README note in B12. |
| m-9 | Design §1.1 gains a Tailwind v4 `@theme` excerpt. |
