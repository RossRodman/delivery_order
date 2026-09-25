# Spec 001 — The Order Screen

Status: APPROVED (product decisions confirmed by stakeholder 2026-09-25)
Source: client brief "BUILD: THE ORDER SCREEN" (reproduced in §9).

## 1. Goal

An **adviser** picks a dealer, adds products at fixed dollar prices, gives a discount per line,
enters today's exchange rate (SDG per USD) and saves the order. An **owner** controls prices,
the default rate, and approves over-limit discounts.

## 2. Actors

| Actor   | Can do |
|---------|--------|
| Adviser | Create/edit own draft orders, pick dealer, add/remove lines, set qty + discount, set order rate, request approval, save order. **Cannot** change product prices. **Cannot** approve lines. |
| Owner   | Everything an adviser can, plus: edit product prices, edit the global default rate, approve/reject lines with discount > 5%. |

Auth is a **demo login**: two seeded users (one adviser, one owner), role picked on a login screen,
session held in a signed, httpOnly cookie. The server derives the role **only from the session**,
never from the request body. A bearer-token form of the same session must be obtainable so a
reviewer can call the API with `curl` as an adviser.

## 3. Domain rules (normative)

All money is handled as **integer cents** (USD) and **integer SDG**; never floats.

- **R1 Fixed prices.** A product has a USD unit price set by the owner. Order lines take the unit
  price from the database on the server; any price sent by the client is ignored.
- **R2 Line value** = `qty × unitPrice`. **Line total** = `lineValue − discount`.
  Constraints: `qty` integer ≥ 1; `discount` in USD cents, `0 ≤ discount ≤ lineValue`.
- **R3 Discount percent** = `discount / lineValue × 100`, displayed rounded to 2 decimals.
  Classification uses exact integer comparison (no float rounding):
  - `discount × 100 ≤ 3 × lineValue` → **sand** (ok)
  - `3 × lineValue < discount × 100 ≤ 5 × lineValue` → **red** (warning, saveable)
  - `discount × 100 > 5 × lineValue` → **blocked** (not saveable unless owner approved that line)
  (Boundary assumption: exactly 3.00% is sand, exactly 5.00% is red.)
- **R4 Approval.** An owner approval is bound to the exact line terms
  (product, qty, unit price, discount). Any change to those terms voids the approval.
- **R5 Rate.** One rate per order, integer SDG per USD, **minimum 8,000**. A lower value is refused:
  the UI resets the field to 8,000 and explains why; the server rejects it (never silently clamps).
- **R6 Global rate setting.** The owner maintains a global "today's rate". New orders are pre-filled
  with it; the adviser may change the order's rate (still ≥ 8,000).
- **R7 Rate snapshot.** A saved order stores its own rate. Changing the global setting afterwards
  does not change any saved order. Same for product prices: a saved order keeps its unit prices.
- **R8 Totals.** Order USD total = Σ line totals. Order SDG total = USD total × rate
  (computed in integer cents then converted: `totalCents × rate / 100`, exact for the example).
- **R9 Server authority.** Every rule above is enforced on the server (and saved-order invariants
  additionally in the database). The UI mirrors them for feedback only.

## 4. Order lifecycle

```
draft ──(request approval)──▶ pending_approval ──(owner approves/rejects lines)──▶ draft/ready
  │                                                                                   │
  └───────────────────────────────(save: no unapproved blocked line)──────────────────┴──▶ saved (immutable)
```

- **draft**: editable by its adviser; may contain blocked lines.
- **pending_approval**: adviser asked the owner to approve one or more blocked lines. Owner sees a
  list of pending orders, approves or rejects each blocked line.
- **save**: allowed only if every blocked line has a valid approval (R4). Otherwise the server
  refuses with a machine-readable error naming the offending lines.
- **saved**: immutable; shows its snapshot rate, prices, totals.

## 5. Screens

1. **Login** — choose "Adviser" or "Owner" (demo).
2. **Order screen** (the core) — dealer picker, product lines (product, qty, unit price read-only,
   discount $, discount %, colour state, line total), order rate, USD + SDG totals, actions:
   Save / Request approval. Live status per line (sand / red / blocked / approved).
3. **Orders list** — adviser's orders with status; owner sees all + an "Awaiting approval" filter.
4. **Approval view** (owner) — pending order with blocked lines, approve/reject per line.
5. **Owner settings** — edit product prices; edit global rate (≥ 8,000).
6. **Saved order view** — read-only, shows the snapshot rate.

## 6. Offline (bonus — in scope)

- App shell, dealers, products and the global rate are cached for offline use.
- While offline the adviser can create/edit orders; they are stored locally (IndexedDB) and a
  "save" is queued. A clear online/offline + "N pending sync" indicator is shown.
- On reconnect the queue is replayed with an idempotency key (client-generated order id). The server
  re-validates everything; a rejection is surfaced on the order (it is never silently lost).
- Prices used offline are the cached ones; the server's price wins on sync and the user is told if
  it changed.

## 7. Acceptance criteria

**AC1 — worked example at rate 8,200 (must reproduce exactly):**

| Line | Qty × Price | Discount | % | State | Line total |
|------|-------------|----------|------|---------|-----------|
| 1 | 4 × $515 | $40 | 1.94% | sand | $2,020 |
| 2 | 2 × $810 | $70 | 4.32% | red | $1,550 |
| 3 | 1 × $2,070 | $150 | 7.25% | blocked | $1,920 |

- Without line 3: total **$3,570 = 29,274,000 SDG**, and it saves.
- With line 3 after owner approval: total **$5,490 = 45,018,000 SDG**, and it saves.

**AC2 — server refusal:** an adviser calling the save API directly with a 7.25% line and no approval
gets an error response (4xx) and nothing is persisted as saved. Proven by (a) an automated
integration test against a real Postgres, (b) a documented `curl` script, (c) a DB-level guard.

**AC3 — rate floor:** rate 7,999 is refused by the server (4xx); UI resets to 8,000.

**AC4 — snapshot:** save an order at 8,200, owner changes global rate to 9,000 and a price → the saved
order still shows 8,200 and its original prices/totals.

**AC5 — roles:** adviser cannot change prices, global rate, or approve (403 from the server).

**AC6 — approval voiding:** after approval, changing the approved line's discount/qty makes it
blocked again.

**AC7 — offline:** create an order offline, reconnect, it syncs and appears as saved (or shows the
server's rejection).

## 8. Non-goals

Real authentication/SSO, multi-currency beyond USD/SDG, invoicing, inventory, dealer management UI
(dealers and products are seeded; owner edits prices only), i18n (UI is English).

## 9. Delivery

- Working URL (Vercel + Supabase Postgres, accounts supplied by stakeholder).
- Git repository with README: how to run, how AC2 is proven (test + curl), and
  "what I would do differently in a real build".
- Stack: Next.js (App Router) + TypeScript, PostgreSQL, Tailwind.
