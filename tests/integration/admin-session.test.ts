import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encode } from "next-auth/jwt";
import { resetConfigForTests } from "@/server/config";
import { parseCookies, setSessionResolverForTests } from "@/server/auth/admin";
import { GET as walletsRoute } from "@/app/api/admin/demolition-fund/wallets/route";
import { db, resetDatabase } from "../helpers/fixtures";

/**
 * Regression: the real Auth.js session path (not the test resolver). Wrapping the route's Request
 * in `new NextRequest(req)` threw inside Next 16's route runtime, so every admin call returned 500
 * as soon as GitHub sign-in was configured. This runs the production resolver end to end.
 */
const SECRET = "test-only-secret-0123456789abcdef0123456789abcdef";
const saved: Record<string, string | undefined> = {};

beforeEach(async () => {
  await resetDatabase();
  for (const k of ["NEXTAUTH_SECRET", "GITHUB_ID", "GITHUB_SECRET"]) saved[k] = process.env[k];
  Object.assign(process.env, { NEXTAUTH_SECRET: SECRET, GITHUB_ID: "test-id", GITHUB_SECRET: "test-secret" });
  resetConfigForTests();
  setSessionResolverForTests(null); // the production next-auth resolver
  await db().adminUser.create({ data: { githubId: "424242", login: "signer", role: "ADMIN", active: true } });
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetConfigForTests();
});

const call = (cookie?: string) =>
  walletsRoute(new Request("http://localhost:3530/api/admin/demolition-fund/wallets", { headers: cookie ? { cookie } : {} }));

describe("admin session (real Auth.js JWT)", () => {
  it("accepts a valid session cookie and rejects missing, forged or inactive ones", async () => {
    const token = await encode({ token: { githubId: "424242" }, secret: SECRET });
    expect((await call(`other=1; next-auth.session-token=${token}`)).status).toBe(200);
    expect((await call()).status).toBe(401);
    expect((await call("next-auth.session-token=forged")).status).toBe(401);
    const wrongKey = await encode({ token: { githubId: "424242" }, secret: "a-different-secret-0123456789abcdef0123456789" });
    expect((await call(`next-auth.session-token=${wrongKey}`)).status).toBe(401);
    await db().adminUser.update({ where: { githubId: "424242" }, data: { active: false } });
    expect((await call(`next-auth.session-token=${token}`)).status).toBe(403);
  });

  it("parses cookie headers defensively", () => {
    expect(parseCookies("a=1; b=x%20y; bad; c=%E0%A4%A")).toEqual({ a: "1", b: "x y", c: "%E0%A4%A" });
    expect(parseCookies(null)).toEqual({});
  });
});
