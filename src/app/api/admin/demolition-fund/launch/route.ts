import { requireAdmin } from "@/server/auth/admin";
import { listLaunchCoins } from "@/server/demolition/launch";
import { handle, json } from "@/server/http/responses";

/** GET (VIEWER): the committed launch configs for DYNASTY and the 15 property coins, with registration state. */
export const GET = handle(async (req: Request) => {
  await requireAdmin(req, "VIEWER");
  return json({ items: await listLaunchCoins() });
});
