import NextAuth from "next-auth";
import { adminAuthConfigured } from "@/server/config";
import { buildAuthOptions } from "@/server/auth/options";
import { ApiError, errorResponse } from "@/server/http/responses";

type Ctx = { params: Promise<{ nextauth: string[] }> };

async function handler(req: Request, ctx: Ctx) {
  if (!adminAuthConfigured()) {
    return errorResponse(new ApiError(404, "NOT_FOUND", "Admin sign-in is not configured"));
  }
  const nextAuth = NextAuth(buildAuthOptions());
  return nextAuth(req, { params: await ctx.params });
}

export { handler as GET, handler as POST };
