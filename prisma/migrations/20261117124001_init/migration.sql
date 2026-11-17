-- CreateEnum
CREATE TYPE "PropertyCategory" AS ENUM ('RESIDENTIAL', 'SAFEHOUSE', 'GARAGE', 'MARINA', 'COMMERCIAL', 'INDUSTRIAL', 'LUXURY', 'ENTERTAINMENT', 'HOSPITALITY', 'RETAIL');

-- CreateEnum
CREATE TYPE "LocationVerification" AS ENUM ('VERIFIED', 'REPORTED', 'CONCEPT');

-- CreateEnum
CREATE TYPE "PropertyStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'DISABLED');

-- CreateEnum
CREATE TYPE "TokenDeploymentStatus" AS ENUM ('NOT_LAUNCHED', 'PENDING_VERIFICATION', 'LIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "MetadataVerification" AS ENUM ('UNVERIFIED', 'VERIFIED', 'MISMATCH');

-- CreateEnum
CREATE TYPE "TradingVenue" AS ENUM ('UNKNOWN', 'PUMPFUN_BONDING_CURVE', 'PUMPSWAP', 'OTHER_DEX');

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('VIEWER', 'EDITOR', 'ADMIN');

-- CreateTable
CREATE TABLE "Property" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" "PropertyCategory" NOT NULL,
    "typeLabel" TEXT,
    "region" TEXT,
    "neighbourhood" TEXT,
    "mapX" DOUBLE PRECISION,
    "mapY" DOUBLE PRECISION,
    "imageUrl" TEXT,
    "galleryImages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "PropertyStatus" NOT NULL DEFAULT 'DRAFT',
    "locationVerification" "LocationVerification" NOT NULL DEFAULT 'CONCEPT',
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "catalogueGroup" TEXT,
    "proposedTicker" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Property_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceReference" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Token" (
    "id" TEXT NOT NULL,
    "mintAddress" TEXT,
    "name" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "imageUrl" TEXT,
    "pumpFunUrl" TEXT,
    "deploymentStatus" "TokenDeploymentStatus" NOT NULL DEFAULT 'NOT_LAUNCHED',
    "launchedAt" TIMESTAMP(3),
    "creatorWallet" TEXT,
    "creatorVerified" BOOLEAN NOT NULL DEFAULT false,
    "isNative" BOOLEAN NOT NULL DEFAULT false,
    "metadataStatus" "MetadataVerification" NOT NULL DEFAULT 'UNVERIFIED',
    "venue" "TradingVenue" NOT NULL DEFAULT 'UNKNOWN',
    "onchainSupply" TEXT,
    "decimals" INTEGER,
    "metadataName" TEXT,
    "metadataSymbol" TEXT,
    "metadataImageUrl" TEXT,
    "lastVerifiedAt" TIMESTAMP(3),
    "propertyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketSnapshot" (
    "id" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "priceUsd" DOUBLE PRECISION,
    "priceSol" DOUBLE PRECISION,
    "marketCapUsd" DOUBLE PRECISION,
    "fdvUsd" DOUBLE PRECISION,
    "volume24hUsd" DOUBLE PRECISION,
    "change24hPct" DOUBLE PRECISION,
    "liquidityUsd" DOUBLE PRECISION,
    "pairAddress" TEXT,
    "dexId" TEXT,
    "lastTradeAt" TIMESTAMP(3),
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminUser" (
    "id" TEXT NOT NULL,
    "githubId" TEXT NOT NULL,
    "login" TEXT,
    "email" TEXT,
    "role" "AdminRole" NOT NULL DEFAULT 'VIEWER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "actorLabel" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Property_slug_key" ON "Property"("slug");

-- CreateIndex
CREATE INDEX "Property_status_category_idx" ON "Property"("status", "category");

-- CreateIndex
CREATE INDEX "Property_status_featured_idx" ON "Property"("status", "featured");

-- CreateIndex
CREATE INDEX "SourceReference_propertyId_idx" ON "SourceReference"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "Token_mintAddress_key" ON "Token"("mintAddress");

-- CreateIndex
CREATE UNIQUE INDEX "Token_propertyId_key" ON "Token"("propertyId");

-- CreateIndex
CREATE INDEX "Token_deploymentStatus_idx" ON "Token"("deploymentStatus");

-- CreateIndex
CREATE INDEX "MarketSnapshot_tokenId_fetchedAt_idx" ON "MarketSnapshot"("tokenId", "fetchedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_githubId_key" ON "AdminUser"("githubId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "SourceReference" ADD CONSTRAINT "SourceReference_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Token" ADD CONSTRAINT "Token_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketSnapshot" ADD CONSTRAINT "MarketSnapshot_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- At most one native ecosystem token.
CREATE UNIQUE INDEX "Token_single_native_key" ON "Token" ("isNative") WHERE "isNative" = true;

-- A native token never belongs to a property.
ALTER TABLE "Token" ADD CONSTRAINT "Token_native_has_no_property" CHECK (NOT "isNative" OR "propertyId" IS NULL);

-- A LIVE or PENDING token must carry a mint address; NOT_LAUNCHED tokens must not.
ALTER TABLE "Token" ADD CONSTRAINT "Token_mint_matches_status" CHECK (
  ("deploymentStatus" = 'NOT_LAUNCHED' AND "mintAddress" IS NULL)
  OR ("deploymentStatus" IN ('PENDING_VERIFICATION', 'LIVE') AND "mintAddress" IS NOT NULL)
  OR "deploymentStatus" = 'INACTIVE'
);

-- Map coordinates are set together or not at all.
ALTER TABLE "Property" ADD CONSTRAINT "Property_map_xy_together" CHECK (("mapX" IS NULL) = ("mapY" IS NULL));
