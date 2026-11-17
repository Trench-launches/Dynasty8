import "server-only";
import { Prisma } from "@prisma/client";
import type { z } from "zod";
import { prisma } from "@/server/db";
import { ApiError } from "@/server/http/responses";
import type { createPropertyBody, updatePropertyBody } from "@/server/api/schemas";
import { recordAudit, type Actor } from "./audit";

type CreateInput = z.infer<typeof createPropertyBody>;
type UpdateInput = z.infer<typeof updatePropertyBody>;

const adminInclude = { token: true, sources: true } as const;

export async function adminListProperties() {
  return prisma.property.findMany({ include: adminInclude, orderBy: { name: "asc" } });
}

export async function adminGetProperty(slug: string) {
  const p = await prisma.property.findUnique({ where: { slug }, include: adminInclude });
  if (!p) throw new ApiError(404, "NOT_FOUND", "Property not found");
  return p;
}

/** Creates a listing plus its (not launched) token registry entry. */
export async function createProperty(input: CreateInput, actor: Actor) {
  try {
    return await prisma.$transaction(async (tx) => {
      const property = await tx.property.create({
        data: {
          slug: input.slug,
          name: input.name,
          description: input.description,
          category: input.category,
          typeLabel: input.typeLabel ?? null,
          region: input.region ?? null,
          neighbourhood: input.neighbourhood ?? null,
          mapX: input.mapX ?? null,
          mapY: input.mapY ?? null,
          imageUrl: input.imageUrl ?? null,
          galleryImages: input.galleryImages ?? [],
          locationVerification: input.locationVerification,
          proposedTicker: input.proposedTicker,
          featured: input.featured ?? false,
          status: input.status,
          sources: input.sources ? { create: input.sources.map((s) => ({ url: s.url, title: s.title, note: s.note ?? null })) } : undefined,
          token: { create: { name: input.name, ticker: input.proposedTicker } },
        },
        include: adminInclude,
      });
      await recordAudit(tx, actor, "property.create", "Property", property.id, null, property);
      return property;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new ApiError(409, "CONFLICT", "A property with this slug already exists");
    }
    throw e;
  }
}

/**
 * Field edits, publishing, featuring, verification status and disabling.
 * DISABLED also deactivates a live token so its market stops being shown.
 */
export async function updateProperty(slug: string, input: UpdateInput, actor: Actor) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.property.findUnique({ where: { slug }, include: adminInclude });
    if (!before) throw new ApiError(404, "NOT_FOUND", "Property not found");

    const mapX = input.mapX !== undefined ? input.mapX : before.mapX;
    const mapY = input.mapY !== undefined ? input.mapY : before.mapY;
    if ((mapX === null) !== (mapY === null)) throw new ApiError(422, "UNPROCESSABLE", "mapX and mapY must be set together");

    const verification = input.locationVerification ?? before.locationVerification;
    const sourceCount = input.sources ? input.sources.length : before.sources.length;
    if (verification !== "CONCEPT" && sourceCount === 0) {
      throw new ApiError(422, "UNPROCESSABLE", "VERIFIED or REPORTED locations need at least one source reference");
    }

    const { sources, ...fields } = input;
    if (sources) await tx.sourceReference.deleteMany({ where: { propertyId: before.id } });
    const after = await tx.property.update({
      where: { id: before.id },
      data: {
        ...fields,
        sources: sources ? { create: sources.map((s) => ({ url: s.url, title: s.title, note: s.note ?? null })) } : undefined,
      },
      include: adminInclude,
    });

    if (input.status === "DISABLED" && before.token?.deploymentStatus === "LIVE") {
      await tx.token.update({ where: { id: before.token.id }, data: { deploymentStatus: "INACTIVE" } });
      await recordAudit(tx, actor, "token.deactivated_with_property", "Token", before.token.id, { deploymentStatus: "LIVE" }, { deploymentStatus: "INACTIVE" });
    }
    await recordAudit(tx, actor, "property.update", "Property", before.id, before, after);
    return after;
  });
}
