-- Architecture audit fixes: enums, real quote<->booking FK, indexes, heartbeat/failure tables.
-- Hand-written (not `prisma migrate dev`, which refuses to run non-interactively in this
-- environment) so a backfill step can run between adding the new columns and dropping the
-- old array-based ones, preserving any real booking<->quote links already in production.

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('pending', 'matched', 'quoted', 'booked');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'processing', 'completed', 'failed');

-- AlterTable: EventRequest.status String -> RequestStatus (@map keeps the same DB values,
-- so existing 'pending'/'matched'/'quoted'/'booked' rows cast straight across)
ALTER TABLE "EventRequest"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "RequestStatus" USING "status"::"RequestStatus",
  ALTER COLUMN "status" SET DEFAULT 'pending';

-- AlterTable: Booking.paymentStatus String? -> PaymentStatus? (nullable, no default,
-- matches prior behavior where nothing in the app ever set it)
ALTER TABLE "Booking"
  ALTER COLUMN "paymentStatus" TYPE "PaymentStatus" USING NULLIF("paymentStatus", '')::"PaymentStatus";

-- AlterTable: new columns (added before the old ones are dropped, so backfill below has both)
ALTER TABLE "User" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Quote" ADD COLUMN "bookingId" TEXT;
ALTER TABLE "Quote" ADD COLUMN "submittedExpiresAt" TIMESTAMP(3);
ALTER TABLE "Quote" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_bookingId_fkey"
  FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: for every existing Booking, link its previously array-referenced quotes via the
-- new real FK before the array columns are dropped.
UPDATE "Quote" q
SET "bookingId" = b."id"
FROM "Booking" b
WHERE q."id" = ANY(b."selectedQuoteIds");

-- CreateTable
CREATE TABLE "CronHeartbeat" (
    "name" TEXT NOT NULL,
    "lastRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastRunOk" BOOLEAN NOT NULL DEFAULT true,
    "lastError" TEXT,
    CONSTRAINT "CronHeartbeat_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "EmailFailure" (
    "id" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "error" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmailFailure_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmailFailure_createdAt_idx" ON "EmailFailure"("createdAt");

-- Quote_bookingId_idx: no CreateIndex needed here — Postgres auto-creates an index for the
-- new bookingId FK's referencing side is not automatic, so create it explicitly.
CREATE INDEX "Quote_bookingId_idx" ON "Quote"("bookingId");

-- CreateIndex
CREATE INDEX "Vendor_status_category_idx" ON "Vendor"("status", "category");

-- Now safe to drop the old array-based columns; every existing link has been backfilled onto
-- Quote.bookingId above.
ALTER TABLE "Booking" DROP COLUMN "selectedQuoteIds";
ALTER TABLE "Booking" DROP COLUMN "selectedVendorIds";
