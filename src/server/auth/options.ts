import "server-only";
import type { NextAuthOptions } from "next-auth";
import GitHubProvider from "next-auth/providers/github";
import { getConfig } from "@/server/config";
import { prisma } from "@/server/db";

/**
 * Admin sign-in via Auth.js (NextAuth v4) + GitHub OAuth. No passwords are handled here.
 * Only GitHub accounts that already exist (and are active) in the AdminUser table can sign
 * in; there are no default admins. Grant the first admin with `npm run admin:grant`.
 * Roles are re-read from the database on every admin request, so revocation is immediate.
 */
export function buildAuthOptions(): NextAuthOptions {
  const cfg = getConfig();
  return {
    secret: cfg.NEXTAUTH_SECRET,
    session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
    providers:
      cfg.GITHUB_ID && cfg.GITHUB_SECRET
        ? [GitHubProvider({ clientId: cfg.GITHUB_ID, clientSecret: cfg.GITHUB_SECRET })]
        : [],
    callbacks: {
      async signIn({ account, profile }) {
        if (account?.provider !== "github" || !profile) return false;
        const githubId = String((profile as { id?: number | string }).id ?? "");
        if (!githubId) return false;
        const admin = await prisma.adminUser.findUnique({ where: { githubId } });
        return Boolean(admin?.active);
      },
      async jwt({ token, account, profile }) {
        if (account?.provider === "github" && profile) {
          token.githubId = String((profile as { id?: number | string }).id);
        }
        return token;
      },
      async session({ session }) {
        // Nothing privileged is put on the client-visible session object.
        return session;
      },
    },
  };
}
