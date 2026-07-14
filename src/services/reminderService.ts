import prisma from '../utils/prisma';
import { sendEmail } from './emailService';

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
    const deadlineStr = quote.deadlineAt.toISOString();

    await Promise.all([
      sendEmail({
        to: quote.vendor.user.email,
        subject: 'Quote deadline approaching',
        html: `<p>Respond by ${deadlineStr} for the ${quote.request.eventType.toLowerCase()} event inquiry.</p>`,
      }),
      sendEmail({
        to: quote.request.customer.user.email,
        subject: "Vendors haven't responded yet",
        html: `<p>One or more vendors for your ${quote.request.eventType.toLowerCase()} event haven't submitted a quote yet. Their deadline is ${deadlineStr}.</p>`,
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
