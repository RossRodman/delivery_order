import { randomUUID } from "node:crypto";
import { GET as listGet } from "@/app/api/orders/route";
import { GET as orderGet, PUT as orderPut } from "@/app/api/orders/[id]/route";
import { POST as savePost } from "@/app/api/orders/[id]/save/route";
import type { OrderInput, OrdersListResponse, OrderView, PutOrderResponse, SaveOrderResponse } from "@/contracts/api";
import { DEALER, P } from "./fixtures";
import { buildRequest, call, type ErrorBody } from "./http";

export type Body<T> = T & ErrorBody;

/** AC1 input lines (fresh line ids each call). */
export function ac1Lines() {
  return {
    line1: { id: randomUUID(), productId: P.pump.id, qty: 4, discountCents: 4_000 },
    line2: { id: randomUUID(), productId: P.filter.id, qty: 2, discountCents: 7_000 },
    line3: { id: randomUUID(), productId: P.battery.id, qty: 1, discountCents: 15_000 },
  };
}

type LooseLine = OrderInput["lines"][number] & Record<string, unknown>;

/** Builds an order body; extra/forged fields are allowed on purpose (the server must ignore them). */
export function orderInput(lines: LooseLine[], extra: Partial<OrderInput> = {}): OrderInput {
  return { dealerId: DEALER.id, rate: 8200, lines, ...extra };
}

export async function putOrder(token: string, id: string, body: unknown) {
  return call<Body<PutOrderResponse>>(orderPut, buildRequest("PUT", `/api/orders/${id}`, { token, body }), { id });
}

export async function getOrder(token: string, id: string) {
  return call<Body<OrderView>>(orderGet, buildRequest("GET", `/api/orders/${id}`, { token }), { id });
}

export async function listOrders(token: string, query = "") {
  return call<Body<OrdersListResponse>>(listGet, buildRequest("GET", `/api/orders${query}`, { token }));
}

export async function saveOrder(token: string, id: string, body: unknown) {
  return call<Body<SaveOrderResponse>>(savePost, buildRequest("POST", `/api/orders/${id}/save`, { token, body }), { id });
}
