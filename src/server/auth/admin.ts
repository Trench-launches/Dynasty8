import "server-only";
import type { AdminRole, AdminUser } from "@prisma/client";
import { getToken } from "next-auth/jwt";
import { NextRequest } from "next/server";
import { adminAuthConfigured, getConfig } from "@/server/config";
import { prisma } from "@/server/db";
import { adminApiLimiter } from "@/server/http/rate-limit";
import { ApiError, clientIp, enforceRateLimit } from "@/server/http/responses";
import type { Actor } from "@/server/services/audit";

const RANK: Record<AdminRole, number> = { VIEWER: 1, EDITOR: 2, ADMIN: 3 };

/** Resolves the GitHub id of the signed-in user, or null. Replaceable in tests. */
export type SessionResolver = (req: Request) => Promise<string | null>;

const nextAuthResolver: SessionResolver = async (req) => {
  if (!adminAuthConfigured()) return null;
  const token = await getToken({ req: new NextRequest(req), secret: getConfig().NEXTAUTH_SECRET });
  const id = token?.githubId;
  return typeof id === "string" && /^\d{1,20}$/.test(id) ? id : null;
};

let resolver: SessionResolver = nextAuthResolver;
export function setSessionResolverForTests(r: SessionResolver | null) {
  resolver = r ?? nextAuthResolver;
}

/**
 * CSRF defence for state-changing admin calls: the Origin header must be one of ours.
 * (Session cookies are SameSite=Lax; this blocks cross-site form/fetch posts as well.)
 */
function assertSameOrigin(req: Request) {
  if (req.method === "GET" || req.method === "HEAD") return;
  const origin = req.headers.get("origin");
  if (!origin) throw new ApiError(403, "FORBIDDEN", "Missing Origin header");
  const cfg = getConfig();
  const allowed = new Set<string>([new URL(req.url).origin]);
  if (cfg.NEXTAUTH_URL) allowed.add(new URL(cfg.NEXTAUTH_URL).origin);
  for (const o of (cfg.ADMIN_ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    try {
      allowed.add(new URL(o).origin);
    } catch {
      /* ignore malformed entries */
    }
  }
  if (!allowed.has(origin)) throw new ApiError(403, "FORBIDDEN", "Cross-origin request rejected");
}

/** Server-side authorisation for every admin route. */
export async function requireAdmin(req: Request, minRole: AdminRole): Promise<{ admin: AdminUser; actor: Actor }> {
  enforceRateLimit(adminApiLimiter, req, "admin");
  assertSameOrigin(req);
  const githubId = await resolver(req);
  if (!githubId) throw new ApiError(401, "UNAUTHORIZED", "Sign in required");
  const admin = await prisma.adminUser.findUnique({ where: { githubId } });
  if (!admin || !admin.active) throw new ApiError(403, "FORBIDDEN", "Not an administrator");
  if (RANK[admin.role] < RANK[minRole]) throw new ApiError(403, "FORBIDDEN", `Requires ${minRole} role`);
  return { admin, actor: { id: admin.id, label: `github:${admin.login ?? admin.githubId}`, ip: clientIp(req) } };
}
