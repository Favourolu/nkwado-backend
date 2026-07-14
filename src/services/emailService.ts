import { Resend } from 'resend';

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_ADDRESS = process.env.EMAIL_FROM || 'Nkwado <notifications@nkwado.com>';

const isConfigured = !!RESEND_API_KEY && !RESEND_API_KEY.startsWith('your-resend');

const resend = isConfigured ? new Resend(RESEND_API_KEY) : null;

export interface EmailPayload {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail(payload: EmailPayload): Promise<void> {
  if (!isConfigured || !resend) {
    console.log(`[emailService] RESEND_API_KEY not configured, skipping send: "${payload.subject}" -> ${payload.to}`);
    return;
  }

  try {
    await resend.emails.send({
      from: FROM_ADDRESS,
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
    });
  } catch (err) {
    console.error('[emailService] Failed to send email:', err);
  }
}
