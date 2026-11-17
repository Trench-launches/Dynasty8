import { z } from "zod";
import { requireAdmin } from "@/server/auth/admin";
import { resetCircuit } from "@/server/demolition/fund";
import { handle, json, readJsonBody } from "@/server/http/responses";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const body = z.object({ reason: z.string().trim().min(3).max(300) }).strict();

/** POST (ADMIN): close the circuit breaker after investigating. */
export const POST = handle(async (req: Request) => {
  const { actor } = await requireAdmin(req, "ADMIN");
  return json(await resetCircuit(body.parse(await readJsonBody(req)).reason, actor));
});
