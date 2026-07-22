-- AlterTable
ALTER TABLE "PlatformConfig" ADD COLUMN     "invasiveAllowlist" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "routeDenylist" JSONB NOT NULL DEFAULT '[]';
