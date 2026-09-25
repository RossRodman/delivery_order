/**
 * HTTP API contract (plan.md §6.2–6.3): zod request schemas + response types.
 * Money: integer cents; SDG and rate: integers; percentages: integer basis points.
 * Unknown keys (role, unitPriceCents, createdBy, approval, …) are stripped by zod and ignored.
 */
import { z } from "zod";
import { MAX_LINES, MAX_QTY, MAX_UNIT_PRICE_CENTS } from "@/domain/limits";

const MAX_DISCOUNT_CENTS = MAX_QTY * MAX_UNIT_PRICE_CENTS;

export const Uuid = z.uuid();

// ---------- Requests ----------

export const OrderLineInputSchema = z.object({
  id: Uuid,
  productId: Uuid,
  qty: z.int().min(1).max(MAX_QTY),
  discountCents: z.int().min(0).max(MAX_DISCOUNT_CENTS),
  /** Informational only (the price the client displayed); reported in priceChanges, never used for math (R1). */
  clientUnitPriceCents: z.int().min(1).max(MAX_UNIT_PRICE_CENTS).optional(),
});

/** Body of PUT /api/orders/:id, POST …/save and POST …/request-approval. Array order = position. */
export const OrderInputSchema = z.object({
  dealerId: Uuid,
  /** Integer; the 8,000 floor is a domain rule (422 RATE_BELOW_MINIMUM), not a zod error. */
  rate: z.int(),
  lines: z
    .array(OrderLineInputSchema)
    .max(MAX_LINES)
    .superRefine((lines, ctx) => {
      const seen = new Set<string>();
      lines.forEach((line, index) => {
        if (seen.has(line.id)) {
          ctx.addIssue({ code: "custom", message: "Duplicate line id", path: [index, "id"] });
        }
        seen.add(line.id);
      });
    }),
});

export const LineTermsSchema = z.object({
  productId: Uuid,
  qty: z.int().min(1).max(MAX_QTY),
  unitPriceCents: z.int().min(1).max(MAX_UNIT_PRICE_CENTS),
  discountCents: z.int().min(0).max(MAX_DISCOUNT_CENTS),
});

/** E13 */
export const DecisionBodySchema = z.object({
  decision: z.enum(["approve", "reject"]),
  expectedTerms: LineTermsSchema,
});

/** E5 */
export const PriceBodySchema = z.object({
  unitPriceCents: z.int().min(1).max(MAX_UNIT_PRICE_CENTS),
});

/** E6 — the 8,000 floor is checked by the domain (422), not zod. */
export const GlobalRateBodySchema = z.object({
  globalRate: z.int(),
});

/** E1 */
export const DemoLoginBodySchema = z.object({
  role: z.enum(["adviser", "owner"]),
});

/** E12 */
export const WithdrawBodySchema = z.object({});

export const OrderStatusSchema = z.enum(["draft", "pending_approval", "saved"]);

/** E7 query string */
export const OrdersListQuerySchema = z.object({
  status: OrderStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export type OrderLineInput = z.infer<typeof OrderLineInputSchema>;
export type OrderInput = z.infer<typeof OrderInputSchema>;
export type LineTermsBody = z.infer<typeof LineTermsSchema>;
export type DecisionBody = z.infer<typeof DecisionBodySchema>;
export type PriceBody = z.infer<typeof PriceBodySchema>;
export type GlobalRateBody = z.infer<typeof GlobalRateBodySchema>;
export type DemoLoginBody = z.infer<typeof DemoLoginBodySchema>;
export type OrdersListQuery = z.infer<typeof OrdersListQuerySchema>;

// ---------- Responses ----------

export type Role = "adviser" | "owner";
export type OrderStatus = z.infer<typeof OrderStatusSchema>;
export type Classification = "sand" | "red" | "blocked";
export type LineStateView = "sand" | "red" | "blocked" | "approved";
export type ApprovalStatusView = "none" | "pending" | "approved" | "rejected";

export interface UserView {
  id: string;
  name: string;
  role: Role;
}

export interface UserRef {
  id: string;
  name: string;
}

export interface LineView {
  id: string;
  position: number;
  product: { id: string; sku: string; name: string };
  qty: number;
  unitPriceCents: number;
  discountCents: number;
  lineValueCents: number;
  lineTotalCents: number;
  discountBasisPoints: number;
  /** Raw R3 class. */
  classification: Classification;
  /** Effective state (R4): blocked + matching approval → approved. */
  state: LineStateView;
  approval: { status: ApprovalStatusView; decidedBy: UserRef | null; decidedAt: string | null };
}

export interface OrderView {
  id: string;
  number: number;
  status: OrderStatus;
  createdBy: UserRef;
  dealer: { id: string; name: string; city: string };
  rate: number;
  lines: LineView[];
  /** Saved: stored snapshot; otherwise computed live. */
  totals: { usdCents: number; sdg: number };
  canSave: boolean;
  blockingLineIds: string[];
  createdAt: string;
  updatedAt: string;
  savedAt: string | null;
}

export interface OrderSummary {
  id: string;
  number: number;
  status: OrderStatus;
  dealer: { id: string; name: string };
  createdBy: UserRef;
  rate: number;
  totalUsdCents: number;
  lineCount: number;
  blockedLineCount: number;
  hasRejectedLines: boolean;
  updatedAt: string;
  savedAt: string | null;
}

export interface CatalogDealer {
  id: string;
  name: string;
  city: string;
}

export interface CatalogProduct {
  id: string;
  sku: string;
  name: string;
  unitPriceCents: number;
  updatedAt: string;
}

export interface Catalog {
  dealers: CatalogDealer[];
  products: CatalogProduct[];
  globalRate: number;
  fetchedAt: string;
}

export interface PriceChange {
  lineId: string;
  productId: string;
  clientUnitPriceCents: number;
  serverUnitPriceCents: number;
}

/** E1 */
export interface DemoLoginResponse {
  token: string;
  expiresAt: string;
  user: UserView;
}
/** E3 */
export interface MeResponse {
  user: UserView;
}
/** E4 */
export type CatalogResponse = Catalog;
/** E5 */
export interface PriceResponse {
  product: CatalogProduct;
}
/** E6 */
export interface GlobalRateResponse {
  globalRate: number;
  updatedAt: string;
}
/** E7 */
export interface OrdersListResponse {
  orders: OrderSummary[];
  counts: { pendingApproval: number };
}
/** E8 */
export type OrderResponse = OrderView;
/** E9: the draft view plus price changes detected for this request. */
export type PutOrderResponse = OrderView & { priceChanges: PriceChange[] };
/** E10 */
export interface SaveOrderResponse {
  order: OrderView;
  replayed: boolean;
  priceChanges: PriceChange[];
}
/** E11 */
export interface RequestApprovalResponse {
  order: OrderView;
  priceChanges: PriceChange[];
}
/** E12, E13 */
export interface OrderEnvelopeResponse {
  order: OrderView;
}
