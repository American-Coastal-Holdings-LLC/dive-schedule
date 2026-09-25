-- AlterTable
ALTER TABLE "CrewProfile" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "email" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "local" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "name" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "occurrence" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ServiceRecord" ADD COLUMN     "archived" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "occurrence" INTEGER,
ADD COLUMN     "payAmount" DECIMAL(65,30),
ADD COLUMN     "payRateSnapshot" DECIMAL(65,30),
ADD COLUMN     "paySource" TEXT NOT NULL DEFAULT 'legacy',
ADD COLUMN     "videos" JSONB NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "OperationReceipt" (
    "installationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperationReceipt_pkey" PRIMARY KEY ("installationId","key")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientPayment" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "stripeAccount" TEXT NOT NULL,
    "publicToken" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'unselected',
    "paypalOrderId" TEXT,
    "paypalCaptureId" TEXT,
    "sessionId" TEXT,
    "checkoutUrl" TEXT,
    "paymentIntentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "refundedCents" INTEGER NOT NULL DEFAULT 0,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "policyVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "ClientPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantSettings" (
    "installationId" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "paypalSealed" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantSettings_pkey" PRIMARY KEY ("installationId")
);

-- CreateTable
CREATE TABLE "PaymentSetupState" (
    "hash" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentSetupState_pkey" PRIMARY KEY ("hash")
);

-- CreateIndex
CREATE INDEX "AuditEvent_installationId_createdAt_idx" ON "AuditEvent"("installationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ClientPayment_publicToken_key" ON "ClientPayment"("publicToken");

-- CreateIndex
CREATE UNIQUE INDEX "ClientPayment_paypalOrderId_key" ON "ClientPayment"("paypalOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientPayment_paypalCaptureId_key" ON "ClientPayment"("paypalCaptureId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientPayment_sessionId_key" ON "ClientPayment"("sessionId");

-- CreateIndex
CREATE INDEX "ClientPayment_installationId_status_idx" ON "ClientPayment"("installationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ClientPayment_installationId_recordId_key" ON "ClientPayment"("installationId", "recordId");

-- CreateIndex
CREATE INDEX "ServiceRecord_installationId_completedAt_idx" ON "ServiceRecord"("installationId", "completedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceRecord_installationId_jobId_occurrence_key" ON "ServiceRecord"("installationId", "jobId", "occurrence");


-- Preserve the pre-upgrade calculated earnings as a clearly marked legacy baseline.
-- No historical rate is invented; owners must reconcile true past rates separately.
UPDATE "ServiceRecord" AS r
SET "payRateSnapshot" = COALESCE((SELECT s."payRate" FROM "InstallationSettings" s WHERE s."installationId" = r."installationId"), 0.5),
    "payAmount" = ROUND(r.price * COALESCE((SELECT s."payRate" FROM "InstallationSettings" s WHERE s."installationId" = r."installationId"), 0.5), 2),
    "paySource" = 'legacy_baseline'
WHERE r."payAmount" IS NULL;
