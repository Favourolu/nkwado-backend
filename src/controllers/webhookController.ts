import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import Joi from 'joi';
import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { sendEmail } from '../services/emailService';
import { loanApprovedEmail, loanRejectedEmail } from '../services/emailTemplates';

// Set once real Parthian credentials exist (see CLAUDE.md note 19). Fails closed - with no
// secret configured, every webhook call is rejected rather than silently accepted, since
// this endpoint can flip a booking's payment status with no other auth check.
const WEBHOOK_SECRET = process.env.PARTHIAN_WEBHOOK_SECRET;

const loanWebhookSchema = Joi.object({
  parthianReferenceId: Joi.string().required(),
  status: Joi.string().valid('APPROVED', 'REJECTED', 'DISBURSED', 'DEFAULTED').required(),
  rejectionReason: Joi.string().trim().optional().allow(''),
});

function isAuthorizedWebhook(req: Request): boolean {
  const provided = req.headers['x-parthian-webhook-secret'];
  if (!WEBHOOK_SECRET || typeof provided !== 'string') return false;

  const providedBuf = Buffer.from(provided);
  const secretBuf = Buffer.from(WEBHOOK_SECRET);
  // timingSafeEqual throws on mismatched lengths rather than returning false.
  if (providedBuf.length !== secretBuf.length) return false;
  return crypto.timingSafeEqual(providedBuf, secretBuf);
}

/**
 * Receives Parthian's async loan-decision callback. Stubbed auth (shared-secret header)
 * until real Parthian webhook docs specify their actual signing scheme - see
 * financingService.ts and CLAUDE.md note 19.
 */
export async function handleParthianLoanWebhook(req: Request, res: Response, next: NextFunction) {
  try {
    if (!isAuthorizedWebhook(req)) {
      throw new AppError('Invalid or missing webhook credentials', 401);
    }

    const { error, value } = loanWebhookSchema.validate(req.body);
    if (error) {
      throw new AppError(error.details[0].message, 400);
    }

    const loan = await prisma.loanApplication.findFirst({
      where: { parthianReferenceId: value.parthianReferenceId },
      include: {
        booking: { include: { request: true } },
        customer: { include: { user: true } },
      },
    });
    if (!loan) {
      throw new AppError('No loan application matches that reference', 404);
    }

    const updatedLoan = await prisma.loanApplication.update({
      where: { id: loan.id },
      data: {
        status: value.status,
        rejectionReason: value.status === 'REJECTED' ? value.rejectionReason || null : loan.rejectionReason,
      },
    });

    if (value.status === 'DISBURSED') {
      await prisma.booking.update({ where: { id: loan.bookingId }, data: { paymentStatus: 'COMPLETED' } });
    } else if (value.status === 'REJECTED') {
      await prisma.booking.update({ where: { id: loan.bookingId }, data: { paymentStatus: 'FAILED' } });
    }

    const customerEmail = loan.customer.user.email;
    const eventType = loan.booking.request.eventType;
    if (value.status === 'APPROVED') {
      await sendEmail({
        to: customerEmail,
        ...loanApprovedEmail({ eventType, monthlyPayment: loan.monthlyPayment, tenorMonths: loan.tenorMonths }),
      });
    } else if (value.status === 'REJECTED') {
      await sendEmail({
        to: customerEmail,
        ...loanRejectedEmail({ eventType, rejectionReason: value.rejectionReason || null }),
      });
    }

    res.json({ loanApplication: updatedLoan });
  } catch (err) {
    next(err);
  }
}
