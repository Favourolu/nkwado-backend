import prisma from '../utils/prisma';
import { sendEmail } from './emailService';
import { reminderVendorEmail, reminderCustomerEmail, submittedQuoteExpiringEmail } from './emailTemplates';

const REMINDER_LEAD_TIME_MS = 60 * 60 * 1000; // notify once a quote is within 1h of its deadline
const SUBMITTED_REMINDER_LEAD_TIME_MS = 24 * 60 * 60 * 1000; // notify the customer 24h before a submitted quote times out

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

/**
 * Emails the customer once for each SUBMITTED, unbooked quote entering its final 24h
 * before submittedExpiresAt. Idempotent via Quote.submittedReminderSentAt (kept separate
 * from reminderSentAt, which guards the earlier PENDING-phase reminder on the same row).
 */
export async function sendApproachingSubmittedExpiryReminders(): Promise<number> {
  const now = new Date();
  const leadCutoff = new Date(now.getTime() + SUBMITTED_REMINDER_LEAD_TIME_MS);

  const quotes = await prisma.quote.findMany({
    where: {
      status: 'SUBMITTED',
      bookingId: null,
      submittedReminderSentAt: null,
      submittedExpiresAt: { lte: leadCutoff, gt: now },
    },
    include: {
      vendor: true,
      request: { include: { customer: { include: { user: true } } } },
    },
  });

  for (const quote of quotes) {
    if (!quote.submittedExpiresAt) continue;
    await sendEmail({
      to: quote.request.customer.user.email,
      ...submittedQuoteExpiringEmail({
        businessName: quote.vendor.businessName,
        eventType: quote.request.eventType,
        expiresAt: quote.submittedExpiresAt,
      }),
    });
    await prisma.quote.update({ where: { id: quote.id }, data: { submittedReminderSentAt: now } });
  }

  return quotes.length;
}

/** Flips any PENDING quote past its deadlineAt to EXPIRED. */
export async function expireOverdueQuotes(): Promise<number> {
  const now = new Date();
  const result = await prisma.quote.updateMany({
    where: { status: 'PENDING', deadlineAt: { lte: now } },
    data: { status: 'EXPIRED', version: { increment: 1 } },
  });
  return result.count;
}

/**
 * Flips any SUBMITTED, still-unbooked quote past its submittedExpiresAt to EXPIRED. Without
 * this, a submitted quote that the customer never acts on stays "live" and bookable forever
 * (see architecture audit, section 5) — the conditional `bookingId: null` here means a
 * quote that createBooking is mid-transaction on is never touched by this cron in the same
 * window it's being accepted.
 */
export async function expireOverdueSubmittedQuotes(): Promise<number> {
  const now = new Date();
  const result = await prisma.quote.updateMany({
    where: { status: 'SUBMITTED', bookingId: null, submittedExpiresAt: { lte: now } },
    data: { status: 'EXPIRED', version: { increment: 1 } },
  });
  return result.count;
}
