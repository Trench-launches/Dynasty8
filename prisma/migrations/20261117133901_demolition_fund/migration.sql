-- CreateEnum
CREATE TYPE "TreasuryRole" AS ENUM ('FUND', 'ECOSYSTEM', 'OPERATIONS');

-- CreateEnum
CREATE TYPE "ReceiptSource" AS ENUM ('AUTO_SCAN', 'MANUAL');

-- CreateEnum
CREATE TYPE "BuybackStatus" AS ENUM ('PLANNED', 'QUOTED', 'APPROVED', 'SWAP_SUBMITTED', 'SWAP_CONFIRMED', 'BURN_SUBMITTED', 'BURNED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TxPurpose" AS ENUM ('SWAP', 'BURN', 'DISBURSEMENT');

-- CreateEnum
CREATE TYPE "TxStatus" AS ENUM ('SUBMITTED', 'FINALIZED', 'FAILED', 'EXPIRED');

-- CreateTable
CREATE TABLE "TreasuryWallet" (
    "id" TEXT NOT NULL,
    "role" "TreasuryRole" NOT NULL,
    "address" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isMultisig" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TreasuryWallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FundConfig" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "buybackBps" INTEGER NOT NULL DEFAULT 6000,
    "ecosystemBps" INTEGER NOT NULL DEFAULT 2500,
    "operationsBps" INTEGER NOT NULL DEFAULT 1500,
    "maxBuybackLamportsPerTx" BIGINT NOT NULL DEFAULT 5000000000,
    "maxDailyBuybackLamports" BIGINT NOT NULL DEFAULT 20000000000,
    "reserveLamports" BIGINT NOT NULL DEFAULT 50000000,
    "minBuybackLamports" BIGINT NOT NULL DEFAULT 100000000,
    "minLiquidityUsd" INTEGER NOT NULL DEFAULT 10000,
    "maxPriceImpactBps" INTEGER NOT NULL DEFAULT 200,
    "slippageBps" INTEGER NOT NULL DEFAULT 100,
    "cooldownSeconds" INTEGER NOT NULL DEFAULT 3600,
    "requiredApprovals" INTEGER NOT NULL DEFAULT 2,
    "maxConsecutiveFailures" INTEGER NOT NULL DEFAULT 3,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "paused" BOOLEAN NOT NULL DEFAULT true,
    "pausedReason" TEXT DEFAULT 'Initial state: paused until an admin enables the fund',
    "circuitOpen" BOOLEAN NOT NULL DEFAULT false,
    "circuitReason" TEXT,
    "autoExecutionEnabled" BOOLEAN NOT NULL DEFAULT false,
    "lastScannedSignature" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FundConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeReceipt" (
    "id" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "eventIndex" INTEGER NOT NULL,
    "propertyId" TEXT,
    "tokenId" TEXT NOT NULL,
    "mint" TEXT NOT NULL,
    "sharingConfig" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "lamports" BIGINT NOT NULL,
    "distributedTotal" BIGINT NOT NULL,
    "shareBps" INTEGER NOT NULL,
    "slot" BIGINT NOT NULL,
    "blockTime" TIMESTAMP(3),
    "source" "ReceiptSource" NOT NULL,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeeReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RevenueAllocation" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "buybackLamports" BIGINT NOT NULL,
    "ecosystemLamports" BIGINT NOT NULL,
    "operationsLamports" BIGINT NOT NULL,
    "buybackBps" INTEGER NOT NULL,
    "ecosystemBps" INTEGER NOT NULL,
    "operationsBps" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RevenueAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuybackRequest" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "BuybackStatus" NOT NULL DEFAULT 'PLANNED',
    "targetMint" TEXT NOT NULL,
    "budgetLamports" BIGINT NOT NULL,
    "slippageBps" INTEGER NOT NULL,
    "quoteSource" TEXT,
    "quotedInLamports" BIGINT,
    "quotedOutRaw" BIGINT,
    "minOutRaw" BIGINT,
    "priceImpactBps" INTEGER,
    "routeLabels" TEXT,
    "quotedAt" TIMESTAMP(3),
    "swapSignature" TEXT,
    "solSpentLamports" BIGINT,
    "tokensReceivedRaw" BIGINT,
    "swapConfirmedAt" TIMESTAMP(3),
    "burnSignature" TEXT,
    "tokensBurnedRaw" BIGINT NOT NULL DEFAULT 0,
    "burnedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "swapAttempts" INTEGER NOT NULL DEFAULT 0,
    "burnAttempts" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuybackRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuybackFunding" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "allocationId" TEXT NOT NULL,
    "lamports" BIGINT NOT NULL,

    CONSTRAINT "BuybackFunding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuybackApproval" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuybackApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChainTransaction" (
    "id" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "purpose" "TxPurpose" NOT NULL,
    "requestId" TEXT,
    "status" "TxStatus" NOT NULL DEFAULT 'SUBMITTED',
    "error" TEXT,
    "slot" BIGINT,
    "lastValidBlockHeight" BIGINT,
    "amount" BIGINT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ChainTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Disbursement" (
    "id" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "role" "TreasuryRole" NOT NULL,
    "destination" TEXT NOT NULL,
    "lamports" BIGINT NOT NULL,
    "recordedById" TEXT,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Disbursement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationRun" (
    "id" TEXT NOT NULL,
    "fundAddress" TEXT NOT NULL,
    "chainLamports" BIGINT NOT NULL,
    "liabilitiesLamports" BIGINT NOT NULL,
    "chainTokenRaw" BIGINT NOT NULL,
    "unburnedTokenRaw" BIGINT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReconciliationRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TreasuryWallet_role_key" ON "TreasuryWallet"("role");

-- CreateIndex
CREATE UNIQUE INDEX "TreasuryWallet_address_key" ON "TreasuryWallet"("address");

-- CreateIndex
CREATE INDEX "FeeReceipt_tokenId_idx" ON "FeeReceipt"("tokenId");

-- CreateIndex
CREATE INDEX "FeeReceipt_propertyId_idx" ON "FeeReceipt"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "FeeReceipt_signature_eventIndex_key" ON "FeeReceipt"("signature", "eventIndex");

-- CreateIndex
CREATE UNIQUE INDEX "RevenueAllocation_receiptId_key" ON "RevenueAllocation"("receiptId");

-- CreateIndex
CREATE UNIQUE INDEX "BuybackRequest_idempotencyKey_key" ON "BuybackRequest"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "BuybackRequest_swapSignature_key" ON "BuybackRequest"("swapSignature");

-- CreateIndex
CREATE INDEX "BuybackRequest_status_idx" ON "BuybackRequest"("status");

-- CreateIndex
CREATE INDEX "BuybackRequest_createdAt_idx" ON "BuybackRequest"("createdAt");

-- CreateIndex
CREATE INDEX "BuybackFunding_allocationId_idx" ON "BuybackFunding"("allocationId");

-- CreateIndex
CREATE UNIQUE INDEX "BuybackFunding_requestId_allocationId_key" ON "BuybackFunding"("requestId", "allocationId");

-- CreateIndex
CREATE UNIQUE INDEX "BuybackApproval_requestId_adminId_key" ON "BuybackApproval"("requestId", "adminId");

-- CreateIndex
CREATE UNIQUE INDEX "ChainTransaction_signature_key" ON "ChainTransaction"("signature");

-- CreateIndex
CREATE INDEX "ChainTransaction_requestId_idx" ON "ChainTransaction"("requestId");

-- CreateIndex
CREATE INDEX "ChainTransaction_status_idx" ON "ChainTransaction"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Disbursement_signature_key" ON "Disbursement"("signature");

-- AddForeignKey
ALTER TABLE "RevenueAllocation" ADD CONSTRAINT "RevenueAllocation_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "FeeReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuybackFunding" ADD CONSTRAINT "BuybackFunding_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "BuybackRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuybackFunding" ADD CONSTRAINT "BuybackFunding_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "RevenueAllocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuybackApproval" ADD CONSTRAINT "BuybackApproval_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "BuybackRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChainTransaction" ADD CONSTRAINT "ChainTransaction_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "BuybackRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Allocation percentages must sum to 100% and be non-negative.
ALTER TABLE "FundConfig" ADD CONSTRAINT "FundConfig_bps_sum" CHECK (
  "buybackBps" >= 0 AND "ecosystemBps" >= 0 AND "operationsBps" >= 0
  AND "buybackBps" + "ecosystemBps" + "operationsBps" = 10000
);
ALTER TABLE "FundConfig" ADD CONSTRAINT "FundConfig_singleton" CHECK ("id" = 1);
ALTER TABLE "FundConfig" ADD CONSTRAINT "FundConfig_limits_positive" CHECK (
  "maxBuybackLamportsPerTx" > 0 AND "maxDailyBuybackLamports" >= "maxBuybackLamportsPerTx"
  AND "reserveLamports" >= 0 AND "slippageBps" BETWEEN 1 AND 1000 AND "maxPriceImpactBps" BETWEEN 1 AND 2000
  AND "requiredApprovals" >= 1
);

-- Money is never negative; an allocation splits its receipt exactly.
ALTER TABLE "FeeReceipt" ADD CONSTRAINT "FeeReceipt_positive" CHECK ("lamports" > 0 AND "distributedTotal" >= "lamports");
ALTER TABLE "RevenueAllocation" ADD CONSTRAINT "RevenueAllocation_non_negative" CHECK (
  "buybackLamports" >= 0 AND "ecosystemLamports" >= 0 AND "operationsLamports" >= 0
);
ALTER TABLE "BuybackFunding" ADD CONSTRAINT "BuybackFunding_positive" CHECK ("lamports" > 0);
ALTER TABLE "BuybackRequest" ADD CONSTRAINT "BuybackRequest_amounts" CHECK (
  "budgetLamports" > 0 AND "tokensBurnedRaw" >= 0
  AND ("tokensReceivedRaw" IS NULL OR "tokensBurnedRaw" <= "tokensReceivedRaw")
);
ALTER TABLE "Disbursement" ADD CONSTRAINT "Disbursement_positive" CHECK ("lamports" > 0 AND "role" <> 'FUND');

INSERT INTO "FundConfig" ("id", "updatedAt") VALUES (1, CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING;
