/**
 * Resets a LOCAL development database to the seed state.
 * Refuses to run against anything but localhost, or if the database holds any registered
 * mint, admin or market snapshot (i.e. anything that is not pure seed data).
 *   npm run db:reset-local
 */
import { PrismaClient } from "@prisma/client";
import { seed } from "../prisma/seed";

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
    throw new Error(`Refusing to reset a non-local database (${url.hostname}).`);
  }
  const prisma = new PrismaClient();
  try {
    const counts = {
      mints: await prisma.token.count({ where: { mintAddress: { not: null } } }),
      admins: await prisma.adminUser.count(),
      snapshots: await prisma.marketSnapshot.count(),
    };
    if (counts.mints || counts.admins || counts.snapshots) {
      throw new Error(`Refusing: database holds non-seed data ${JSON.stringify(counts)}`);
    }
    await prisma.$executeRawUnsafe(
      'TRUNCATE "AuditLog", "MarketSnapshot", "SourceReference", "Token", "Property", "AdminUser" RESTART IDENTITY CASCADE',
    );
    const r = await seed(prisma);
    console.log(`Reset complete: ${r.created} listings seeded.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
