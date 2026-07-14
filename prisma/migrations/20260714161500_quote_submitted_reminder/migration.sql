-- Separate idempotency flag for the SUBMITTED-phase (24h-before-timeout) reminder, distinct
-- from reminderSentAt which already guards the PENDING-phase (1h-before-deadline) reminder --
-- reusing one column for both phases would mean a quote that got a PENDING reminder could
-- never get its SUBMITTED-phase reminder.
ALTER TABLE "Quote" ADD COLUMN "submittedReminderSentAt" TIMESTAMP(3);
