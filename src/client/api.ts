/**
 * Typed fetch wrapper (plan.md §7). Every call resolves — never throws — to
 * `{ ok: true, data }` or `{ ok: false, status, error }`. A network failure (fetch rejects,
 * e.g. offline) is normalised to `status: 0`, `error.code: 'NETWORK'` so callers have one
 * shape to branch on regardless of how the request failed. This is also the seam where the
 * offline data-access layer (F7) will slot in: callers only see `ApiResult<T>`.
 */
import type {
  Catalog,
  DecisionBody,
  DemoLoginResponse,
  GlobalRateResponse,
  MeResponse,
  OrderEnvelopeResponse,
  OrderInput,
  OrderResponse,
  OrdersListResponse,
  PriceResponse,
  PutOrderResponse,
  RequestApprovalResponse,
  Role,
  SaveOrderResponse,
} from "@/contracts/api";
import type { ApiErrorBody, ClientErrorCode } from "@/contracts/errors";

export interface ApiError {
  code: ClientErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: ApiError };

const DEFAULT_NETWORK_ERROR: ApiError = {
  code: "NETWORK",
  message: "Couldn't reach the server. Check your connection.",
};

async function request<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
      credentials: "include",
    });
  } catch {
    return { ok: false, status: 0, error: DEFAULT_NETWORK_ERROR };
  }

  if (res.status === 204) {
    return { ok: true, data: undefined as T };
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (!res.ok) {
    const errorBody = (body as { error?: ApiErrorBody } | null)?.error;
    const error: ApiError = errorBody
      ? { code: errorBody.code, message: errorBody.message, details: errorBody.details }
      : { code: "INTERNAL", message: "Something went wrong. Please try again." };
    return { ok: false, status: res.status, error };
  }

  return { ok: true, data: body as T };
}

function json(body: unknown): RequestInit {
  return { method: "POST", body: JSON.stringify(body) };
}

export const api = {
  demoLogin: (role: Role) =>
    request<DemoLoginResponse>("/api/auth/demo-login", json({ role })),
  logout: () => request<void>("/api/auth/logout", { method: "POST" }),
  me: () => request<MeResponse>("/api/me"),
  catalog: () => request<Catalog>("/api/catalog", { cache: "no-store" }),
  updateProductPrice: (productId: string, unitPriceCents: number) =>
    request<PriceResponse>(`/api/products/${productId}`, {
      method: "PATCH",
      body: JSON.stringify({ unitPriceCents }),
    }),
  updateGlobalRate: (globalRate: number) =>
    request<GlobalRateResponse>("/api/settings/global-rate", {
      method: "PUT",
      body: JSON.stringify({ globalRate }),
    }),
  listOrders: (status?: string) =>
    request<OrdersListResponse>(`/api/orders${status ? `?status=${status}` : ""}`),
  getOrder: (id: string) => request<OrderResponse>(`/api/orders/${id}`),
  putOrder: (id: string, input: OrderInput) =>
    request<PutOrderResponse>(`/api/orders/${id}`, { method: "PUT", body: JSON.stringify(input) }),
  saveOrder: (id: string, input: OrderInput) =>
    request<SaveOrderResponse>(`/api/orders/${id}/save`, json(input)),
  requestApproval: (id: string, input: OrderInput) =>
    request<RequestApprovalResponse>(`/api/orders/${id}/request-approval`, json(input)),
  withdrawApproval: (id: string) =>
    request<OrderEnvelopeResponse>(`/api/orders/${id}/withdraw-approval`, json({})),
  decideLine: (orderId: string, lineId: string, body: DecisionBody) =>
    request<OrderEnvelopeResponse>(`/api/orders/${orderId}/lines/${lineId}/decision`, json(body)),
};
