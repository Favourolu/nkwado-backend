interface EmailContent {
  subject: string;
  html: string;
}

const BRAND_COLOR = '#0f5c5c'; // deep teal, peacock-adjacent per the spec's logo direction
const ACCENT_COLOR = '#1a8a8a';

/**
 * Escapes user-controlled values before they're interpolated into email HTML. Several of
 * the values below originate from untrusted input — a vendor's own `businessName`, an
 * admin's free-text `rejectionReason` — and are rendered in a *different* user's inbox
 * (customer, vendor). Without escaping, a value like `<a href="http://evil">clickme</a>` or
 * an `<img>` beacon would render as live HTML in the recipient's email client (content
 * spoofing / phishing / tracking-pixel injection). Escaping neutralizes the markup so it
 * shows as literal text.
 */
function esc(value: string | number): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatNaira(amount: number): string {
  return `₦${amount.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function baseLayout(preheader: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#f4f6f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <span style="display:none;font-size:1px;color:#f4f6f6;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${preheader}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f6f6;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:520px;background-color:#ffffff;border-radius:8px;overflow:hidden;">
          <tr>
            <td style="background-color:${BRAND_COLOR};padding:24px 32px;">
              <span style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:0.5px;">Nkwado</span>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;color:#1f2937;font-size:15px;line-height:1.6;">
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px;background-color:#f9fafb;color:#9ca3af;font-size:12px;">
              Nkwado — event planning, simplified. This is an automated notification.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function button(label: string, url: string): string {
  return `<a href="${esc(url)}" style="display:inline-block;margin-top:16px;padding:12px 24px;background-color:${ACCENT_COLOR};color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;">${esc(label)}</a>`;
}

/** Sent to a vendor when they're matched to a new customer event request. */
export function vendorInquiryEmail(input: { eventType: string; deadlineAt: Date }): EmailContent {
  const eventLabel = esc(input.eventType.toLowerCase());
  return {
    subject: `New event inquiry: ${input.eventType}`,
    html: baseLayout(
      `You've been matched to a new ${eventLabel} event`,
      `<h2 style="margin:0 0 12px;color:${BRAND_COLOR};">New event inquiry</h2>
       <p>You've been matched to a new <strong>${eventLabel}</strong> event request on Nkwado.</p>
       <p>Please respond with a quote by <strong>${esc(input.deadlineAt.toUTCString())}</strong> — after that, the request may be reassigned.</p>`
    ),
  };
}

/** Sent to a customer when a vendor submits a quote for their request. */
export function quoteSubmittedEmail(input: { businessName: string; basePrice: number; eventType: string }): EmailContent {
  return {
    subject: `New quote from ${input.businessName}`,
    html: baseLayout(
      `${esc(input.businessName)} sent you a quote`,
      `<h2 style="margin:0 0 12px;color:${BRAND_COLOR};">New quote received</h2>
       <p><strong>${esc(input.businessName)}</strong> submitted a quote of <strong>${formatNaira(input.basePrice)}</strong> for your ${esc(input.eventType.toLowerCase())} event.</p>
       <p>Log in to your Nkwado dashboard to review it.</p>`
    ),
  };
}

/** Sent to the vendor once a quote deadline is within its final hour and still unanswered. */
export function reminderVendorEmail(input: { eventType: string; deadlineAt: Date }): EmailContent {
  return {
    subject: 'Quote deadline approaching',
    html: baseLayout(
      'Your quote deadline is approaching',
      `<h2 style="margin:0 0 12px;color:${BRAND_COLOR};">Deadline approaching</h2>
       <p>You have a pending quote request for a ${esc(input.eventType.toLowerCase())} event.</p>
       <p>Please respond by <strong>${esc(input.deadlineAt.toUTCString())}</strong> or the request will expire.</p>`
    ),
  };
}

/** Sent to the customer when a matched vendor hasn't responded and their deadline is close. */
export function reminderCustomerEmail(input: { eventType: string; deadlineAt: Date }): EmailContent {
  return {
    subject: "Vendors haven't responded yet",
    html: baseLayout(
      "One or more vendors haven't responded yet",
      `<h2 style="margin:0 0 12px;color:${BRAND_COLOR};">Still waiting on a quote</h2>
       <p>One or more vendors for your ${esc(input.eventType.toLowerCase())} event haven't submitted a quote yet.</p>
       <p>Their deadline is <strong>${esc(input.deadlineAt.toUTCString())}</strong>. We'll keep you posted.</p>`
    ),
  };
}

/** Sent to the customer ~24h before a still-unbooked SUBMITTED quote auto-expires. */
export function submittedQuoteExpiringEmail(input: { businessName: string; eventType: string; expiresAt: Date }): EmailContent {
  return {
    subject: `Quote from ${input.businessName} is expiring soon`,
    html: baseLayout(
      `Your quote from ${esc(input.businessName)} expires soon`,
      `<h2 style="margin:0 0 12px;color:${BRAND_COLOR};">A quote is about to expire</h2>
       <p><strong>${esc(input.businessName)}</strong> sent you a quote for your ${esc(input.eventType.toLowerCase())} event that you haven't booked yet.</p>
       <p>It expires on <strong>${esc(input.expiresAt.toUTCString())}</strong> — log in to your Nkwado dashboard to accept it before then.</p>`
    ),
  };
}

/** Sent to the customer once a booking is confirmed, with the bill summary and a link to the PDF. */
export function bookingConfirmedCustomerEmail(input: {
  bookingId: string;
  eventType: string;
  subtotal: number;
  serviceCharge: number;
  totalAmount: number;
  billPdfUrl?: string;
}): EmailContent {
  return {
    subject: 'Your Nkwado booking is confirmed',
    html: baseLayout(
      'Your booking is confirmed',
      `<h2 style="margin:0 0 12px;color:${BRAND_COLOR};">Booking confirmed 🎉</h2>
       <p>Your ${esc(input.eventType.toLowerCase())} booking (<strong>${esc(input.bookingId)}</strong>) is confirmed.</p>
       <table role="presentation" width="100%" style="margin-top:16px;border-collapse:collapse;">
         <tr><td style="padding:6px 0;color:#6b7280;">Subtotal</td><td style="padding:6px 0;text-align:right;">${formatNaira(input.subtotal)}</td></tr>
         <tr><td style="padding:6px 0;color:#6b7280;">Service charge (10%)</td><td style="padding:6px 0;text-align:right;">${formatNaira(input.serviceCharge)}</td></tr>
         <tr><td style="padding:10px 0;font-weight:700;border-top:1px solid #e5e7eb;">Total</td><td style="padding:10px 0;text-align:right;font-weight:700;border-top:1px solid #e5e7eb;">${formatNaira(input.totalAmount)}</td></tr>
       </table>
       ${input.billPdfUrl ? button('View bill', input.billPdfUrl) : ''}`
    ),
  };
}

/** Sent to each vendor selected in a confirmed booking. */
export function bookingConfirmedVendorEmail(input: { bookingId: string; eventType: string }): EmailContent {
  return {
    subject: 'Booking confirmed',
    html: baseLayout(
      'A customer confirmed your quote',
      `<h2 style="margin:0 0 12px;color:${BRAND_COLOR};">Your quote was accepted</h2>
       <p>Your quote for booking <strong>${esc(input.bookingId)}</strong> (${esc(input.eventType.toLowerCase())} event) has been accepted.</p>
       <p>Log in to your Nkwado dashboard for the full details.</p>`
    ),
  };
}

/** Sent to a vendor once an admin approves their application. */
export function vendorApprovedEmail(input: { businessName: string }): EmailContent {
  return {
    subject: 'Your Nkwado vendor application has been approved',
    html: baseLayout(
      'Your vendor application was approved',
      `<h2 style="margin:0 0 12px;color:${BRAND_COLOR};">You're approved 🎉</h2>
       <p>Congratulations! <strong>${esc(input.businessName)}</strong> is now an approved vendor on Nkwado.</p>
       <p>You can now receive event inquiries and submit quotes.</p>`
    ),
  };
}

/** Sent to the customer when Parthian approves their financing application. */
export function loanApprovedEmail(input: { eventType: string; monthlyPayment: number; tenorMonths: number }): EmailContent {
  return {
    subject: 'Your financing was approved',
    html: baseLayout(
      'Your financing application was approved',
      `<h2 style="margin:0 0 12px;color:${BRAND_COLOR};">Financing approved 🎉</h2>
       <p>Your financing for your ${esc(input.eventType.toLowerCase())} event booking has been approved.</p>
       <p>Plan: <strong>${esc(input.tenorMonths)} months</strong> at <strong>${formatNaira(input.monthlyPayment)}/month</strong>.</p>
       <p>Log in to your Nkwado dashboard for the full repayment schedule.</p>`
    ),
  };
}

/** Sent to the customer when Parthian rejects their financing application. */
export function loanRejectedEmail(input: { eventType: string; rejectionReason?: string | null }): EmailContent {
  return {
    subject: 'Update on your financing application',
    html: baseLayout(
      'An update on your financing application',
      `<h2 style="margin:0 0 12px;color:${BRAND_COLOR};">Financing not approved</h2>
       <p>Your financing application for your ${esc(input.eventType.toLowerCase())} event booking was not approved.</p>
       ${input.rejectionReason ? `<p><strong>Reason:</strong> ${esc(input.rejectionReason)}</p>` : ''}
       <p>Your booking is still confirmed — log in to your Nkwado dashboard to arrange payment another way.</p>`
    ),
  };
}

/** Sent to a vendor if an admin rejects their application. */
export function vendorRejectedEmail(input: { businessName: string; rejectionReason: string }): EmailContent {
  return {
    subject: 'Update on your Nkwado vendor application',
    html: baseLayout(
      'An update on your vendor application',
      `<h2 style="margin:0 0 12px;color:${BRAND_COLOR};">Application not approved</h2>
       <p>Your application for <strong>${esc(input.businessName)}</strong> was not approved.</p>
       <p><strong>Reason:</strong> ${esc(input.rejectionReason)}</p>
       <p>You're welcome to update your details and resubmit.</p>`
    ),
  };
}
