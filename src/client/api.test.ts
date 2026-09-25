import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("api client", () => {
  it("maps a network failure to a NETWORK error with status 0", async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const result = await api.me();
    expect(result).toEqual({
      ok: false,
      status: 0,
      error: { code: "NETWORK", message: expect.any(String) },
    });
  });

  it("returns typed data on a 2xx response", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ user: { id: "u1", name: "Amina", role: "adviser" } }), {
        status: 200,
      }),
    );
    const result = await api.me();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.user.name).toBe("Amina");
    }
  });

  it("maps a 422 error envelope to a typed ApiError", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "RATE_BELOW_MINIMUM",
            message: "Order rate must be at least 8,000 SDG/USD.",
            details: { min: 8000 },
          },
        }),
        { status: 422 },
      ),
    );
    const result = await api.updateGlobalRate(7999);
    expect(result).toEqual({
      ok: false,
      status: 422,
      error: {
        code: "RATE_BELOW_MINIMUM",
        message: "Order rate must be at least 8,000 SDG/USD.",
        details: { min: 8000 },
      },
    });
  });

  it("falls back to INTERNAL when the error body is missing or unparsable", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response("not json", { status: 500 }));
    const result = await api.me();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INTERNAL");
    }
  });

  it("returns undefined data for a 204 response", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const result = await api.logout();
    expect(result).toEqual({ ok: true, data: undefined });
  });
});
