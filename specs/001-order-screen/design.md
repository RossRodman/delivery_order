# Design — The Order Screen

Source of truth: `spec.md`. This document does not define API shapes, only UI: screens, states,
copy, tokens, and components, implementable with Next.js + Tailwind (no UI kit) in ~1 day.

---

## 1. Design tokens (Tailwind)

All colours meet WCAG AA (≥4.5:1 for text, ≥3:1 for large text / icon strokes) against their
paired background. Every state pairs colour with an icon **and** a text label — never colour alone.

### 1.1 Line discount states (the four states the client named)

These are the core visual vocabulary of the screen. Each is a pill/badge: icon + label, plus a
left border accent on the line row itself so the state reads even out of the corner of the eye.

| State | Meaning | Badge bg | Badge text | Border/ring | Icon | Label text |
|---|---|---|---|---|---|---|
| `sand` | discount ≤ 3% — ok | `#FDF3E1` (`sand-100`) | `#7A4E00` (`sand-900`) | `#D9A441` (`sand-500`) | ● filled circle (`CheckCircle` outline ok too) | "OK" |
| `red` | 3% < discount ≤ 5% — warning, still saveable | `#FDECEC` (`red-100`) | `#8A1F1F` (`red-900`) | `#E0403D` (`red-500`) | ▲ triangle-alert | "Warning" |
| `blocked` | discount > 5% — not saveable without approval | `#F3F4F6` (`slate-100`) | `#3F3F46` (`slate-800`) with a red-900 icon | `#DC2626` dashed | ⛔ octagon / lock | "Blocked" |
| `approved` | an owner approved this exact blocked line | `#EAF6EE` (`green-100`) | `#166534` (`green-900`) | `#22C55E` (`green-500`) | ✓ check-shield | "Approved" |

Tailwind config (excerpt, `tailwind.config.ts`):

```ts
colors: {
  sand:    { 50:'#FEFAF3', 100:'#FDF3E1', 300:'#EFC876', 500:'#D9A441', 700:'#9C6B12', 900:'#7A4E00' },
  danger:  { 50:'#FEF2F2', 100:'#FDECEC', 300:'#F3A7A5', 500:'#E0403D', 700:'#B02322', 900:'#8A1F1F' },
  blocked: { 50:'#F9FAFB', 100:'#F3F4F6', 300:'#D1D5DB', 500:'#9CA3AF', 700:'#52525B', 900:'#3F3F46' },
  approved:{ 50:'#F0FBF4', 100:'#EAF6EE', 300:'#86EFAC', 500:'#22C55E', 700:'#15803D', 900:'#166534' },
  brand:   { 50:'#EFF6FF', 500:'#2563EB', 600:'#1D4ED8', 700:'#1E40AF' }, // primary actions / links
}
```

> Note: `blocked` intentionally uses **grey**, not red, for its badge fill — the client's four states
> must be mutually distinguishable at a glance, and pure-red-on-red for "red" vs "blocked" fails
> that. Blocked is differentiated by a dashed red *border* + lock icon + the word "Blocked", which
> keeps it visually "more severe" than red without colour-clashing. Confirmed against the spec's
> intent (states must be unmistakable and accessible) — flagged in Open Questions for stakeholder
> sign-off since the brief names four literal colour words.

### 1.2 Semantic / system colours

| Token | Value | Use |
|---|---|---|
| `bg-canvas` | `#F8FAFC` (slate-50) | page background |
| `bg-surface` | `#FFFFFF` | cards, table |
| `border-default` | `#E2E8F0` (slate-200) | dividers, input borders |
| `text-primary` | `#0F172A` (slate-900) | body text |
| `text-secondary` | `#64748B` (slate-500) | helper text, labels |
| `brand-600` | `#1D4ED8` | primary buttons, links, focus ring |
| `success-600` | `#15803D` | saved confirmations |
| `offline-500` | `#F59E0B` (amber-500) | offline banner |

### 1.3 Type scale

| Token | Size / weight | Use |
|---|---|---|
| `text-display` | 24px / 700 | screen title |
| `text-h2` | 18px / 600 | section headers (e.g. "Order lines") |
| `text-body` | 14px / 400 | table cells, form labels |
| `text-small` | 12px / 400 | helper/error text, badge labels |
| `text-mono-num` | 14px / 600, tabular-nums | all money & rate figures |

Use `font-feature-settings: 'tnum'` (Tailwind `tabular-nums`) on every numeric column so digits
align in the table.

### 1.4 Spacing & radii

- Base spacing unit 4px; table row height 48px (desktop), 56px (mobile, larger tap targets).
- `rounded-md` (6px) for inputs/badges, `rounded-lg` (8px) for cards, `rounded-full` for status pills.
- Card padding: `p-6` desktop, `p-4` mobile.
- Focus ring: `ring-2 ring-brand-600 ring-offset-2` on every interactive element (keyboard a11y).

---

## 2. Number formatting rules (exact)

| Kind | Format | Example |
|---|---|---|
| USD money | `$` + thousands-separated integer dollars (cents divided, no decimals shown since all example values are whole dollars; if cents are non-zero, show 2 decimals) | `$2,020` / `$1,550.50` |
| SDG money | integer, thousands-separated, suffixed ` SDG` | `29,274,000 SDG` |
| Discount % | 2 decimal places, `%` suffix | `4.32%` |
| Rate | integer, thousands-separated, suffixed ` SDG/USD` | `8,200 SDG/USD` |
| Qty | plain integer | `4` |

Rounding: display-only rounding to 2dp for %; **never** round money — money is always exact integer
cents/SDG per spec R1–R8. All arithmetic for display is derived from the same integers the server
uses; the UI never recomputes classification with floats (mirrors R3's integer-comparison rule so
the badge the adviser sees never disagrees with the server).

---

## 3. Screens

### 3.1 Login

**Purpose:** demo auth — pick a role, no password.

```
┌──────────────────────────────────────┐
│                                       │
│         [Logo] Order Desk            │
│                                       │
│   Sign in as                         │
│   ┌───────────────┐ ┌──────────────┐ │
│   │  Adviser       │ │  Owner       │ │
│   │  (Amina)       │ │  (Yusuf)     │ │
│   └───────────────┘ └──────────────┘ │
│                                       │
│   Demo login — no password required. │
└──────────────────────────────────────┘
```

- Two large cards/buttons, one per seeded user, showing name + role badge.
- Copy under the buttons: *"Demo login — no password required."*
- On click: sets session cookie, redirects to Orders list.
- States: `loading` (button shows spinner, disabled), `error` ("Couldn't sign in. Try again.").
- A small footer link: *"Copy API token (for curl)"* — copies the bearer token for the selected
  demo user to clipboard, with a toast "Token copied." (Satisfies the reviewer's curl requirement
  without cluttering the primary flow.)

### 3.2 Order screen (core)

**Purpose:** build/edit a draft order: pick dealer, add lines, set discounts, set rate, see totals,
save or request approval.

Desktop wireframe (≥1024px):

```
┌────────────────────────────────────────────────────────────────────────────┐
│ ← Orders          Order #— (Draft)                    [●] Online  Amina ▾  │
├────────────────────────────────────────────────────────────────────────────┤
│ Dealer:  [ Al-Noor Trading ▾ ]                     Order rate: [ 8,200 ] SDG/USD │
│                                                     Today's default: 8,200  │
├────────────────────────────────────────────────────────────────────────────┤
│ Order lines                                              [+ Add product]   │
│ ┌──────────────────────────────────────────────────────────────────────┐   │
│ │ Product        Qty  Unit price  Discount $  Disc %   State     Total │ x │
│ │ Water pump ×4  [4]   $515       [ 40 ]      1.94%   ● OK      $2,020 │ ⌫ │
│ │ Filter ×2      [2]   $810       [ 70 ]      4.32%   ▲ Warning $1,550 │ ⌫ │
│ │ Battery ×1     [1]  $2,070      [150 ]      7.25%   ⛔ Blocked $1,920│ ⌫ │
│ │   ⓘ Blocked — needs owner approval before this order can be saved.  │   │
│ └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│                                        Subtotal (USD)              $5,490  │
│                                        Order total (USD)           $5,490  │
│                                        Order total (SDG)     45,018,000 SDG│
├────────────────────────────────────────────────────────────────────────────┤
│  [ Request approval ]                                   [ Save order ]     │
└────────────────────────────────────────────────────────────────────────────┘
```

Mobile (≥360px) stacks each line into a card:

```
┌───────────────────────────────┐
│ Battery                    ⌫  │
│ Qty [1]   Unit $2,070          │
│ Discount $ [150]   7.25%       │
│ ⛔ Blocked                     │
│ ⓘ Needs owner approval         │
├───────────────────────────────┤
│ [+ Add product]                │
├───────────────────────────────┤
│ Order total (USD)      $5,490 │
│ Order total (SDG) 45,018,000  │
├───────────────────────────────┤
│ [Request approval] [Save]     │
└───────────────────────────────┘
```

**Components:**
- `DealerPicker` — searchable select, required before lines can be added. Placeholder: "Select a dealer…".
- `RateInput` — numeric input, suffix "SDG/USD", helper text under it showing the global default
  when it differs from the current value: *"Today's default: 8,200"*. See §4.1 for reset behaviour.
- `OrderLinesTable` (desktop) / `OrderLineCard` (mobile) — one row per line:
  - Product name + qty badge (`Product ×N`) — product picked via `+ Add product` (opens a searchable
    product picker modal/drawer; owner-only prices are read-only here for both roles on the line
    itself, since even the owner edits prices in Settings, not inline).
  - `Qty` — number stepper input, integer ≥ 1.
  - `Unit price` — read-only, dimmed text (`text-secondary`), never editable on this screen.
  - `Discount $` — number input, USD, live-validated `0 ≤ discount ≤ lineValue`.
  - `Disc %` — computed, read-only, 2dp.
  - `State` — badge per §1.1.
  - `Line total` — computed, read-only, bold, tabular-nums.
  - Remove (⌫) icon button, confirms via inline "Undo" toast rather than a modal (fast data entry).
  - Inline helper row under a `blocked` line: *"Blocked — needs owner approval before this order can
    be saved."* Under an `approved` line: *"Approved by {owner name} on {date}. Changing qty or
    discount will void this approval."*
- `TotalsPanel` — Subtotal, Order total (USD), Order total (SDG). SDG total recomputed live as the
  rate field changes.
- `ActionBar` — sticky footer (desktop: right-aligned inline; mobile: fixed bottom bar).
  - **Save order** — primary button. Disabled with tooltip *"Resolve blocked lines or request
    approval first"* when any line is `blocked` (not `approved`) and enabled otherwise. Spec: R9
    says server is authoritative — button disabling is UX-only, the Save call may still 4xx and the
    UI must surface that (see error state below).
  - **Request approval** — secondary/outline button, visible only when ≥1 line is `blocked`. Sends
    order to `pending_approval`. Disabled once already pending (shows "Awaiting approval" status
    chip instead).
- **Header status:** order state chip next to the order number: `Draft` / `Pending approval` /
  `Saved`. Online/offline dot (§3.6) and pending-sync counter live in the top bar.

**States:**

| State | Behaviour |
|---|---|
| `loading` (initial fetch of dealers/products/rate) | Skeleton rows (grey pulse bars) for dealer picker, lines table, totals. |
| `empty` (no lines yet) | Table area replaced with dashed-border empty state: icon + *"No products added yet."* + `[+ Add product]` button centered. |
| `error` (save/request-approval rejected by server) | Non-blocking banner above the lines table, red: *"Couldn't save — {server message}."* If the server names offending lines (AC2), those specific rows get a red outline + inline note *"This line needs approval before saving."* Order is not navigated away from; nothing is lost. |
| `offline` | Amber banner under the top bar: *"You're offline. Changes are saved on this device and will sync when you're back online."* Save button label changes to **"Save (offline)"**; still enabled. |
| `pending-sync` | Header shows a chip *"N pending sync"* (amber, cloud-off icon). Saved-but-unsynced orders show a small "Queued" tag next to the order status until the server confirms. |
| `pending_approval` (order-level) | Entire line-editing area becomes read-only (inputs disabled, dimmed) except the ability to withdraw the request (`Cancel request` link). Status chip: `Pending approval`. |
| `read-only/saved` | See §3.6 Saved order view — this screen is never shown read-only; saved orders route to their own view. |
| price-changed-on-sync (offline reconcile) | One-time dismissible banner on the affected order: *"Note: the price of {product} changed from $X to $Y since you went offline. Totals below reflect the new price."* |

### 3.3 Orders list

**Purpose:** adviser sees own orders; owner sees all + filter.

```
┌────────────────────────────────────────────────────────────────────┐
│ Orders                                          [+ New order]      │
├────────────────────────────────────────────────────────────────────┤
│ [ All ▾ ] [ Awaiting approval ]  (owner only)      🔍 Search dealer │
├────────────────────────────────────────────────────────────────────┤
│ Dealer            Adviser   Total (USD)   Status            Date   │
│ Al-Noor Trading   Amina     $5,490        ● Saved            9/24  │
│ Kordofan Supplies Amina     $1,920        ◔ Pending approval 9/25  │
│ Blue Nile Traders Amina     —             ○ Draft            9/25  │
└────────────────────────────────────────────────────────────────────┘
```

- Row click → Order screen (if `draft`/`pending_approval`, editable/read-only per role) or Saved
  order view (if `saved`).
- Status dot colours: `Draft` = slate-400 outline, `Pending approval` = amber-500 (half-fill dot),
  `Saved` = green-500 filled, `Rejected` (if a line was rejected and order returned to draft) =
  red-500 outline with a small "!" badge.
- Owner-only "Awaiting approval" filter chip shows a count badge, e.g. `Awaiting approval (3)`.
- Empty state: *"No orders yet."* + `[+ New order]`.
- Offline: list still renders from cache; a small banner: *"Showing cached orders. Some may be out of date."*

### 3.4 Approval view (owner)

**Purpose:** owner reviews an order's blocked lines and approves/rejects each.

```
┌────────────────────────────────────────────────────────────────────┐
│ ← Awaiting approval    Order · Al-Noor Trading · by Amina           │
├────────────────────────────────────────────────────────────────────┤
│ Lines requiring approval                                            │
│ ┌──────────────────────────────────────────────────────────────┐    │
│ │ Battery ×1 · $2,070 unit · Discount $150 (7.25%) ⛔ Blocked   │    │
│ │                                    [ Reject ]   [ Approve ]   │    │
│ └──────────────────────────────────────────────────────────────┘    │
│                                                                       │
│ Other lines (for context, read-only)                                │
│  Water pump ×4 · $2,020 · ● OK                                       │
│  Filter ×2 · $1,550 · ▲ Warning                                      │
│                                                                       │
│ Order total if all approved: $5,490 = 45,018,000 SDG (rate 8,200)   │
└────────────────────────────────────────────────────────────────────┘
```

- Only `blocked` lines get action buttons; sand/red lines are shown for context, no action needed.
- **Approve** → line becomes `approved` immediately (optimistic), badge updates in place.
- **Reject** → confirmation inline (*"Reject this line? The adviser will need to change it."*),
  then line marked `Rejected` (red-900 text, strikethrough discount), order returns to `draft` for
  the adviser with a note.
- Once every blocked line is resolved (approved or rejected), primary button appears:
  **"Return to adviser"** (moves order back to `draft`, or stays actionable if adviser can now save
  directly — decision left to plan.md/backend; from a UI perspective this screen always ends in an
  explicit action, never silently).
- State: if order has zero blocked lines (e.g. adviser withdrew, or all already resolved), show
  *"Nothing pending on this order."* with a back link.

### 3.5 Owner settings

**Purpose:** edit product prices; edit global rate.

```
┌────────────────────────────────────────────────────────────────────┐
│ Settings                                                             │
├────────────────────────────────────────────────────────────────────┤
│ Global default rate                                                  │
│  [ 8,200 ] SDG/USD   [ Save rate ]      Minimum: 8,000                │
├────────────────────────────────────────────────────────────────────┤
│ Product prices                                       🔍 Search       │
│  Water pump      $515   [ Edit ]                                     │
│  Filter          $810   [ Edit ]                                     │
│  Battery         $2,070 [ Edit ]                                     │
└────────────────────────────────────────────────────────────────────┘
```

- Rate field: same ≥8,000 validation and reset-to-8,000 behaviour as the order screen's rate field
  (§4.1), since R6 reuses R5's floor.
- Editing a price opens an inline edit (row becomes an input + Save/Cancel) — no modal needed.
- Helper copy under rate field: *"Existing saved orders keep the rate they were saved with."*
- Helper copy under product list header: *"Price changes apply to new lines only; saved orders keep
  their original price."*
- Success toast on save: *"Rate updated."* / *"Price updated."*
- This screen is owner-only; if an adviser reaches the URL directly, show a full-page 403 state:
  *"You don't have permission to view this page."* + link back to Orders.

### 3.6 Saved order view (read-only)

**Purpose:** immutable record of a saved order.

```
┌────────────────────────────────────────────────────────────────────┐
│ ← Orders          Order #1042 · Saved 9/24/2026                     │
├────────────────────────────────────────────────────────────────────┤
│ Dealer: Al-Noor Trading                     Rate: 8,200 SDG/USD     │
│                                              (snapshot — fixed)      │
├────────────────────────────────────────────────────────────────────┤
│ Water pump ×4    $515    $40 (1.94%)   ● OK        $2,020           │
│ Filter ×2        $810    $70 (4.32%)   ▲ Warning   $1,550           │
│ Battery ×1       $2,070  $150 (7.25%)  ✓ Approved  $1,920           │
├────────────────────────────────────────────────────────────────────┤
│                                        Order total (USD)   $5,490   │
│                                        Order total (SDG) 45,018,000 │
└────────────────────────────────────────────────────────────────────┘
```

- Everything is plain text / disabled-style inputs — no editable controls, no Save/Request buttons.
- A small lock icon next to "Rate" and next to each unit price with tooltip: *"Snapshot at save
  time — not affected by later changes."* This directly visualizes R7.
- Approved lines keep their `approved` badge permanently (historical record).
- Print/export is out of scope (non-goal); no button shown.

---

## 4. Interaction details

### 4.1 Rate field reset-to-8,000 behaviour (R5)

Applies identically to the order screen's `RateInput` and the settings global-rate field.

1. Field is a plain number input, integer only (no decimals, no thousands separators while typing;
   formatted with commas on blur).
2. User types a value `< 8000` and blurs (or presses Enter / tabs away):
   - Field value snaps to `8000`.
   - Field briefly outlines red (`ring-danger-500`, 400ms transition) then settles to normal border.
   - Inline helper text under the field (red, `text-small`) appears for 4s or until next edit:
     *"Rate can't be below 8,000 SDG/USD — reset to the minimum."*
   - Totals recompute immediately using 8,000.
3. Server independently rejects any order submitted with rate < 8000 (never silently clamps
   server-side, per spec) — if this ever happens (e.g. race with a stale client), the Save error
   banner (§3.2) shows: *"Order rate must be at least 8,000 SDG/USD. Please update it and save
   again."* and the rate field is refocused.
4. Typing is not blocked/clamped on every keystroke (so a user can type "8" then "200" → "8200"
   without fighting the input) — only blur/submit triggers validation.

### 4.2 Discount input behaviour

- Discount `$` input accepts integers only (USD cents are internal; the UI enters/shows whole
  dollars, since all spec examples are whole dollars — see Open Questions re: cent-level entry).
- Live-clamped on blur: if `discount > lineValue`, reset to `lineValue` with helper text: *"Discount
  can't exceed the line value ($X) — reset to $X."*
- If `discount < 0`, reset to `0`.
- `%` and state badge recompute on every keystroke (debounced ~150ms), not just on blur, so the
  adviser gets immediate feedback while typing.
- Classification badge transition is instant (no animation delay) — data-entry speed matters more
  than polish here.

### 4.3 Keyboard flow

- Tab order per line: Qty → Discount $ → (next line) Qty. Disc%/State/Total are not tabbable
  (read-only/computed).
- `Enter` in the last line's Discount field, when "Add product" has focus reachable, does not
  auto-add a new line (avoids accidental line creation); use an explicit `+ Add product` (also
  reachable via a keyboard shortcut hint shown on hover: "A").
- `Escape` closes the product-picker modal/drawer without adding a line.
- All destructive actions (remove line, reject a line) are reachable and confirmable via keyboard
  (focus moves to the confirm/undo control).
- Global: `Cmd/Ctrl+S` triggers Save order when the button is enabled (nice-to-have, not required).

### 4.4 Number formatting — implementation note

- Store/transmit integer cents (USD) and integer SDG per spec; format only at render time using a
  small shared `formatUSD(cents)`, `formatSDG(sdg)`, `formatPercent(bp)` helper trio (documented in
  plan.md's responsibility, referenced here only for the exact strings expected):
  - `formatUSD(202000)` → `"$2,020"` (cents that are exact dollars show no decimals; otherwise 2dp).
  - `formatSDG(29274000)` → `"29,274,000 SDG"`.
  - `formatPercent(194)` (i.e. basis-points-like exact int representing 1.94%, or computed float
    only for display) → `"1.94%"`.

---

## 5. Worked example rendered (AC1, filled mock)

**Order screen, dealer "Al-Noor Trading", rate 8,200 SDG/USD, adviser Amina — before approval:**

```
Dealer:  Al-Noor Trading                          Order rate: 8,200 SDG/USD
                                                   Today's default: 8,200

Order lines                                                  [+ Add product]
┌────────────────────────────────────────────────────────────────────────┐
│ Product         Qty  Unit price  Discount $  Disc %   State      Total │
│ Water pump      [4]   $515       [ 40 ]      1.94%   ● OK       $2,020 │
│ Filter          [2]   $810       [ 70 ]      4.32%   ▲ Warning  $1,550 │
│ Battery         [1]  $2,070      [150 ]      7.25%   ⛔ Blocked $1,920 │
│   ⓘ Blocked — needs owner approval before this order can be saved.    │
└────────────────────────────────────────────────────────────────────────┘

                                          Subtotal (USD)          $5,490
                                          Order total (USD)       $5,490
                                          Order total (SDG)  45,018,000 SDG

[ Request approval ]                                        [ Save order ]
   (Save order is disabled: "Resolve blocked lines or request approval first")
```

**Without line 3 (Battery removed) — saves immediately:**

```
Order lines                                                  [+ Add product]
┌────────────────────────────────────────────────────────────────────────┐
│ Water pump      [4]   $515       [ 40 ]      1.94%   ● OK       $2,020 │
│ Filter          [2]   $810       [ 70 ]      4.32%   ▲ Warning  $1,550 │
└────────────────────────────────────────────────────────────────────────┘
                                          Order total (USD)       $3,570
                                          Order total (SDG)  29,274,000 SDG
[ Save order ]  ← enabled, no blocked lines
```

**With line 3, after owner approval — Battery now shows `approved`, order saves:**

```
│ Battery         [1]  $2,070      [150 ]      7.25%   ✓ Approved $1,920 │
│   ⓘ Approved by Yusuf on 9/25/2026. Changing qty or discount voids it. │

                                          Order total (USD)       $5,490
                                          Order total (SDG)  45,018,000 SDG
[ Save order ]  ← enabled
```

**Saved order view after save (immutable, snapshot rate 8,200):**

```
Order #1042 · Saved 9/25/2026                    Rate: 8,200 SDG/USD (snapshot)
Water pump ×4   $515   $40 (1.94%)   ● OK        $2,020
Filter ×2       $810   $70 (4.32%)   ▲ Warning   $1,550
Battery ×1      $2,070 $150 (7.25%)  ✓ Approved  $1,920
                                     Order total (USD)      $5,490
                                     Order total (SDG) 45,018,000 SDG
```

---

## 6. Component inventory (1:1 for the frontend developer)

| Component | Props (conceptual) | Used in |
|---|---|---|
| `RoleLoginCard` | name, role, onSelect | Login |
| `DealerPicker` | dealers[], value, onChange, disabled | Order screen |
| `ProductPickerModal` | products[], onAdd, onClose | Order screen |
| `RateInput` | value, defaultValue, min=8000, onChange, disabled, error | Order screen, Settings |
| `OrderLinesTable` (desktop) / `OrderLineCard` (mobile) | lines[], onQtyChange, onDiscountChange, onRemove, readOnly | Order screen, Approval view (read-only context), Saved order view (readOnly) |
| `DiscountStateBadge` | state: sand\|red\|blocked\|approved\|rejected | OrderLinesTable, Orders list summary, Approval view |
| `TotalsPanel` | subtotalUsd, totalUsd, totalSdg, rate | Order screen, Approval view, Saved order view |
| `ActionBar` | canSave, canRequestApproval, isOffline, onSave, onRequestApproval | Order screen |
| `OrderStatusChip` | status: draft\|pending_approval\|saved\|rejected | Order screen header, Orders list rows |
| `OnlineOfflineIndicator` | isOnline, pendingSyncCount | Global top bar |
| `OrdersTable` | orders[], filter, onFilterChange, onRowClick | Orders list |
| `ApprovalLineCard` | line, onApprove, onReject | Approval view |
| `PriceEditRow` | product, price, onSave | Owner settings |
| `Toast` | message, variant: success\|error\|info | Global |
| `ErrorBanner` | message, affectedLineIds[] | Order screen |
| `EmptyState` | icon, message, action | Order lines, Orders list |
| `Skeleton` | rows | any loading state |
| `LockedFieldTooltip` | label | Saved order view (rate, unit price) |

Icons: use `lucide-react` (tree-shakeable, Tailwind-friendly, no design-kit dependency) —
`CheckCircle2`, `AlertTriangle`, `ShieldOff`/`Lock`, `ShieldCheck`, `WifiOff`, `Cloud`, `Trash2`,
`Plus`, `Search`, `ChevronDown`.

---

## 7. Open questions

1. The client names four literal colours ("sand", "red", "blocked", "approved") — `blocked` here is
   designed as grey + dashed red border + lock icon rather than a fifth hue, to stay distinguishable
   from `red`. Confirm this reading is acceptable, or if "blocked" should render as a literal red
   variant instead (e.g. solid dark red vs. the warning's lighter red) — could revisit as two red
   shades (red-500 warning vs red-700 blocked) if the stakeholder prefers literal colour-per-name
   over the icon-differentiated approach.
2. Discount entry: spec stores discount in USD cents; this design has the adviser type whole dollars
   (matching the AC1 example, which is all whole dollars). Confirm whether cent-level discount entry
   is actually needed for the take-home, or whole-dollar entry is acceptable (simplifies the input
   and avoids float parsing in the browser).
3. Approval view's post-resolution flow ("Return to adviser" vs. auto-save when all lines cleared) is
   left flexible for plan.md — UI always shows an explicit terminal action, but the exact resulting
   order status transition should be confirmed with the backend plan.
4. Product picker UX (modal vs. inline row) is left to implementation convenience; either satisfies
   this spec as long as it does not let the adviser edit price.
