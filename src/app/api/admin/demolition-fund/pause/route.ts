import { z } from "zod";
import { requireAdmin } from "@/server/auth/admin";
import { setPaused } from "@/server/demolition/fund";
import { ApiError, handle, json, readJsonBody } from "@/server/http/responses";

const body = z.object({ paused: z.boolean(), reason: z.string().trim().min(3).max(300) }).strict();

/** POST: emergency pause. Any EDITOR may pause; only an ADMIN may resume. */
export const POST = handle(async (req: Request) => {
  const { admin, actor } = await requireAdmin(req, "EDITOR");
  const b = body.parse(await readJsonBody(req));
  if (!b.paused && admin.role !== "ADMIN") throw new ApiError(403, "FORBIDDEN", "Only an ADMIN can resume the fund");
  return json(await setPaused(b.paused, b.reason, actor));
});
