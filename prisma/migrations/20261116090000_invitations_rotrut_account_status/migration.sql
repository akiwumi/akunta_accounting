-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "rotRutDeduction" DECIMAL(18,2),
ADD COLUMN     "rotRutDetailsJson" TEXT,
ADD COLUMN     "rotRutPaidOutAt" TIMESTAMP(3),
ADD COLUMN     "rotRutPayoutTransactionId" TEXT,
ADD COLUMN     "rotRutRequestedAt" TIMESTAMP(3),
ADD COLUMN     "rotRutType" TEXT;

-- AlterTable
ALTER TABLE "InvoiceItem" ADD COLUMN     "rotRutHours" DECIMAL(10,2),
ADD COLUMN     "rotRutLabour" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "rotRutWorkType" TEXT;

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'accountant',
    "tokenHash" TEXT NOT NULL,
    "invitedByUserId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");

-- CreateIndex
CREATE INDEX "Invitation_businessId_idx" ON "Invitation"("businessId");

-- CreateIndex
CREATE INDEX "Invitation_email_idx" ON "Invitation"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_rotRutPayoutTransactionId_key" ON "Invoice"("rotRutPayoutTransactionId");

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Row level security for the new table (see 20261115120000_ledger_hardening).
ALTER TABLE "Invitation" ENABLE ROW LEVEL SECURITY;
