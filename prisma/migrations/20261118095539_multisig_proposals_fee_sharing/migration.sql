-- CreateEnum
CREATE TYPE "AllocationMode" AS ENUM ('ON_CHAIN_SPLIT', 'FUND_SPLITS');

-- CreateEnum
CREATE TYPE "ProposalState" AS ENUM ('PREPARED', 'CREATED', 'APPROVED', 'EXECUTED', 'REJECTED', 'CANCELLED', 'STALE', 'MISMATCH');

-- AlterTable
ALTER TABLE "FundConfig" ADD COLUMN     "allocationMode" "AllocationMode" NOT NULL DEFAULT 'ON_CHAIN_SPLIT';

-- AlterTable
ALTER TABLE "RevenueAllocation" ADD COLUMN     "paidDirect" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "TreasuryWallet" ADD COLUMN     "multisigAddress" TEXT,
ADD COLUMN     "multisigMembers" INTEGER,
ADD COLUMN     "multisigThreshold" INTEGER,
ADD COLUMN     "multisigVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "vaultIndex" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "MultisigProposal" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "purpose" "TxPurpose" NOT NULL,
    "multisigAddress" TEXT NOT NULL,
    "vaultIndex" INTEGER NOT NULL,
    "transactionIndex" BIGINT NOT NULL,
    "vaultTransactionPda" TEXT NOT NULL,
    "proposalPda" TEXT NOT NULL,
    "creator" TEXT NOT NULL,
    "messageHash" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "status" "ProposalState" NOT NULL DEFAULT 'PREPARED',
    "approvals" INTEGER NOT NULL DEFAULT 0,
    "threshold" INTEGER NOT NULL,
    "executedSignature" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MultisigProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeSharingCheck" (
    "id" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "mint" TEXT NOT NULL,
    "sharingConfig" TEXT NOT NULL,
    "exists" BOOLEAN NOT NULL,
    "status" TEXT,
    "adminRevoked" BOOLEAN,
    "shareholders" JSONB,
    "matches" BOOLEAN NOT NULL,
    "issues" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeeSharingCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MultisigProposal_vaultTransactionPda_key" ON "MultisigProposal"("vaultTransactionPda");

-- CreateIndex
CREATE UNIQUE INDEX "MultisigProposal_proposalPda_key" ON "MultisigProposal"("proposalPda");

-- CreateIndex
CREATE UNIQUE INDEX "MultisigProposal_executedSignature_key" ON "MultisigProposal"("executedSignature");

-- CreateIndex
CREATE INDEX "MultisigProposal_requestId_purpose_idx" ON "MultisigProposal"("requestId", "purpose");

-- CreateIndex
CREATE INDEX "MultisigProposal_status_idx" ON "MultisigProposal"("status");

-- CreateIndex
CREATE UNIQUE INDEX "MultisigProposal_multisigAddress_transactionIndex_key" ON "MultisigProposal"("multisigAddress", "transactionIndex");

-- CreateIndex
CREATE UNIQUE INDEX "FeeSharingCheck_tokenId_key" ON "FeeSharingCheck"("tokenId");

-- AddForeignKey
ALTER TABLE "MultisigProposal" ADD CONSTRAINT "MultisigProposal_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "BuybackRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- At most one live proposal per buyback step: a second swap/burn proposal cannot be prepared
-- while one is pending, approved or executed.
CREATE UNIQUE INDEX "MultisigProposal_one_live_per_step" ON "MultisigProposal" ("requestId", "purpose")
  WHERE "status" IN ('PREPARED', 'CREATED', 'APPROVED', 'EXECUTED');
ALTER TABLE "MultisigProposal" ADD CONSTRAINT "MultisigProposal_amount_positive" CHECK ("amount" > 0 AND "threshold" >= 1 AND "transactionIndex" > 0);
ALTER TABLE "MultisigProposal" ADD CONSTRAINT "MultisigProposal_purpose" CHECK ("purpose" IN ('SWAP', 'BURN'));
-- A wallet flagged as a multisig vault must name its Squads multisig.
ALTER TABLE "TreasuryWallet" ADD CONSTRAINT "TreasuryWallet_multisig_named" CHECK (NOT "isMultisig" OR "multisigAddress" IS NOT NULL);

-- Worker lease (replaces a session-level advisory lock that is unsafe with a connection pool).
ALTER TABLE "FundConfig" ADD COLUMN "workerLeaseOwner" TEXT, ADD COLUMN "workerLeaseUntil" TIMESTAMP(3), ADD COLUMN "lastFeeSharingCheckAt" TIMESTAMP(3);
