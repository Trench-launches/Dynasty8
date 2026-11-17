import "server-only";
import { Prisma, type Token } from "@prisma/client";
import { prisma } from "@/server/db";
import { ProviderError } from "@/server/http/fetch-json";
import { ApiError } from "@/server/http/responses";
import { logger } from "@/server/logger";
import { getProviders } from "@/server/providers/registry";
import { isValidPublicKey } from "@/server/solana/address";
import { recordAudit, type Actor } from "./audit";

/**
 * Registering an EXISTING token. Nothing here deploys tokens, signs or sends transactions.
 *
 * attachMint:  validate key -> reject duplicates -> confirm the account is an SPL mint
 *              on-chain -> read supply/decimals -> optional metadata lookup -> detect a
 *              Pump.fun bonding curve on-chain -> status PENDING_VERIFICATION.
 * verifyToken: an ADMIN reviews the evidence and marks the token LIVE.
 */
export interface AttachResult {
  token: Token;
  checks: {
    mintExists: boolean;
    program: string | null;
    pumpBondingCurve: boolean;
    bondingCurveComplete: boolean | null;
    metadataProvider: string | null;
    metadataSymbolMatchesTicker: boolean | null;
  };
}

function wrapProvider<T>(p: Promise<T>, what: string): Promise<T> {
  return p.catch((e) => {
    logger.warn({ what, kind: e instanceof ProviderError ? e.kind : "unknown" }, "verification lookup failed");
    throw new ApiError(503, "INTERNAL", `Could not reach the ${what} to verify this mint. Try again later.`);
  });
}

async function attachToToken(token: Token, mintAddress: string, creatorWallet: string | undefined, actor: Actor): Promise<AttachResult> {
  if (!isValidPublicKey(mintAddress)) throw new ApiError(400, "BAD_REQUEST", "Not a valid Solana public key");
  if (token.mintAddress) {
    throw new ApiError(409, "CONFLICT", "This token already has a mint address. Deactivate it and create a new listing instead of re-pointing it.");
  }
  const dup = await prisma.token.findUnique({ where: { mintAddress } });
  if (dup) throw new ApiError(409, "CONFLICT", "This mint address is already registered to another token");

  const { solana, metadata } = getProviders();
  const mint = await wrapProvider(solana.getMintInfo(mintAddress), "Solana RPC");
  if (!mint.exists) throw new ApiError(422, "UNPROCESSABLE", "No account exists at this address on Solana mainnet");
  if (!mint.program) throw new ApiError(422, "UNPROCESSABLE", "The account is not an SPL token mint");

  const curve = await wrapProvider(solana.getPumpCurve(mintAddress), "Solana RPC");
  const meta = metadata ? await wrapProvider(metadata.getMetadata(mintAddress), "metadata provider") : null;
  const symbolMatches = meta?.symbol ? meta.symbol.toUpperCase() === token.ticker.toUpperCase() : null;

  const venue = curve.exists ? (curve.complete ? "PUMPSWAP" : "PUMPFUN_BONDING_CURVE") : "UNKNOWN";
  try {
    const updated = await prisma.$transaction(async (tx) => {
      const after = await tx.token.update({
        where: { id: token.id },
        data: {
          mintAddress,
          creatorWallet: creatorWallet ?? null,
          creatorVerified: false,
          deploymentStatus: "PENDING_VERIFICATION",
          metadataStatus: symbolMatches === false ? "MISMATCH" : "UNVERIFIED",
          venue,
          // Pump.fun coin page, only for a mint whose bonding-curve account exists on-chain.
          pumpFunUrl: curve.exists ? `https://pump.fun/coin/${mintAddress}` : null,
          onchainSupply: mint.supply,
          decimals: mint.decimals,
          metadataName: meta?.name ?? null,
          metadataSymbol: meta?.symbol ?? null,
          metadataImageUrl: meta?.imageUrl ?? null,
          lastVerifiedAt: new Date(),
        },
      });
      await recordAudit(tx, actor, "token.attach_mint", "Token", token.id, token, after);
      return after;
    });
    return {
      token: updated,
      checks: {
        mintExists: true,
        program: mint.program,
        pumpBondingCurve: curve.exists,
        bondingCurveComplete: curve.complete,
        metadataProvider: meta?.source ?? null,
        metadataSymbolMatchesTicker: symbolMatches,
      },
    };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new ApiError(409, "CONFLICT", "This mint address is already registered to another token");
    }
    throw e;
  }
}

export async function attachMintToProperty(slug: string, mintAddress: string, creatorWallet: string | undefined, actor: Actor) {
  const property = await prisma.property.findUnique({ where: { slug }, include: { token: true } });
  if (!property) throw new ApiError(404, "NOT_FOUND", "Property not found");
  if (property.status === "DISABLED") throw new ApiError(422, "UNPROCESSABLE", "Listing is disabled");
  const token = property.token ?? (await prisma.token.create({ data: { name: property.name, ticker: property.proposedTicker, propertyId: property.id } }));
  return attachToToken(token, mintAddress, creatorWallet, actor);
}

export async function attachNativeMint(mintAddress: string, actor: Actor) {
  const token = await prisma.token.findFirst({ where: { isNative: true } });
  if (!token) throw new ApiError(404, "NOT_FOUND", "Native token registry entry missing");
  return attachToToken(token, mintAddress, undefined, actor);
}

export async function verifyToken(
  tokenId: string,
  input: { acknowledgeMetadataMismatch?: boolean; note?: string; launchedAt?: string; creatorVerified?: boolean },
  actor: Actor,
) {
  const token = await prisma.token.findUnique({ where: { id: tokenId } });
  if (!token) throw new ApiError(404, "NOT_FOUND", "Token not found");
  if (!token.mintAddress) throw new ApiError(422, "UNPROCESSABLE", "Attach a mint address first");
  if (token.deploymentStatus !== "PENDING_VERIFICATION") {
    throw new ApiError(422, "UNPROCESSABLE", `Token is ${token.deploymentStatus}, not PENDING_VERIFICATION`);
  }
  if (token.metadataStatus === "MISMATCH" && !(input.acknowledgeMetadataMismatch && input.note)) {
    throw new ApiError(422, "UNPROCESSABLE", "On-chain metadata symbol does not match the ticker. Acknowledge with a note to proceed.");
  }
  // Re-check the chain at verification time.
  const mint = await wrapProvider(getProviders().solana.getMintInfo(token.mintAddress), "Solana RPC");
  if (!mint.exists || !mint.program) throw new ApiError(422, "UNPROCESSABLE", "Mint account no longer valid on-chain");

  return prisma.$transaction(async (tx) => {
    const after = await tx.token.update({
      where: { id: token.id },
      data: {
        deploymentStatus: "LIVE",
        metadataStatus: "VERIFIED",
        launchedAt: input.launchedAt ? new Date(input.launchedAt) : token.launchedAt,
        creatorVerified: input.creatorVerified ?? token.creatorVerified,
        onchainSupply: mint.supply,
        decimals: mint.decimals,
        lastVerifiedAt: new Date(),
      },
    });
    await recordAudit(tx, actor, "token.verify", "Token", token.id, token, { ...after, note: input.note ?? null });
    return after;
  });
}

/** Deactivate a compromised token, or re-activate one that was verified before. */
export async function setTokenStatus(tokenId: string, status: "INACTIVE" | "LIVE", reason: string, actor: Actor) {
  return prisma.$transaction(async (tx) => {
    const token = await tx.token.findUnique({ where: { id: tokenId } });
    if (!token) throw new ApiError(404, "NOT_FOUND", "Token not found");
    if (status === "LIVE" && (token.deploymentStatus !== "INACTIVE" || token.metadataStatus !== "VERIFIED" || !token.mintAddress)) {
      throw new ApiError(422, "UNPROCESSABLE", "Only a previously verified, inactive token can be re-activated");
    }
    const after = await tx.token.update({ where: { id: tokenId }, data: { deploymentStatus: status } });
    await recordAudit(tx, actor, status === "INACTIVE" ? "token.deactivate" : "token.reactivate", "Token", tokenId, token, { ...after, reason });
    return after;
  });
}
