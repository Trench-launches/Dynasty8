import { z } from "zod";
import { requireAdmin } from "@/server/auth/admin";
import { listProposals, syncAllProposals } from "@/server/demolition/proposals";
import { handle, json, queryObject } from "@/server/http/responses";

const q = z.object({ buybackId: z.string().regex(/^[a-z0-9]{20,40}$/).optional() });

/** GET (VIEWER): Squads proposals prepared for buybacks and burns, with on-chain status. */
export const GET = handle(async (req: Request) => {
  await requireAdmin(req, "VIEWER");
  const { buybackId } = q.parse(queryObject(req, ["buybackId"]));
  return json({ items: await listProposals(buybackId) });
});

/** POST (ADMIN): sync open proposals with on-chain state now (read-only). */
export const POST = handle(async (req: Request) => {
  await requireAdmin(req, "ADMIN");
  return json({ result: await syncAllProposals() });
});
