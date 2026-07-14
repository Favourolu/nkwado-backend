import prisma from '../utils/prisma';
import { sendEmail } from './emailService';
import { reminderVendorEmail, reminderCustomerEmail } from './emailTemplates';

const REMINDER_LEAD_TIME_MS = 60 * 60 * 1000; // notify once a quote is within 1h of its deadline

/**
 * Emails the vendor and customer once for each PENDING quote entering its final hour
 * before deadlineAt. Idempotent via Quote.reminderSentAt.
 */
export async function sendApproachingDeadlineReminders(): Promise<number> {
  const now = new Date();
  const leadCutoff = new Date(now.getTime() + REMINDER_LEAD_TIME_MS);

  const quotes = await prisma.quote.findMany({
    where: {
      status: 'PENDING',
      reminderSentAt: null,
      deadlineAt: { lte: leadCutoff, gt: now },
    },
    include: {
      vendor: { include: { user: true } },
      request: { include: { customer: { include: { user: true } } } },
    },
  });

  for (const quote of quotes) {
    await Promise.all([
      sendEmail({
        to: quote.vendor.user.email,
        ...reminderVendorEmail({ eventType: quote.request.eventType, deadlineAt: quote.deadlineAt }),
      }),
      sendEmail({
        to: quote.request.customer.user.email,
        ...reminderCustomerEmail({ eventType: quote.request.eventType, deadlineAt: quote.deadlineAt }),
      }),
    ]);

    await prisma.quote.update({ where: { id: quote.id }, data: { reminderSentAt: now } });
  }

  return quotes.length;
}

/** Flips any PENDING quote past its deadlineAt to EXPIRED. */
export async function expireOverdueQuotes(): Promise<number> {
  const now = new Date();
  const result = await prisma.quote.updateMany({
    where: { status: 'PENDING', deadlineAt: { lte: now } },
    data: { status: 'EXPIRED' },
  });
  return result.count;
}
