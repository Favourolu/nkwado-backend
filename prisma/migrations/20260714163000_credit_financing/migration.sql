-- Credit/financing feature (Parthian-backed, stubbed pending real API credentials — see
-- CLAUDE.md note 19). Purely additive: a new Booking column with a default, and a new table.

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('FULL_PAYMENT', 'FINANCED');

-- CreateEnum
CREATE TYPE "LoanApplicationStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'DISBURSED', 'DEFAULTED');

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'FULL_PAYMENT';

-- CreateTable
CREATE TABLE "LoanApplication" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "principalAmount" DOUBLE PRECISION NOT NULL,
    "planId" TEXT NOT NULL,
    "tenorMonths" INTEGER NOT NULL,
    "monthlyPayment" DOUBLE PRECISION NOT NULL,
    "totalRepayable" DOUBLE PRECISION NOT NULL,
    "status" "LoanApplicationStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "parthianReferenceId" TEXT,
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoanApplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LoanApplication_bookingId_key" ON "LoanApplication"("bookingId");

-- CreateIndex
CREATE INDEX "LoanApplication_customerId_idx" ON "LoanApplication"("customerId");

-- CreateIndex
CREATE INDEX "LoanApplication_status_idx" ON "LoanApplication"("status");

-- AddForeignKey
ALTER TABLE "LoanApplication" ADD CONSTRAINT "LoanApplication_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanApplication" ADD CONSTRAINT "LoanApplication_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
