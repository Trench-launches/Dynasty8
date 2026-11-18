import { requireAdmin } from "@/server/auth/admin";
import { prisma } from "@/server/db";
import { checkFeeSharing, expectedShareholders } from "@/server/demolition/fee-sharing";
import { handle, json } from "@/server/http/responses";

/** GET (VIEWER): expected Pump fee-sharing shareholders and the latest on-chain check per token. */
export const GET = handle(async (req: Request) => {
  await requireAdmin(req, "VIEWER");
  const [expected, items] = await Promise.all([expectedShareholders(), prisma.feeSharingCheck.findMany({ orderBy: { checkedAt: "desc" } })]);
  return json({ expected, items });
});

/** POST (ADMIN): re-read every registered property token's fee-sharing config on-chain now. */
export const POST = handle(async (req: Request) => {
  await requireAdmin(req, "ADMIN");
  return json(await checkFeeSharing());
});
