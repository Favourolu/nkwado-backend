import { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import {
  questionnaireSchema,
  customizeRequestSchema,
  createBookingSchema,
  financingOptionsQuerySchema,
} from '../validation/customerValidation';
import { matchVendorsForRequest, estimateVendorBasePrice, VendorMatch } from '../services/vendorMatchingService';
import { sendEmail } from '../services/emailService';
import { vendorInquiryEmail, bookingConfirmedCustomerEmail, bookingConfirmedVendorEmail } from '../services/emailTemplates';
import { generateBookingBillPdf } from '../services/pdfService';
import { uploadToS3, getSignedDownloadUrl, getSignedDownloadUrls } from '../services/s3Service';
import { createQuoteInvitations } from '../services/quoteInvitationService';
import { getFinancingOptions, resolvePlan, submitToParthian } from '../services/financingService';

const SERVICE_CHARGE_RATE = 0.1;

async function getCustomerOrThrow(userId: string) {
  const customer = await prisma.customer.findUnique({ where: { userId } });
  if (!customer) {
    throw new AppError('Customer profile not found', 404);
  }
  return customer;
}

async function getOwnedRequestOrThrow(requestId: string, customerId: string) {
  const request = await prisma.eventRequest.findUnique({ where: { id: requestId } });
  if (!request || request.customerId !== customerId) {
    throw new AppError('Event request not found', 404);
  }
  return request;
}

export async function submitQuestionnaire(req: Request, res: Response, next: NextFunction) {
  try {
    const { error, value } = questionnaireSchema.validate(req.body);
    if (error) {
      throw new AppError(error.details[0].message, 400);
    }

    const customer = await getCustomerOrThrow(req.user!.userId);

    const eventRequest = await prisma.eventRequest.create({
      data: {
        customerId: customer.id,
        eventType: value.eventType,
        eventDate: value.eventDate || undefined,
        guestCount: value.guestCount || undefined,
        location: value.location || undefined,
        budgetRange: value.budgetRange,
        specialRequirements: value.specialRequirements || undefined,
        questionnaire: value.questionnaire || undefined,
        interestedCategories: value.interestedCategories,
        status: 'PENDING',
      },
    });

    const matches = await matchVendorsForRequest({
      budgetRange: value.budgetRange,
      guestCount: value.guestCount || null,
      location: value.location || null,
      categories: value.interestedCategories,
    });

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const updatedRequest = await prisma.eventRequest.update({
      where: { id: eventRequest.id },
      data: {
        aiMatchedVendors: matches as unknown as Prisma.InputJsonValue,
        status: matches.length > 0 ? 'MATCHED' : 'PENDING',
        expiresAt,
      },
    });

    if (matches.length > 0) {
      await createQuoteInvitations(eventRequest.id, matches.map((m) => m.vendorId));

      const matchedVendors = await prisma.vendor.findMany({
        where: { id: { in: matches.map((m) => m.vendorId) } },
        include: { user: true },
      });

      const inquiryEmail = vendorInquiryEmail({ eventType: value.eventType, deadlineAt: expiresAt });
      await Promise.all(
        matchedVendors.map((vendor) =>
          sendEmail({ to: vendor.user.email, ...inquiryEmail })
        )
      );
    }

    res.status(201).json({ request: { ...updatedRequest, aiMatchedVendors: matches } });
  } catch (err) {
    next(err);
  }
}

export async function listMyRequests(req: Request, res: Response, next: NextFunction) {
  try {
    const customer = await getCustomerOrThrow(req.user!.userId);

    const requests = await prisma.eventRequest.findMany({
      where: { customerId: customer.id },
      orderBy: { createdAt: 'desc' },
    });

    const formatted = requests.map((r) => ({
      id: r.id,
      eventType: r.eventType,
      eventDate: r.eventDate,
      guestCount: r.guestCount,
      location: r.location,
      budgetRange: r.budgetRange,
      specialRequirements: r.specialRequirements,
      status: r.status, // 'PENDING' | 'MATCHED' | 'QUOTED' | 'BOOKED'
      createdAt: r.createdAt,
      aiMatchedVendors: r.aiMatchedVendors,
    }));

    res.json({ requests: formatted });
  } catch (err) {
    next(err);
  }
}

export async function getRequestById(req: Request, res: Response, next: NextFunction) {
  try {
    const requestId = String(req.params.requestId);
    const customer = await getCustomerOrThrow(req.user!.userId);
    const request = await getOwnedRequestOrThrow(requestId, customer.id);

    const quotes = await prisma.quote.findMany({
      where: { requestId },
      include: { vendor: true },
    });

    res.json({ request: { ...request, quotes } });
  } catch (err) {
    next(err);
  }
}

export async function getRequestQuotes(req: Request, res: Response, next: NextFunction) {
  try {
    const requestId = String(req.params.requestId);
    const customer = await getCustomerOrThrow(req.user!.userId);
    await getOwnedRequestOrThrow(requestId, customer.id);

    const quotes = await prisma.quote.findMany({
      where: { requestId },
      include: { vendor: { include: { reviews: true } } },
    });

    const formatted = quotes.map((quote) => {
      const { vendor, ...quoteData } = quote;
      const { reviews, ...vendorData } = vendor;
      const reviewCount = reviews.length;
      const rating = reviewCount > 0 ? reviews.reduce((s, r) => s + r.rating, 0) / reviewCount : null;

      return {
        ...quoteData,
        vendor: {
          businessName: vendorData.businessName,
          category: vendorData.category,
          location: vendorData.location,
          rating,
        },
      };
    });

    res.json({ quotes: formatted });
  } catch (err) {
    next(err);
  }
}

/**
 * Public-facing vendor profile for a customer reviewing a match or quote - the "View
 * details" click-through the matched-vendors/quotes list never had a backend endpoint to
 * call. Only ever returns APPROVED vendors (404 otherwise) so a customer can't probe the
 * vetting status of a PENDING/REJECTED vendor, and never returns cacDocument or
 * rejectionReason - those stay admin-only.
 */
export async function getVendorDetails(req: Request, res: Response, next: NextFunction) {
  try {
    const vendorId = String(req.params.vendorId);

    const vendor = await prisma.vendor.findUnique({
      where: { id: vendorId },
      include: { listings: true, reviews: true },
    });

    if (!vendor || vendor.status !== 'APPROVED') {
      throw new AppError('Vendor not found', 404);
    }

    const reviewCount = vendor.reviews.length;
    const rating = reviewCount > 0 ? vendor.reviews.reduce((sum, r) => sum + r.rating, 0) / reviewCount : null;

    res.json({
      vendor: {
        id: vendor.id,
        businessName: vendor.businessName,
        businessType: vendor.businessType,
        category: vendor.category,
        description: vendor.description,
        location: vendor.location,
        phoneNumber: vendor.phoneNumber,
        priceRange: vendor.priceRange,
        services: vendor.services,
        profilePhotos: await getSignedDownloadUrls(vendor.profilePhotos),
        listings: vendor.listings,
        reviews: vendor.reviews.map((r) => ({ rating: r.rating, comment: r.comment, createdAt: r.createdAt })),
        rating,
        reviewCount,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function customizeRequest(req: Request, res: Response, next: NextFunction) {
  try {
    const requestId = String(req.params.requestId);
    const { error, value } = customizeRequestSchema.validate(req.body);
    if (error) {
      throw new AppError(error.details[0].message, 400);
    }

    const customer = await getCustomerOrThrow(req.user!.userId);
    const eventRequest = await getOwnedRequestOrThrow(requestId, customer.id);

    const selectedVendors = await prisma.vendor.findMany({
      where: { id: { in: value.selectedVendorIds }, status: 'APPROVED' },
      include: { listings: true },
    });

    if (selectedVendors.length !== value.selectedVendorIds.length) {
      throw new AppError('One or more selected vendors are not available', 400);
    }

    const existingMatches =
      (eventRequest.aiMatchedVendors as unknown as VendorMatch[] | null) || [];

    const updatedMatches: VendorMatch[] = selectedVendors.map((vendor) => {
      const existing = existingMatches.find((m) => m.vendorId === vendor.id);
      if (existing) return existing;

      return {
        vendorId: vendor.id,
        category: vendor.category,
        businessName: vendor.businessName,
        basePrice: estimateVendorBasePrice(vendor) ?? 0,
        reason: 'Customer selected',
      };
    });

    await createQuoteInvitations(requestId, selectedVendors.map((v) => v.id));

    const updatedRequest = await prisma.eventRequest.update({
      where: { id: requestId },
      data: {
        aiMatchedVendors: updatedMatches as unknown as Prisma.InputJsonValue,
        customizationNotes: value.notes || undefined,
      },
    });

    res.json({
      request: {
        ...updatedRequest,
        aiMatchedVendors: updatedMatches,
        selectedVendors,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Plan options for financing a given amount (e.g. a booking's totalAmount, computed
 * client-side from the selected quotes before the booking is actually created). Stubbed
 * against Parthian - see financingService.ts.
 */
export async function getBookingFinancingOptions(req: Request, res: Response, next: NextFunction) {
  try {
    const { error, value } = financingOptionsQuerySchema.validate(req.query);
    if (error) {
      throw new AppError(error.details[0].message, 400);
    }

    res.json({ options: getFinancingOptions(value.amount) });
  } catch (err) {
    next(err);
  }
}

export async function createBooking(req: Request, res: Response, next: NextFunction) {
  try {
    const requestId = String(req.params.requestId);
    const { error, value } = createBookingSchema.validate(req.body);
    if (error) {
      throw new AppError(error.details[0].message, 400);
    }

    const customer = await getCustomerOrThrow(req.user!.userId);
    const eventRequest = await getOwnedRequestOrThrow(requestId, customer.id);

    const quotes = await prisma.quote.findMany({
      where: { id: { in: value.selectedQuoteIds }, requestId, status: 'SUBMITTED', bookingId: null },
      include: { vendor: { include: { user: true } } },
    });

    if (quotes.length !== value.selectedQuoteIds.length) {
      throw new AppError('One or more selected quotes are invalid, not yet submitted, or already booked', 400);
    }

    // status: 'SUBMITTED' guarantees basePrice was set when the vendor responded.
    const pricedQuotes = quotes.map((q) => {
      if (q.basePrice === null) {
        throw new AppError(`Quote ${q.id} is missing a price`, 500);
      }
      return { ...q, basePrice: q.basePrice };
    });

    const subtotal = pricedQuotes.reduce((sum, q) => sum + q.basePrice, 0);
    const serviceCharge = Math.round(subtotal * SERVICE_CHARGE_RATE * 100) / 100;
    const totalAmount = subtotal + serviceCharge;
    const selectedVendorIds = Array.from(new Set(pricedQuotes.map((q) => q.vendorId)));

    // Never trust a client-supplied monthlyPayment/totalRepayable - only the chosen planId.
    // Recomputed here, before the transaction, so an invalid planId 400s before any writes.
    const financingPlan =
      value.paymentMethod === 'FINANCED' ? resolvePlan(totalAmount, value.planId) : null;
    if (value.paymentMethod === 'FINANCED' && !financingPlan) {
      throw new AppError('Unknown financing plan', 400);
    }

    // Everything below runs in one transaction so the quote-accept step is atomic with
    // booking creation: the conditional updateMany only flips rows that are still
    // SUBMITTED and unbooked, and if a concurrent request already grabbed one of them
    // (or the deadline cron expired it mid-flight), the count check throws and the whole
    // transaction rolls back instead of silently double-booking a vendor.
    const booking = await prisma.$transaction(async (tx) => {
      const createdBooking = await tx.booking.create({
        data: {
          customerId: customer.id,
          requestId,
          selectedVendors: { connect: selectedVendorIds.map((id) => ({ id })) },
          subtotal,
          serviceCharge,
          totalAmount,
          status: 'CONFIRMED',
          paymentMethod: value.paymentMethod,
          // FULL_PAYMENT leaves this null (payment capture itself isn't built yet - see
          // CLAUDE.md note 10); FINANCED gets an explicit PENDING so admin/customer views
          // show something meaningful instead of a blank field while Parthian decides.
          paymentStatus: value.paymentMethod === 'FINANCED' ? 'PENDING' : undefined,
        },
      });

      const accepted = await tx.quote.updateMany({
        where: { id: { in: value.selectedQuoteIds }, status: 'SUBMITTED', bookingId: null },
        data: { status: 'ACCEPTED', bookingId: createdBooking.id, version: { increment: 1 } },
      });

      if (accepted.count !== value.selectedQuoteIds.length) {
        throw new AppError(
          'One or more selected quotes were booked or expired by another request — please refresh and try again',
          409
        );
      }

      await tx.eventRequest.update({ where: { id: requestId }, data: { status: 'BOOKED' } });

      // Financing decision is Parthian's, made asynchronously via POST /webhooks/parthian
      // once wired for real - this row starts (and stays, until that webhook fires)
      // PENDING_REVIEW regardless of what the stub submission below returns.
      if (financingPlan) {
        await tx.loanApplication.create({
          data: {
            bookingId: createdBooking.id,
            customerId: customer.id,
            principalAmount: totalAmount,
            planId: financingPlan.planId,
            tenorMonths: financingPlan.tenorMonths,
            monthlyPayment: financingPlan.monthlyPayment,
            totalRepayable: financingPlan.totalRepayable,
          },
        });
      }

      return createdBooking;
    });

    if (financingPlan) {
      // Outbound call happens after commit, same reasoning as the S3 upload below - an
      // external call mid-transaction can't be rolled back if it succeeds but the
      // surrounding transaction later fails.
      try {
        const { parthianReferenceId } = await submitToParthian();
        await prisma.loanApplication.update({
          where: { bookingId: booking.id },
          data: { parthianReferenceId },
        });
      } catch (err) {
        console.error(`[createBooking] failed to submit loan application for booking ${booking.id} to Parthian:`, err);
      }
    }

    const pdfBuffer = generateBookingBillPdf({
      bookingId: booking.id,
      eventType: eventRequest.eventType,
      eventDate: eventRequest.eventDate,
      guestCount: eventRequest.guestCount,
      location: eventRequest.location,
      vendors: pricedQuotes.map((q) => ({
        businessName: q.vendor.businessName,
        category: q.vendor.category,
        basePrice: q.basePrice,
      })),
      subtotal,
      serviceCharge,
      totalAmount,
      createdAt: booking.createdAt,
    });

    const billPdfKey = await uploadToS3(
      { buffer: pdfBuffer, originalname: `booking-${booking.id}.pdf`, mimetype: 'application/pdf' },
      'bills'
    );

    // billPdfKey now lives in S3 whether or not the following DB write succeeds. A few
    // retries here narrows (doesn't eliminate) the orphaned-PDF window from the audit —
    // a transient DB blip no longer means the link is lost after one attempt.
    let finalBooking = null;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= 3 && !finalBooking; attempt++) {
      try {
        finalBooking = await prisma.booking.update({
          where: { id: booking.id },
          data: { billPdfUrl: billPdfKey, billGeneratedAt: new Date() },
        });
      } catch (err) {
        lastErr = err;
        if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 500));
      }
    }
    if (!finalBooking) {
      console.error(`[createBooking] failed to persist billPdfUrl for booking ${booking.id} after retries:`, lastErr);
      throw new AppError('Booking was created but the bill could not be saved — contact support', 500);
    }

    const billPdfUrl = await getSignedDownloadUrl(billPdfKey);
    const customerUser = await prisma.user.findUnique({ where: { id: req.user!.userId } });

    const vendorBookingEmail = bookingConfirmedVendorEmail({
      bookingId: booking.id,
      eventType: eventRequest.eventType,
    });

    await Promise.all([
      customerUser
        ? sendEmail({
            to: customerUser.email,
            ...bookingConfirmedCustomerEmail({
              bookingId: booking.id,
              eventType: eventRequest.eventType,
              subtotal,
              serviceCharge,
              totalAmount,
              billPdfUrl: billPdfUrl || '',
            }),
          })
        : Promise.resolve(),
      ...pricedQuotes.map((q) => sendEmail({ to: q.vendor.user.email, ...vendorBookingEmail })),
    ]);

    const loanApplication = financingPlan
      ? await prisma.loanApplication.findUnique({ where: { bookingId: booking.id } })
      : null;

    res.status(201).json({ booking: { ...finalBooking, billPdfUrl }, loanApplication });
  } catch (err) {
    next(err);
  }
}

export async function listBookings(req: Request, res: Response, next: NextFunction) {
  try {
    const customer = await getCustomerOrThrow(req.user!.userId);

    const bookings = await prisma.booking.findMany({
      where: { customerId: customer.id },
      include: { request: true, selectedVendors: true },
      orderBy: { createdAt: 'desc' },
    });

    const formatted = await Promise.all(
      bookings.map(async (booking) => ({
        id: booking.id,
        eventType: booking.request.eventType,
        eventDate: booking.request.eventDate,
        totalAmount: booking.totalAmount,
        status: booking.status,
        selectedVendors: booking.selectedVendors,
        billPdfUrl: await getSignedDownloadUrl(booking.billPdfUrl),
        createdAt: booking.createdAt,
      }))
    );

    res.json({ bookings: formatted });
  } catch (err) {
    next(err);
  }
}

export async function listMyLoans(req: Request, res: Response, next: NextFunction) {
  try {
    const customer = await getCustomerOrThrow(req.user!.userId);

    const loans = await prisma.loanApplication.findMany({
      where: { customerId: customer.id },
      include: { booking: { include: { request: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const formatted = loans.map((loan) => ({
      id: loan.id,
      bookingId: loan.bookingId,
      eventType: loan.booking.request.eventType,
      principalAmount: loan.principalAmount,
      planId: loan.planId,
      tenorMonths: loan.tenorMonths,
      monthlyPayment: loan.monthlyPayment,
      totalRepayable: loan.totalRepayable,
      status: loan.status,
      rejectionReason: loan.rejectionReason,
      createdAt: loan.createdAt,
    }));

    res.json({ loans: formatted });
  } catch (err) {
    next(err);
  }
}

const PROGRESS_STAGE_SLUGS = ['questionnaire', 'vendor_matching', 'select_vendors', 'booking', 'payment'] as const;

export async function getProgress(req: Request, res: Response, next: NextFunction) {
  try {
    const requestId = String(req.params.requestId);
    const customer = await getCustomerOrThrow(req.user!.userId);
    const eventRequest = await getOwnedRequestOrThrow(requestId, customer.id);

    const quotes = await prisma.quote.findMany({ where: { requestId } });
    const booking = await prisma.booking.findFirst({ where: { requestId } });

    const matches = (eventRequest.aiMatchedVendors as unknown as VendorMatch[] | null) || [];
    const hasMatches = matches.length > 0;
    // expiresAt is set to matchedAt + 24h at match time (see submitQuestionnaire), so this
    // recovers the match timestamp without a dedicated column.
    const matchedAt = hasMatches && eventRequest.expiresAt
      ? new Date(eventRequest.expiresAt.getTime() - 24 * 60 * 60 * 1000)
      : null;

    const submittedQuotes = quotes.filter((q) => q.submittedAt !== null);
    const hasSubmittedQuotes = submittedQuotes.length > 0;
    const firstQuoteAt = submittedQuotes.reduce<Date | null>(
      (earliest, q) => (!earliest || (q.submittedAt as Date) < earliest ? (q.submittedAt as Date) : earliest),
      null
    );

    const bookingConfirmed = !!booking && ['CONFIRMED', 'PAID', 'COMPLETED'].includes(booking.status);
    // Booking.status never actually transitions to PAID/COMPLETED anywhere in this codebase -
    // the real payment-completion signal is paymentStatus, set to COMPLETED by the Parthian
    // loan webhook on disbursement. Checking status alone here would mean a financed booking's
    // "Complete payment" step could never show as done, even after real disbursement.
    const paymentCompleted =
      !!booking && (booking.paymentStatus === 'COMPLETED' || ['PAID', 'COMPLETED'].includes(booking.status));

    const steps = [
      { name: 'Tell us about your event', status: 'completed', date: eventRequest.createdAt },
      {
        name: "We're matching vendors",
        status: hasMatches ? 'completed' : 'in_progress',
        date: hasMatches ? matchedAt : null,
      },
      {
        name: 'Review vendor quotes',
        status: bookingConfirmed ? 'completed' : hasSubmittedQuotes ? 'in_progress' : 'pending',
        date: hasSubmittedQuotes ? firstQuoteAt : null,
      },
      {
        name: 'Confirm your booking',
        status: bookingConfirmed ? 'completed' : 'pending',
        date: bookingConfirmed ? booking!.createdAt : null,
      },
      {
        name: 'Complete payment',
        status: paymentCompleted ? 'completed' : 'pending',
        date: paymentCompleted ? booking!.updatedAt : null,
      },
    ];

    const completed = PROGRESS_STAGE_SLUGS.filter((_, i) => steps[i].status === 'completed');
    const pending = PROGRESS_STAGE_SLUGS.filter((_, i) => steps[i].status !== 'completed');

    let stage: string;
    if (paymentCompleted) stage = 'completed';
    else if (bookingConfirmed) stage = 'payment_pending';
    else if (hasSubmittedQuotes) stage = 'quotes_received';
    else if (hasMatches) stage = 'awaiting_quotes';
    else stage = 'questionnaire';

    res.json({ progress: { stage, completed, pending, steps } });
  } catch (err) {
    next(err);
  }
}
