import prisma from '../utils/prisma';

const INVITATION_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Creates a PENDING Quote (an invitation) for each vendor that doesn't already have
 * one on this request. Idempotent — safe to call from both the initial match
 * (questionnaire) and later additions (customize). This is what gives the deadline
 * reminder/auto-expiry job real PENDING rows to act on.
 */
export async function createQuoteInvitations(requestId: string, vendorIds: string[]): Promise<void> {
  if (vendorIds.length === 0) return;

  const existing = await prisma.quote.findMany({
    where: { requestId, vendorId: { in: vendorIds } },
    select: { vendorId: true },
  });
  const existingVendorIds = new Set(existing.map((q) => q.vendorId));
  const newVendorIds = vendorIds.filter((id) => !existingVendorIds.has(id));

  if (newVendorIds.length === 0) return;

  const sentAt = new Date();
  const deadlineAt = new Date(sentAt.getTime() + INVITATION_WINDOW_MS);

  await prisma.quote.createMany({
    data: newVendorIds.map((vendorId) => ({
      requestId,
      vendorId,
      status: 'PENDING' as const,
      sentAt,
      deadlineAt,
    })),
  });
}
