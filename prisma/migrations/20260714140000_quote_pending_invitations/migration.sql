-- AlterTable
ALTER TABLE "Quote" ALTER COLUMN "basePrice" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Quote_requestId_vendorId_key" ON "Quote"("requestId", "vendorId");

