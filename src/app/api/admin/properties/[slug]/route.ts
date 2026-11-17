import { slugSchema, updatePropertyBody } from "@/server/api/schemas";
import { requireAdmin } from "@/server/auth/admin";
import { ApiError, handle, json, readJsonBody } from "@/server/http/responses";
import { adminGetProperty, updateProperty } from "@/server/services/admin-properties";

type Ctx = { params: Promise<{ slug: string }> };

export const GET = handle(async (req: Request, ctx: Ctx) => {
  await requireAdmin(req, "VIEWER");
  return json(await adminGetProperty(slugSchema.parse((await ctx.params).slug)));
});

/**
 * PATCH /api/admin/properties/:slug
 * EDITOR: content, images, category, coordinates, sources, featured, publish/unpublish.
 * ADMIN only: verification status changes and DISABLED (compromised listing).
 */
export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  const { admin, actor } = await requireAdmin(req, "EDITOR");
  const slug = slugSchema.parse((await ctx.params).slug);
  const body = updatePropertyBody.parse(await readJsonBody(req));
  if ((body.locationVerification || body.status === "DISABLED") && admin.role !== "ADMIN") {
    throw new ApiError(403, "FORBIDDEN", "Requires ADMIN role");
  }
  return json(await updateProperty(slug, body, actor));
});
