/**
 * One-off: move the launch-catalogue listings onto the GTA VI community map (see
 * src/components/map/tiles.ts). The seed never touches existing rows, so a database seeded
 * earlier still holds pins from an older map, and five listings still carry the region,
 * neighbourhood and description from before they were matched to their in-game places.
 *
 * A field is only changed while it still holds a value the catalogue itself once gave it,
 * so anything an admin has edited since is left alone. Safe to run more than once.
 *
 *   npx tsx --env-file-if-exists=.env scripts/remap-map-locations.ts          (dry run)
 *   npx tsx --env-file-if-exists=.env scripts/remap-map-locations.ts --apply
 */
import { Prisma, PrismaClient } from "@prisma/client";
import { CATALOGUE, catalogueDescription, slugify } from "../src/server/catalogue";

/**
 * Every position the catalogue has given each listing before: the committed illustrated map,
 * the uncommitted Florida-outline map, and an interim placement used during the switch.
 */
const PREVIOUS_POSITIONS: Record<string, [number, number][]> = {
  "Starlet Motel": [[302, 362], [393, 717]],
  "Leonida Keys Safehouse": [[668, 1418], [833, 1422]],
  "Bayside Safehouse": [[1014, 1002], [923, 1218]],
  "Jason's Stilt House": [[538, 1478], [664, 1482]],
  "Shorecourt Garage": [[982, 1172], [905, 1241]],
  "Paradise Garage": [[888, 1010], [905, 1204], [700, 698]],
  "Key Lento Marina Club": [[600, 1446], [740, 1469]],
  "Ocean View Hotel": [[1088, 1080], [935, 1218]],
  "Venture Apartments": [[940, 958], [923, 1197]],
  "Pegassi Residences": [[1082, 976], [936, 1204], [893, 681]],
  "Megamundo HQ": [[992, 1050], [922, 1224]],
  "Only Raw Records": [[928, 1100], [916, 1226]],
  "Rideout Customs": [[776, 476], [769, 998], [612, 520]],
  "Delights Cabaret": [[1086, 1150], [934, 1224], [897, 700]],
  "Brian's Boat Works & Marina": [[248, 386], [421, 761], [274, 477]],
};

/** Listing text the catalogue gave these listings before they moved to their in-game places. */
const PREVIOUS_TEXT: Record<string, { region: string; neighbourhood: string; description: string }> = {
  "Paradise Garage": {
    region: "vice-city",
    neighbourhood: "Vice City",
    description: "A sun-bleached body shop with a hand-painted sign, roll-up doors and a back office that never seems to close.",
  },
  "Pegassi Residences": {
    region: "vice-city",
    neighbourhood: "Ocean Beach, Vice City",
    description: "Glass-fronted luxury residences on the north end of the beach, with valet parking and a private pool deck.",
  },
  "Rideout Customs": {
    region: "ambrosia",
    neighbourhood: "Ambrosia",
    description: "A highway-side custom shop with a dyno bay, a paint booth and a forecourt full of projects.",
  },
  "Delights Cabaret": {
    region: "vice-city",
    neighbourhood: "Ocean Beach, Vice City",
    description:
      "A neon-soaked cabaret on the beach strip with a velvet rope, a rooftop terrace and a bass line you can feel from the causeway.",
  },
  "Brian's Boat Works & Marina": {
    region: "port-gellhorn",
    neighbourhood: "Port Gellhorn",
    description: "A working boatyard and marina on the Port Gellhorn harbour, with slipways, a dry stack and a chandlery.",
  },
};

async function main() {
  const apply = process.argv.includes("--apply");
  const prisma = new PrismaClient();
  let changed = 0;
  try {
    for (const e of CATALOGUE) {
      const slug = slugify(e.name);
      const row = await prisma.property.findUnique({
        where: { slug },
        select: { mapX: true, mapY: true, region: true, neighbourhood: true, description: true },
      });
      if (!row) {
        console.log(`skip    ${slug}: not in the database`);
        continue;
      }
      const data: Prisma.PropertyUpdateInput = {};
      const notes: string[] = [];

      const prev = PREVIOUS_POSITIONS[e.name] ?? [];
      if (e.map && (row.mapX !== e.map[0] || row.mapY !== e.map[1])) {
        if (prev.some(([x, y]) => row.mapX === x && row.mapY === y)) {
          data.mapX = e.map[0];
          data.mapY = e.map[1];
          notes.push(`pin (${row.mapX}, ${row.mapY}) -> (${e.map.join(", ")})`);
        } else {
          notes.push(`pin edited (${row.mapX}, ${row.mapY}), left alone`);
        }
      }

      const text = PREVIOUS_TEXT[e.name];
      if (text) {
        /** Move a field to `next` only while it still holds the catalogue's earlier value. */
        const step = <T>(field: string, current: T, before: T, next: T, set: (v: T) => void) => {
          if (current === next) return;
          if (current === before) {
            set(next);
            notes.push(`${field} updated`);
          } else {
            notes.push(`${field} edited, left alone`);
          }
        };
        step("region", row.region, text.region, e.region ?? null, (v) => (data.region = v));
        step("neighbourhood", row.neighbourhood, text.neighbourhood, e.neighbourhood ?? null, (v) => (data.neighbourhood = v));
        step("description", row.description, text.description, catalogueDescription(e), (v) => (data.description = v));
      }

      if (!notes.length) {
        console.log(`ok      ${slug}: already up to date`);
        continue;
      }
      const writes = Object.keys(data).length > 0;
      console.log(`${writes ? (apply ? "update " : "would  ") : "keep   "} ${slug}: ${notes.join("; ")}`);
      if (writes) {
        changed++;
        if (apply) await prisma.property.update({ where: { slug }, data });
      }
    }
  } finally {
    await prisma.$disconnect();
  }
  console.log(apply ? `Updated ${changed} listings.` : `${changed} listings would change. Re-run with --apply to write.`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
