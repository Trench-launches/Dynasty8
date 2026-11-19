/**
 * One-off: move the launch-catalogue listings onto their current catalogue placements on the
 * GTA VI community map (see src/components/map/tiles.ts). The seed never touches existing
 * rows, so a database seeded earlier still holds pins (and some listing text) from an older
 * placement.
 *
 * A field is only changed while it still holds a value the catalogue itself once gave it,
 * so anything an admin has edited since is left alone. Safe to run more than once.
 *
 * --fill-empty also fills listings seeded from the bare early catalogue: a missing pin, a
 * missing region or neighbourhood, and the neutral "proposed listing" description. Leave it
 * off on a database where an admin may have taken a listing off the map on purpose.
 *
 *   npx tsx --env-file-if-exists=.env scripts/remap-map-locations.ts          (dry run)
 *   npx tsx --env-file-if-exists=.env scripts/remap-map-locations.ts --apply
 *   npx tsx --env-file-if-exists=.env scripts/remap-map-locations.ts --apply --fill-empty
 */
import { Prisma, PrismaClient } from "@prisma/client";
import { CATALOGUE, catalogueDescription, slugify } from "../src/server/catalogue";

/**
 * Every position the catalogue has given each listing before: the committed illustrated map,
 * the uncommitted Florida-outline map, an interim placement used during the switch, and the
 * first community-map placement (before the listings were spread across Vice City).
 */
const PREVIOUS_POSITIONS: Record<string, [number, number][]> = {
  "Starlet Motel": [[302, 362], [393, 717], [433, 551]],
  "Leonida Keys Safehouse": [[668, 1418], [833, 1422]],
  "Bayside Safehouse": [[1014, 1002], [923, 1218], [744, 688]],
  "Jason's Stilt House": [[538, 1478], [664, 1482]],
  "Shorecourt Garage": [[982, 1172], [905, 1241], [859, 692]],
  "Paradise Garage": [[888, 1010], [905, 1204], [700, 698], [513, 920]],
  "Key Lento Marina Club": [[600, 1446], [740, 1469]],
  "Ocean View Hotel": [[1088, 1080], [935, 1218], [891, 728]],
  "Venture Apartments": [[940, 958], [923, 1197], [685, 723]],
  "Pegassi Residences": [[1082, 976], [936, 1204], [893, 681]],
  "Megamundo HQ": [[992, 1050], [922, 1224], [739, 786]],
  "Only Raw Records": [[928, 1100], [916, 1226], [690, 760]],
  "Rideout Customs": [[776, 476], [769, 998], [612, 520], [714, 707]],
  "Delights Cabaret": [[1086, 1150], [934, 1224], [897, 700], [371, 544]],
  "Brian's Boat Works & Marina": [[248, 386], [421, 761], [274, 477], [608, 1134]],
};

/** Listing text the catalogue has given these listings before, oldest first. */
type ListingText = { region: string; neighbourhood: string; description: string };
const PREVIOUS_TEXT: Record<string, ListingText[]> = {
  "Starlet Motel": [
    {
      region: "port-gellhorn",
      neighbourhood: "Port Gellhorn",
      description:
        "A roadside motel with a flickering neon sign, a drained pool and a parking lot that has seen things. The Gulf-coast hideout that started it all.",
    },
  ],
  "Shorecourt Garage": [
    {
      region: "vice-city",
      neighbourhood: "Vice City",
      description: "A covered courtyard garage a few blocks from the waterfront, with room for a small collection and no questions asked.",
    },
  ],
  "Paradise Garage": [
    {
      region: "vice-city",
      neighbourhood: "Vice City",
      description: "A sun-bleached body shop with a hand-painted sign, roll-up doors and a back office that never seems to close.",
    },
    {
      region: "grassrivers",
      neighbourhood: "Watson Bay",
      description: "A sun-bleached body shop with a hand-painted sign, roll-up doors and a back office that never seems to close.",
    },
  ],
  "Pegassi Residences": [
    {
      region: "vice-city",
      neighbourhood: "Ocean Beach, Vice City",
      description: "Glass-fronted luxury residences on the north end of the beach, with valet parking and a private pool deck.",
    },
  ],
  "Rideout Customs": [
    {
      region: "ambrosia",
      neighbourhood: "Ambrosia",
      description: "A highway-side custom shop with a dyno bay, a paint booth and a forecourt full of projects.",
    },
  ],
  "Delights Cabaret": [
    {
      region: "vice-city",
      neighbourhood: "Ocean Beach, Vice City",
      description:
        "A neon-soaked cabaret on the beach strip with a velvet rope, a rooftop terrace and a bass line you can feel from the causeway.",
    },
    {
      region: "port-gellhorn",
      neighbourhood: "Port Gellhorn",
      description:
        "A neon-soaked cabaret off the interstate in Port Gellhorn, with a velvet rope, a rooftop terrace and a bass line you can feel from the parking lot.",
    },
  ],
  "Brian's Boat Works & Marina": [
    {
      region: "port-gellhorn",
      neighbourhood: "Port Gellhorn",
      description: "A working boatyard and marina on the Port Gellhorn harbour, with slipways, a dry stack and a chandlery.",
    },
    {
      region: "leonida-keys",
      neighbourhood: "Key Lento, Leonida Keys",
      description: "A working boatyard and marina on Key Lento, with slipways, a dry stack and a chandlery.",
    },
  ],
};

async function main() {
  const apply = process.argv.includes("--apply");
  const fillEmpty = process.argv.includes("--fill-empty");
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
        const unmapped = row.mapX === null && row.mapY === null;
        if (prev.some(([x, y]) => row.mapX === x && row.mapY === y) || (unmapped && fillEmpty)) {
          data.mapX = e.map[0];
          data.mapY = e.map[1];
          notes.push(`pin (${row.mapX}, ${row.mapY}) -> (${e.map.join(", ")})`);
        } else if (unmapped) {
          notes.push("no pin, left alone (pass --fill-empty to place it)");
        } else {
          notes.push(`pin edited (${row.mapX}, ${row.mapY}), left alone`);
        }
      }

      // The bare early catalogue left these empty (or neutral); --fill-empty counts that as an earlier value.
      const empty: ListingText[] = fillEmpty
        ? [{ region: null, neighbourhood: null, description: catalogueDescription({ ...e, description: undefined }) } as unknown as ListingText]
        : [];
      const history = [...(PREVIOUS_TEXT[e.name] ?? []), ...empty];
      if (history.length) {
        /** Move a field to `next` only while it still holds one of the catalogue's earlier values. */
        const step = <T>(field: string, current: T, before: T[], next: T, set: (v: T) => void) => {
          if (current === next) return;
          if (before.includes(current)) {
            set(next);
            notes.push(`${field} updated`);
          } else {
            notes.push(`${field} edited, left alone`);
          }
        };
        const was = <K extends keyof ListingText>(k: K) => history.map((h) => h[k]);
        step("region", row.region, was("region"), e.region ?? null, (v) => (data.region = v));
        step("neighbourhood", row.neighbourhood, was("neighbourhood"), e.neighbourhood ?? null, (v) => (data.neighbourhood = v));
        step("description", row.description, was("description"), catalogueDescription(e), (v) => (data.description = v));
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
