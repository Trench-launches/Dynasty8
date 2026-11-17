/**
 * Idempotent seed: creates the 15 launch-catalogue listings and the DYNASTY native-token entry.
 * Existing rows are left untouched so admin edits are never overwritten.
 * Creates no mint addresses, no admins and no market data.
 */
import { PrismaClient } from "@prisma/client";
import { CATALOGUE, catalogueDescription, NATIVE_TOKEN, slugify } from "../src/server/catalogue";

export async function seed(prisma: PrismaClient) {
  let created = 0;
  for (const e of CATALOGUE) {
    const slug = slugify(e.name);
    const exists = await prisma.property.findUnique({ where: { slug }, select: { id: true } });
    if (exists) continue;
    await prisma.property.create({
      data: {
        slug,
        name: e.name,
        description: catalogueDescription(e),
        category: e.category,
        typeLabel: e.typeLabel,
        catalogueGroup: e.group,
        proposedTicker: e.ticker,
        locationVerification: "CONCEPT",
        status: "PUBLISHED",
        region: e.region ?? null,
        neighbourhood: e.neighbourhood ?? null,
        // Approximate district placement (CONCEPT); null keeps the listing off the map.
        mapX: e.map?.[0] ?? null,
        mapY: e.map?.[1] ?? null,
        featured: e.featured ?? false,
        token: { create: { name: e.name, ticker: e.ticker, deploymentStatus: "NOT_LAUNCHED" } },
      },
    });
    created++;
  }
  const native = await prisma.token.findFirst({ where: { isNative: true } });
  if (!native) {
    await prisma.token.create({
      data: { name: NATIVE_TOKEN.name, ticker: NATIVE_TOKEN.ticker, isNative: true, deploymentStatus: "NOT_LAUNCHED" },
    });
  }
  return { created, total: CATALOGUE.length };
}

if (process.argv[1] && /seed\.ts$/.test(process.argv[1])) {
  const prisma = new PrismaClient();
  seed(prisma)
    .then((r) => console.log(`Seed complete: ${r.created} new of ${r.total} catalogue listings.`))
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
