import { requireAdmin } from "@/server/auth/admin";
import { reconcile } from "@/server/demolition/reconcile";
import { handle, json } from "@/server/http/responses";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST (ADMIN): reconcile the ledger against on-chain balances. */
export const POST = handle(async (req: Request) => {
  const { actor } = await requireAdmin(req, "ADMIN");
  return json(await reconcile(actor));
});
