import { requireAdmin } from "@/server/auth/admin";
import { scanFundWallet } from "@/server/demolition/receipts";
import { handle, json } from "@/server/http/responses";

/** POST (ADMIN): scan the fund wallet's finalized history for new fee receipts now. */
export const POST = handle(async (req: Request) => {
  await requireAdmin(req, "ADMIN");
  return json(await scanFundWallet());
});
