-- CreateTable
CREATE TABLE "Installation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Installation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstallationSettings" (
    "installationId" TEXT NOT NULL,
    "payRate" DECIMAL(65,30) NOT NULL DEFAULT 0.5,
    "reportCcEmail" TEXT NOT NULL DEFAULT '',
    "estimateRatePerFoot" DECIMAL(65,30) NOT NULL DEFAULT 0,

    CONSTRAINT "InstallationSettings_pkey" PRIMARY KEY ("installationId")
);

-- CreateTable
CREATE TABLE "CrewProfile" (
    "installationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "certifications" TEXT NOT NULL DEFAULT '',
    "bio" TEXT NOT NULL DEFAULT '',
    "photo" TEXT NOT NULL DEFAULT '',
    "joined" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "CrewProfile_pkey" PRIMARY KEY ("installationId","userId")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "site" TEXT NOT NULL DEFAULT '',
    "boat" TEXT NOT NULL DEFAULT '',
    "ownerName" TEXT NOT NULL DEFAULT '',
    "customerEmail" TEXT NOT NULL DEFAULT '',
    "footage" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "price" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "rotation" TEXT NOT NULL DEFAULT 'weekly',
    "dueDate" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'open',
    "notes" TEXT NOT NULL DEFAULT '',
    "videos" JSONB NOT NULL DEFAULT '[]',
    "assignedUserIds" JSONB NOT NULL DEFAULT '[]',
    "completedBy" TEXT,
    "completedByName" TEXT,
    "completedAt" TIMESTAMP(3),
    "completionNote" TEXT NOT NULL DEFAULT '',
    "completionPhoto" TEXT NOT NULL DEFAULT '',
    "checkAnswers" JSONB NOT NULL DEFAULT '[]',
    "certified" BOOLEAN NOT NULL DEFAULT false,
    "certifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceRecord" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "site" TEXT NOT NULL DEFAULT '',
    "boat" TEXT NOT NULL DEFAULT '',
    "ownerName" TEXT NOT NULL DEFAULT '',
    "customerEmail" TEXT NOT NULL DEFAULT '',
    "diverNames" TEXT NOT NULL DEFAULT '',
    "completedBy" TEXT,
    "completedByName" TEXT,
    "completedAt" TIMESTAMP(3),
    "rotation" TEXT NOT NULL DEFAULT 'weekly',
    "price" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "footage" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "note" TEXT NOT NULL DEFAULT '',
    "photo" TEXT NOT NULL DEFAULT '',
    "certified" BOOLEAN NOT NULL DEFAULT false,
    "certifiedAt" TIMESTAMP(3),
    "answers" JSONB NOT NULL DEFAULT '[]',
    "sent" BOOLEAN NOT NULL DEFAULT false,
    "sentAt" TIMESTAMP(3),
    "sentTo" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistQuestion" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "text" TEXT NOT NULL DEFAULT '',
    "ord" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ChecklistQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "type" TEXT NOT NULL DEFAULT 'item',
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "salePrice" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "sku" TEXT NOT NULL DEFAULT '',
    "lowStockAt" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'in',
    "amount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "description" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT '',
    "date" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Installation_tenantId_idx" ON "Installation"("tenantId");

-- CreateIndex
CREATE INDEX "CrewProfile_installationId_idx" ON "CrewProfile"("installationId");

-- CreateIndex
CREATE INDEX "Job_installationId_idx" ON "Job"("installationId");

-- CreateIndex
CREATE INDEX "Job_installationId_status_idx" ON "Job"("installationId", "status");

-- CreateIndex
CREATE INDEX "ServiceRecord_installationId_idx" ON "ServiceRecord"("installationId");

-- CreateIndex
CREATE INDEX "ServiceRecord_installationId_jobId_idx" ON "ServiceRecord"("installationId", "jobId");

-- CreateIndex
CREATE INDEX "ServiceRecord_installationId_sent_idx" ON "ServiceRecord"("installationId", "sent");

-- CreateIndex
CREATE INDEX "ChecklistQuestion_installationId_idx" ON "ChecklistQuestion"("installationId");

-- CreateIndex
CREATE INDEX "InventoryItem_installationId_idx" ON "InventoryItem"("installationId");

-- CreateIndex
CREATE INDEX "InventoryItem_installationId_type_idx" ON "InventoryItem"("installationId", "type");

-- CreateIndex
CREATE INDEX "LedgerEntry_installationId_idx" ON "LedgerEntry"("installationId");

-- CreateIndex
CREATE INDEX "LedgerEntry_installationId_date_idx" ON "LedgerEntry"("installationId", "date");

-- AddForeignKey
ALTER TABLE "InstallationSettings" ADD CONSTRAINT "InstallationSettings_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "Installation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
