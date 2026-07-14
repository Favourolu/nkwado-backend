import { Resend } from 'resend';
import prisma from '../utils/prisma';

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_ADDRESS = process.env.EMAIL_FROM || 'Nkwado <notifications@nkwado.com>';

const isConfigured = !!RESEND_API_KEY && !RESEND_API_KEY.startsWith('your-resend');

const resend = isConfigured ? new Resend(RESEND_API_KEY) : null;

export interface EmailPayload {
  to: string;
  subject: string;
  html: string;
}

const MAX_ATTEMPTS = 3;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retries transient send failures with backoff, then persists to EmailFailure instead of
 * only console.error'ing (see architecture audit, section 4) — a Resend outage no longer
 * means a vendor invitation or reminder is silently lost with zero record anywhere.
 */
export async function sendEmail(payload: EmailPayload): Promise<void> {
  if (!isConfigured || !resend) {
    console.log(`[emailService] RESEND_API_KEY not configured, skipping send: "${payload.subject}" -> ${payload.to}`);
    return;
  }

  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await resend.emails.send({
        from: FROM_ADDRESS,
        to: payload.to,
        subject: payload.subject,
        html: payload.html,
      });
      return;
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_ATTEMPTS) await delay(attempt * 1000);
    }
  }

  console.error(`[emailService] Failed to send email to ${payload.to} after ${MAX_ATTEMPTS} attempts:`, lastErr);
  try {
    await prisma.emailFailure.create({
      data: {
        to: payload.to,
        subject: payload.subject,
        error: String(lastErr),
        attempts: MAX_ATTEMPTS,
      },
    });
  } catch (persistErr) {
    console.error('[emailService] Failed to persist EmailFailure record:', persistErr);
  }
}
