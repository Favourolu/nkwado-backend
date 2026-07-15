-- LoanApplication.parthianReferenceId is looked up as a unique key by the loan-status
-- webhook; it was missing the actual DB constraint. Multiple NULLs are fine under a
-- Postgres unique index (NULL != NULL), so this is safe against existing PENDING_REVIEW
-- rows that haven't been assigned a reference yet.
CREATE UNIQUE INDEX "LoanApplication_parthianReferenceId_key" ON "LoanApplication"("parthianReferenceId");
