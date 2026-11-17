import { createPropertyBody } from "@/server/api/schemas";
import { requireAdmin } from "@/server/auth/admin";
import { handle, json, readJsonBody } from "@/server/http/responses";
import { adminListProperties, createProperty } from "@/server/services/admin-properties";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/admin/properties (VIEWER): every listing, including drafts and disabled. */
export const GET = handle(async (req: Request) => {
  await requireAdmin(req, "VIEWER");
  return json({ items: await adminListProperties() });
});

/** POST /api/admin/properties (EDITOR): create a listing (token entry starts NOT_LAUNCHED). */
export const POST = handle(async (req: Request) => {
  const { actor } = await requireAdmin(req, "EDITOR");
  const body = createPropertyBody.parse(await readJsonBody(req));
  return json(await createProperty(body, actor), { status: 201 });
});
