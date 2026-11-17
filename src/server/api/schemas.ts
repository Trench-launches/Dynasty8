import { z } from "zod";
import { publicKeySchema } from "@/server/solana/address";

export const CATEGORY = z.enum([
  "RESIDENTIAL",
  "SAFEHOUSE",
  "GARAGE",
  "MARINA",
  "COMMERCIAL",
  "INDUSTRIAL",
  "LUXURY",
  "ENTERTAINMENT",
  "HOSPITALITY",
  "RETAIL",
]);
export const VERIFICATION = z.enum(["VERIFIED", "REPORTED", "CONCEPT"]);
export const PROPERTY_STATUS = z.enum(["DRAFT", "PUBLISHED", "UNPUBLISHED", "DISABLED"]);

/** C0 controls (except tab/newline/CR) and bidi overrides/isolates ("Trojan Source"). */
const BIDI = [0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069].map((c) => String.fromCharCode(c)).join("");
const CONTROL_CHARS = new RegExp(`[\x00-\x08\x0B\x0C\x0E-\x1F${BIDI}]`);

export const slugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Invalid slug").max(80);
export const tickerSchema = z.string().regex(/^[A-Z0-9]{1,10}$/, "Ticker must be 1-10 uppercase letters or digits");
const safeText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
     
    .refine((s) => !CONTROL_CHARS.test(s), "Contains control characters");
const httpsUrl = z
  .string()
  .trim()
  .max(500)
  .url()
  .refine((u) => {
    const p = new URL(u);
    return p.protocol === "https:" && !p.username && !p.password;
  }, "Must be an https URL");

export const listPropertiesQuery = z.object({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(24),
  q: z.string().trim().max(60).optional(),
  category: CATEGORY.optional(),
  region: z
    .string()
    .trim()
    .max(60)
    .regex(/^[\p{L}\p{N} '\-.]+$/u, "Invalid region")
    .optional(),
  verification: VERIFICATION.optional(),
  featured: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
  sort: z.enum(["name", "featured", "marketCap", "volume", "change24h"]).default("featured"),
  order: z.enum(["asc", "desc"]).optional(),
});
export type ListPropertiesQuery = z.infer<typeof listPropertiesQuery>;
export const LIST_PROPERTIES_PARAMS = ["page", "pageSize", "q", "category", "region", "verification", "featured", "sort", "order"] as const;

export const chartQuery = z.object({ range: z.enum(["1h", "24h", "7d", "30d", "all"]).default("24h") });

const coord = z.number().finite().min(0).max(10_000);

export const createPropertyBody = z
  .object({
    slug: slugSchema,
    name: safeText(120),
    description: safeText(4_000),
    category: CATEGORY,
    typeLabel: safeText(60).nullish(),
    region: safeText(60).nullish(),
    neighbourhood: safeText(60).nullish(),
    mapX: coord.nullish(),
    mapY: coord.nullish(),
    imageUrl: httpsUrl.nullish(),
    galleryImages: z.array(httpsUrl).max(20).optional(),
    locationVerification: VERIFICATION.default("CONCEPT"),
    proposedTicker: tickerSchema,
    featured: z.boolean().optional(),
    status: PROPERTY_STATUS.default("DRAFT"),
    sources: z.array(z.object({ url: httpsUrl, title: safeText(200), note: safeText(500).nullish() })).max(20).optional(),
  })
  .strict()
  .refine((b) => (b.mapX == null) === (b.mapY == null), "mapX and mapY must be set together")
  .refine((b) => b.locationVerification === "CONCEPT" || (b.sources?.length ?? 0) > 0, {
    message: "VERIFIED or REPORTED locations need at least one source reference",
  });

export const updatePropertyBody = z
  .object({
    name: safeText(120),
    description: safeText(4_000),
    category: CATEGORY,
    typeLabel: safeText(60).nullable(),
    region: safeText(60).nullable(),
    neighbourhood: safeText(60).nullable(),
    mapX: coord.nullable(),
    mapY: coord.nullable(),
    imageUrl: httpsUrl.nullable(),
    galleryImages: z.array(httpsUrl).max(20),
    locationVerification: VERIFICATION,
    featured: z.boolean(),
    status: PROPERTY_STATUS,
    sources: z.array(z.object({ url: httpsUrl, title: safeText(200), note: safeText(500).nullish() })).max(20),
  })
  .partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0, "No fields to update");

export const attachMintBody = z
  .object({
    mintAddress: publicKeySchema,
    creatorWallet: publicKeySchema.optional(),
  })
  .strict();

export const verifyTokenBody = z
  .object({
    /** Required to verify despite a metadata symbol mismatch. */
    acknowledgeMetadataMismatch: z.boolean().optional(),
    note: safeText(500).optional(),
    launchedAt: z.string().datetime().optional(),
    creatorVerified: z.boolean().optional(),
  })
  .strict();

export const updateTokenBody = z
  .object({
    deploymentStatus: z.enum(["INACTIVE", "LIVE"]),
    reason: safeText(500),
  })
  .strict();

export const auditQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  entityType: z.enum(["Property", "Token"]).optional(),
  entityId: z.string().max(40).optional(),
});
