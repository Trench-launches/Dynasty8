import { z } from "zod";
import { requireAdmin } from "@/server/auth/admin";
import {
  approveBuyback,
  burnProposal,
  cancelBuyback,
  getRequest,
  quoteBuyback,
  recordBurnSubmission,
  recordSwapSubmission,
  settleBurn,
  settleSwap,
  swapProposal,
} from "@/server/demolition/buyback";
import { ApiError, handle, json, readJsonBody } from "@/server/http/responses";

const idSchema = z.string().regex(/^[a-z0-9]{20,40}$/);
const sig = z.object({ signature: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/) }).strict();
const note = z.object({ note: z.string().trim().max(300).optional() }).strict();
const reason = z.object({ reason: z.string().trim().min(3).max(300) }).strict();

type Ctx = { params: Promise<{ id: string; action: string }> };

/**
 * POST /api/admin/demolition-fund/buybacks/:id/:action (ADMIN)
 *   quote            genuine Jupiter quote, validated against policy, liquidity and impact
 *   approve          one approval per admin; the creator cannot approve their own request
 *   cancel           release reserved revenue (only before any swap)
 *   swap-proposal    validated swap instructions for the multisig to execute
 *   swap-submitted   {signature} of the executed multisig swap; verified when finalized
 *   burn-proposal    BurnChecked instruction for exactly the purchased tokens
 *   burn-submitted   {signature} of the executed burn; verified when finalized
 *   settle           re-check a submitted swap / burn now
 */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const { admin, actor } = await requireAdmin(req, "ADMIN");
  const p = await ctx.params;
  const requestId = idSchema.parse(p.id);
  switch (p.action) {
    case "quote":
      return json(await quoteBuyback(requestId, actor));
    case "approve": {
      const r = await getRequest(requestId);
      if (r.createdById === admin.id) throw new ApiError(403, "FORBIDDEN", "The creator of a buyback cannot approve it");
      return json(await approveBuyback(requestId, admin.id, note.parse(await readJsonBody(req)).note, actor));
    }
    case "cancel":
      return json(await cancelBuyback(requestId, reason.parse(await readJsonBody(req)).reason, actor));
    case "swap-proposal": {
      const { build } = await swapProposal(requestId);
      return json({
        instructions: build.instructions,
        lookupTables: build.lookupTables,
        quote: { inAmount: build.inAmount, outAmount: build.outAmount, minOut: build.minOut, priceImpactBps: build.priceImpactBps, route: build.routeLabels },
      });
    }
    case "swap-submitted":
      return json(await recordSwapSubmission(requestId, sig.parse(await readJsonBody(req)).signature, actor));
    case "burn-proposal":
      return json(await burnProposal(requestId));
    case "burn-submitted":
      return json(await recordBurnSubmission(requestId, sig.parse(await readJsonBody(req)).signature, actor));
    case "settle": {
      const r = await getRequest(requestId);
      return json(r.status === "BURN_SUBMITTED" ? await settleBurn(requestId) : await settleSwap(requestId));
    }
    default:
      throw new ApiError(404, "NOT_FOUND", "Unknown action");
  }
});
