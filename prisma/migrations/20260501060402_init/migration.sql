-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "PlatformStatus" AS ENUM ('CREATED', 'MAPPING', 'ACTIVE', 'ERROR');

-- CreateEnum
CREATE TYPE "ProviderKind" AS ENUM ('DEEP', 'FAST');

-- CreateEnum
CREATE TYPE "ProviderName" AS ENUM ('ANTHROPIC', 'OPENAI', 'GOOGLE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ElementType" AS ENUM ('BUTTON', 'INPUT', 'SELECT', 'FORM', 'LINK', 'CUSTOM');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('CLICK', 'INPUT_CHANGE', 'SUBMIT', 'NAVIGATION', 'CUSTOM');

-- CreateEnum
CREATE TYPE "StruggleType" AS ENUM ('RAGE_CLICK', 'LOOP', 'THRASH', 'SILENT_FAIL');

-- CreateEnum
CREATE TYPE "InterventionType" AS ENUM ('OVERLAY', 'DOM', 'BEHAVIOR');

-- CreateEnum
CREATE TYPE "InterventionOutcome" AS ENUM ('SUCCESS', 'ABANDON', 'DISMISSED');

-- CreateEnum
CREATE TYPE "MappingStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "Org" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Org_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "role" "MemberRole" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformConfig" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "platformName" TEXT NOT NULL,
    "platformDescription" TEXT NOT NULL,
    "repoUrl" TEXT,
    "crawlerTarget" TEXT,
    "status" "PlatformStatus" NOT NULL DEFAULT 'CREATED',
    "safeMode" BOOLEAN NOT NULL DEFAULT true,
    "safeModeUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderKey" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "kind" "ProviderKind" NOT NULL,
    "provider" "ProviderName" NOT NULL,
    "encryptedKey" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "lastFour" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rotatedAt" TIMESTAMP(3),

    CONSTRAINT "ProviderKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UIElement" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "componentName" TEXT,
    "elementType" "ElementType" NOT NULL,
    "labelRaw" TEXT,
    "labelHash" TEXT NOT NULL,
    "handlerFunction" TEXT,
    "routeTarget" TEXT,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UIElement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UIRoute" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "parentPath" TEXT,
    "entryPoints" JSONB NOT NULL DEFAULT '[]',
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UIRoute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UISemantic" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "elementId" TEXT NOT NULL,
    "contextHash" TEXT NOT NULL,
    "semanticName" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "expectedOutcome" TEXT NOT NULL,
    "failureModes" JSONB NOT NULL DEFAULT '[]',
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "enrichedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UISemantic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userIdHash" TEXT,
    "elementId" TEXT,
    "route" TEXT NOT NULL,
    "eventType" "EventType" NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "idempotencyKey" TEXT,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "UserEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StruggleEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "elementId" TEXT,
    "type" "StruggleType" NOT NULL,
    "severity" DOUBLE PRECISION NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StruggleEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FailureAnalysis" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "elementId" TEXT NOT NULL,
    "rootCause" TEXT NOT NULL,
    "recommendations" JSONB NOT NULL DEFAULT '[]',
    "confidence" DOUBLE PRECISION NOT NULL,
    "enrichedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FailureAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Intervention" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "elementId" TEXT NOT NULL,
    "type" "InterventionType" NOT NULL,
    "config" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "variantGroup" TEXT,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "successes" INTEGER NOT NULL DEFAULT 0,
    "dismissals" INTEGER NOT NULL DEFAULT 0,
    "successRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Intervention_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterventionImpression" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "interventionId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "variant" TEXT,
    "outcome" "InterventionOutcome" NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InterventionImpression_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageMonth" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "month" TIMESTAMP(3) NOT NULL,
    "mau" INTEGER NOT NULL DEFAULT 0,
    "events" INTEGER NOT NULL DEFAULT 0,
    "deepTokens" BIGINT NOT NULL DEFAULT 0,
    "fastTokens" BIGINT NOT NULL DEFAULT 0,
    "interventionsShown" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsageMonth_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GitHubInstallation" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "installationId" INTEGER NOT NULL,
    "accountLogin" TEXT NOT NULL,
    "accountType" TEXT NOT NULL,
    "repositoriesUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "GitHubInstallation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GitHubRepo" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "defaultBranch" TEXT,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "lastMappedAt" TIMESTAMP(3),
    "mappingStatus" "MappingStatus" NOT NULL DEFAULT 'PENDING',
    "mappingError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GitHubRepo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DetectedFramework" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "repoId" TEXT,
    "frameworkId" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DetectedFramework_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE INDEX "Membership_orgId_idx" ON "Membership"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_orgId_key" ON "Membership"("userId", "orgId");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformConfig_orgId_key" ON "PlatformConfig"("orgId");

-- CreateIndex
CREATE INDEX "ProviderKey_orgId_idx" ON "ProviderKey"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderKey_orgId_kind_key" ON "ProviderKey"("orgId", "kind");

-- CreateIndex
CREATE INDEX "UIElement_orgId_idx" ON "UIElement"("orgId");

-- CreateIndex
CREATE INDEX "UIElement_orgId_routeTarget_idx" ON "UIElement"("orgId", "routeTarget");

-- CreateIndex
CREATE INDEX "UIRoute_orgId_idx" ON "UIRoute"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "UIRoute_orgId_path_key" ON "UIRoute"("orgId", "path");

-- CreateIndex
CREATE INDEX "UISemantic_orgId_idx" ON "UISemantic"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "UISemantic_elementId_contextHash_key" ON "UISemantic"("elementId", "contextHash");

-- CreateIndex
CREATE INDEX "UserEvent_orgId_ts_idx" ON "UserEvent"("orgId", "ts" DESC);

-- CreateIndex
CREATE INDEX "UserEvent_orgId_sessionId_ts_idx" ON "UserEvent"("orgId", "sessionId", "ts");

-- CreateIndex
CREATE INDEX "UserEvent_elementId_idx" ON "UserEvent"("elementId");

-- CreateIndex
CREATE UNIQUE INDEX "UserEvent_orgId_idempotencyKey_key" ON "UserEvent"("orgId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "StruggleEvent_orgId_ts_idx" ON "StruggleEvent"("orgId", "ts" DESC);

-- CreateIndex
CREATE INDEX "StruggleEvent_orgId_type_idx" ON "StruggleEvent"("orgId", "type");

-- CreateIndex
CREATE INDEX "StruggleEvent_elementId_idx" ON "StruggleEvent"("elementId");

-- CreateIndex
CREATE INDEX "FailureAnalysis_orgId_idx" ON "FailureAnalysis"("orgId");

-- CreateIndex
CREATE INDEX "FailureAnalysis_elementId_idx" ON "FailureAnalysis"("elementId");

-- CreateIndex
CREATE INDEX "Intervention_orgId_idx" ON "Intervention"("orgId");

-- CreateIndex
CREATE INDEX "Intervention_orgId_variantGroup_idx" ON "Intervention"("orgId", "variantGroup");

-- CreateIndex
CREATE INDEX "Intervention_elementId_idx" ON "Intervention"("elementId");

-- CreateIndex
CREATE INDEX "InterventionImpression_orgId_ts_idx" ON "InterventionImpression"("orgId", "ts" DESC);

-- CreateIndex
CREATE INDEX "InterventionImpression_interventionId_idx" ON "InterventionImpression"("interventionId");

-- CreateIndex
CREATE INDEX "UsageMonth_orgId_idx" ON "UsageMonth"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "UsageMonth_orgId_month_key" ON "UsageMonth"("orgId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "GitHubInstallation_installationId_key" ON "GitHubInstallation"("installationId");

-- CreateIndex
CREATE INDEX "GitHubInstallation_orgId_idx" ON "GitHubInstallation"("orgId");

-- CreateIndex
CREATE INDEX "GitHubRepo_orgId_idx" ON "GitHubRepo"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "GitHubRepo_installationId_fullName_key" ON "GitHubRepo"("installationId", "fullName");

-- CreateIndex
CREATE INDEX "DetectedFramework_orgId_idx" ON "DetectedFramework"("orgId");

-- CreateIndex
CREATE INDEX "DetectedFramework_repoId_idx" ON "DetectedFramework"("repoId");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Org" ADD CONSTRAINT "Org_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformConfig" ADD CONSTRAINT "PlatformConfig_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderKey" ADD CONSTRAINT "ProviderKey_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UIElement" ADD CONSTRAINT "UIElement_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UIRoute" ADD CONSTRAINT "UIRoute_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UISemantic" ADD CONSTRAINT "UISemantic_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UISemantic" ADD CONSTRAINT "UISemantic_elementId_fkey" FOREIGN KEY ("elementId") REFERENCES "UIElement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserEvent" ADD CONSTRAINT "UserEvent_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserEvent" ADD CONSTRAINT "UserEvent_elementId_fkey" FOREIGN KEY ("elementId") REFERENCES "UIElement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StruggleEvent" ADD CONSTRAINT "StruggleEvent_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StruggleEvent" ADD CONSTRAINT "StruggleEvent_elementId_fkey" FOREIGN KEY ("elementId") REFERENCES "UIElement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FailureAnalysis" ADD CONSTRAINT "FailureAnalysis_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FailureAnalysis" ADD CONSTRAINT "FailureAnalysis_elementId_fkey" FOREIGN KEY ("elementId") REFERENCES "UIElement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Intervention" ADD CONSTRAINT "Intervention_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Intervention" ADD CONSTRAINT "Intervention_elementId_fkey" FOREIGN KEY ("elementId") REFERENCES "UIElement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterventionImpression" ADD CONSTRAINT "InterventionImpression_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterventionImpression" ADD CONSTRAINT "InterventionImpression_interventionId_fkey" FOREIGN KEY ("interventionId") REFERENCES "Intervention"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageMonth" ADD CONSTRAINT "UsageMonth_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GitHubInstallation" ADD CONSTRAINT "GitHubInstallation_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GitHubRepo" ADD CONSTRAINT "GitHubRepo_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GitHubRepo" ADD CONSTRAINT "GitHubRepo_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "GitHubInstallation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DetectedFramework" ADD CONSTRAINT "DetectedFramework_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DetectedFramework" ADD CONSTRAINT "DetectedFramework_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "GitHubRepo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
