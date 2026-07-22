-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EventType" ADD VALUE 'HOVER';
ALTER TYPE "EventType" ADD VALUE 'DWELL';

-- AlterTable
ALTER TABLE "PlatformConfig" ADD COLUMN     "samplingConfig" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "UIElement" ADD COLUMN     "extraction" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "formContext" TEXT,
ADD COLUMN     "semanticRole" TEXT;

-- AlterTable
ALTER TABLE "UIRoute" ADD COLUMN     "authRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "extraction" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "sourceFile" TEXT,
ADD COLUMN     "title" TEXT;

-- AlterTable
ALTER TABLE "UISemantic" ADD COLUMN     "extraction" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "UserEvent" ADD COLUMN     "meta" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "InterventionCache" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "elementId" TEXT NOT NULL,
    "struggleType" "StruggleType" NOT NULL,
    "variantIndex" INTEGER NOT NULL,
    "type" "InterventionType" NOT NULL,
    "copy" TEXT NOT NULL,
    "title" TEXT,
    "helpCopy" TEXT,
    "relatedElementIds" JSONB NOT NULL DEFAULT '[]',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "contextHash" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InterventionCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonthlyActiveUser" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userIdHash" TEXT NOT NULL,
    "monthStart" TIMESTAMP(3) NOT NULL,
    "firstSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonthlyActiveUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestKey" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "IngestKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InterventionCache_orgId_idx" ON "InterventionCache"("orgId");

-- CreateIndex
CREATE INDEX "InterventionCache_elementId_struggleType_idx" ON "InterventionCache"("elementId", "struggleType");

-- CreateIndex
CREATE UNIQUE INDEX "InterventionCache_elementId_struggleType_variantIndex_key" ON "InterventionCache"("elementId", "struggleType", "variantIndex");

-- CreateIndex
CREATE INDEX "MonthlyActiveUser_orgId_monthStart_idx" ON "MonthlyActiveUser"("orgId", "monthStart");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyActiveUser_orgId_userIdHash_monthStart_key" ON "MonthlyActiveUser"("orgId", "userIdHash", "monthStart");

-- CreateIndex
CREATE UNIQUE INDEX "IngestKey_hash_key" ON "IngestKey"("hash");

-- CreateIndex
CREATE INDEX "IngestKey_orgId_idx" ON "IngestKey"("orgId");

-- AddForeignKey
ALTER TABLE "InterventionCache" ADD CONSTRAINT "InterventionCache_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterventionCache" ADD CONSTRAINT "InterventionCache_elementId_fkey" FOREIGN KEY ("elementId") REFERENCES "UIElement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestKey" ADD CONSTRAINT "IngestKey_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
