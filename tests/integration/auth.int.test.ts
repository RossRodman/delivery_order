import { randomUUID } from "node:crypto";
import { decodeJwt, SignJWT } from "jose";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as demoLogin } from "@/app/api/auth/demo-login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { GET as me } from "@/app/api/me/route";
import type { DemoLoginResponse, MeResponse } from "@/contracts/api";
import { closeTestDb, resetAndSeed, testDb } from "../helpers/db";
import { AMINA, YUSUF } from "../helpers/fixtures";
import { buildRequest, call, tokenFor, type ErrorBody } from "../helpers/http";

beforeEach(resetAndSeed);
afterAll(closeTestDb);

const secret = () => new TextEncoder().encode(process.env.SESSION_SECRET!);

describe("E1 demo-login", () => {
  it("returns a token + user and sets an HttpOnly SameSite=Lax cookie", async () => {
    const res = await call<DemoLoginResponse>(demoLogin, buildRequest("POST", "/api/auth/demo-login", { body: { role: "adviser" } }));
    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({ id: AMINA.id, name: "Amina", role: "adviser" });
    expect(typeof res.body.token).toBe("string");
    expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toContain(`os_session=${res.body.token}`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
  });

  it("owner login returns Yusuf; the token carries no role claim", async () => {
    const res = await call<DemoLoginResponse>(demoLogin, buildRequest("POST", "/api/auth/demo-login", { body: { role: "owner" } }));
    expect(res.body.user).toMatchObject({ id: YUSUF.id, role: "owner" });
    const claims = decodeJwt(res.body.token);
    expect(claims.sub).toBe(YUSUF.id);
    expect(claims).not.toHaveProperty("role");
    expect(Object.keys(claims).sort()).toEqual(["exp", "iat", "sub"]);
  });

  it("rejects unknown roles with 400 and non-JSON with 415", async () => {
    const bad = await call<ErrorBody>(demoLogin, buildRequest("POST", "/api/auth/demo-login", { body: { role: "admin" } }));
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("VALIDATION_FAILED");
    const text = await call<ErrorBody>(
      demoLogin,
      buildRequest("POST", "/api/auth/demo-login", { rawBody: "role=owner", contentType: "text/plain" }),
    );
    expect(text.status).toBe(415);
    expect(text.body.error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
    const form = await call<ErrorBody>(
      demoLogin,
      buildRequest("POST", "/api/auth/demo-login", { rawBody: "role=owner", contentType: "application/x-www-form-urlencoded" }),
    );
    expect(form.status).toBe(415);
  });

  it("malformed JSON → 400", async () => {
    const res = await call<ErrorBody>(demoLogin, buildRequest("POST", "/api/auth/demo-login", { rawBody: "{nope" }));
    expect(res.status).toBe(400);
  });
});

describe("E3 /api/me", () => {
  it("works with the cookie and with a Bearer token", async () => {
    const token = await tokenFor(AMINA.id);
    const viaCookie = await call<MeResponse>(me, buildRequest("GET", "/api/me", { cookie: `foo=bar; os_session=${token}` }));
    expect(viaCookie.status).toBe(200);
    expect(viaCookie.body.user).toEqual({ id: AMINA.id, name: "Amina", role: "adviser" });
    const viaBearer = await call<MeResponse>(me, buildRequest("GET", "/api/me", { token }));
    expect(viaBearer.body.user.id).toBe(AMINA.id);
    expect(viaBearer.headers.get("cache-control")).toBe("no-store");
  });

  it("missing, tampered and expired tokens → 401 UNAUTHENTICATED", async () => {
    const token = await tokenFor(AMINA.id);
    const [h, p] = token.split(".");
    const forgedPayload = Buffer.from(JSON.stringify({ sub: YUSUF.id, iat: 1, exp: 9999999999 })).toString("base64url");
    const tampered = `${h}.${forgedPayload}.${token.split(".")[2]}`;
    const expired = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(AMINA.id)
      .setIssuedAt(Math.floor(Date.now() / 1000) - 100_000)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 10)
      .sign(secret());
    const wrongKey = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(AMINA.id)
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode("another-secret-that-is-long-enough-000"));
    const unsigned = `${Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")}.${p}.`;
    for (const opts of [{}, { token: tampered }, { token: expired }, { token: wrongKey }, { token: unsigned }, { token: "garbage" }, { cookie: "os_session=garbage" }]) {
      const res = await call<ErrorBody>(me, buildRequest("GET", "/api/me", opts));
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHENTICATED");
    }
  });

  it("a token for a deleted user → 401", async () => {
    const id = randomUUID();
    await testDb().sql`INSERT INTO users (id, name, role) VALUES (${id}, 'Ghost', 'owner')`;
    const token = await tokenFor(id);
    expect((await call(me, buildRequest("GET", "/api/me", { token }))).status).toBe(200);
    await testDb().sql`DELETE FROM users WHERE id = ${id}`;
    const res = await call<ErrorBody>(me, buildRequest("GET", "/api/me", { token }));
    expect(res.status).toBe(401);
  });

  it("the role comes from the DB, not the token", async () => {
    const token = await tokenFor(AMINA.id);
    await testDb().sql`UPDATE users SET role = 'owner' WHERE id = ${AMINA.id}`;
    const res = await call<MeResponse>(me, buildRequest("GET", "/api/me", { token }));
    expect(res.body.user.role).toBe("owner");
  });
});

describe("E2 logout and content-type enforcement", () => {
  it("logout clears the cookie", async () => {
    const res = await logout(buildRequest("POST", "/api/auth/logout", { contentType: null }), { params: Promise.resolve({}) });
    expect(res.status).toBe(204);
    expect(res.headers.get("set-cookie")).toContain("os_session=;");
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
