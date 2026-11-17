/**
 * Grant, change or revoke an admin. Requires direct database access (run by an operator);
 * there is no default admin and no way to self-register.
 *   npm run admin:grant -- --github-id 1234567 --login octocat --role ADMIN
 *   npm run admin:grant -- --github-id 1234567 --revoke
 * Find a GitHub numeric id with: gh api users/<login> --jq .id
 */
import { prisma } from "../src/server/db";
import { recordAudit } from "../src/server/services/audit";

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const githubId = arg("github-id");
  const role = (arg("role") ?? "VIEWER").toUpperCase();
  const revoke = process.argv.includes("--revoke");
  if (!githubId || !/^\d{1,20}$/.test(githubId)) throw new Error("--github-id <numeric id> is required");
  if (!["VIEWER", "EDITOR", "ADMIN"].includes(role)) throw new Error("--role must be VIEWER, EDITOR or ADMIN");
  const actor = { id: null, label: `cli:${process.env.USERNAME ?? process.env.USER ?? "operator"}` };
  const before = await prisma.adminUser.findUnique({ where: { githubId } });
  const after = revoke
    ? await prisma.adminUser.update({ where: { githubId }, data: { active: false } })
    : await prisma.adminUser.upsert({
        where: { githubId },
        create: { githubId, login: arg("login"), role: role as "VIEWER" | "EDITOR" | "ADMIN" },
        update: { role: role as "VIEWER" | "EDITOR" | "ADMIN", active: true, login: arg("login") ?? before?.login },
      });
  await recordAudit(prisma, actor, revoke ? "admin.revoke" : "admin.grant", "AdminUser", after.id, before, after);
  console.log(`${revoke ? "Revoked" : "Granted"} ${after.role} for GitHub id ${githubId} (active=${after.active}).`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
