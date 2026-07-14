import { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import {
  questionnaireSchema,
  customizeRequestSchema,
  createBookingSchema,
} from '../validation/customerValidation';
import { matchVendorsForRequest, estimateVendorBasePrice, VendorMatch } from '../services/vendorMatchingService';
import { sendEmail } from '../services/emailService';
import { generateBookingBillPdf } from '../services/pdfService';
import { uploadToS3 } from '../services/s3Service';

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
        status: 'pending',
      },
    });

    const matches = await matchVendorsForRequest({
      budgetRange: value.budgetRange,
      guestCount: value.guestCount || null,
      location: value.location || null,
    });

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const updatedRequest = await prisma.eventRequest.update({
      where: { id: eventRequest.id },
      data: {
        aiMatchedVendors: matches as unknown as Prisma.InputJsonValue,
        status: matches.length > 0 ? 'matched' : 'pending',
        expiresAt,
      },
    });

    if (matches.length > 0) {
      const matchedVendors = await prisma.vendor.findMany({
        where: { id: { in: matches.map((m) => m.vendorId) } },
        include: { user: true },
      });

      await Promise.all(
        matchedVendors.map((vendor) =>
          sendEmail({
            to: vendor.user.email,
            subject: `New event inquiry: ${value.eventType}`,
            html: `<p>You've been matched to a new ${value.eventType.toLowerCase()} event request. Respond within 24 hours.</p>`,
          })
        )
      );
    }

    res.status(201).json({ request: { ...updatedRequest, aiMatchedVendors: matches } });
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
      where: { id: { in: value.selectedQuoteIds }, requestId },
      include: { vendor: { include: { user: true } } },
    });

    if (quotes.length !== value.selectedQuoteIds.length) {
      throw new AppError('One or more selected quotes are invalid for this request', 400);
    }

    const subtotal = quotes.reduce((sum, q) => sum + q.basePrice, 0);
    const serviceCharge = Math.round(subtotal * SERVICE_CHARGE_RATE * 100) / 100;
    const totalAmount = subtotal + serviceCharge;
    const selectedVendorIds = Array.from(new Set(quotes.map((q) => q.vendorId)));

    const booking = await prisma.booking.create({
      data: {
        customerId: customer.id,
        requestId,
        selectedQuoteIds: value.selectedQuoteIds,
        selectedVendorIds,
        selectedVendors: { connect: selectedVendorIds.map((id) => ({ id })) },
        subtotal,
        serviceCharge,
        totalAmount,
        status: 'CONFIRMED',
      },
    });

    await Promise.all([
      prisma.quote.updateMany({
        where: { id: { in: value.selectedQuoteIds } },
        data: { status: 'ACCEPTED' },
      }),
      prisma.eventRequest.update({ where: { id: requestId }, data: { status: 'booked' } }),
    ]);

    const pdfBuffer = generateBookingBillPdf({
      bookingId: booking.id,
      eventType: eventRequest.eventType,
      eventDate: eventRequest.eventDate,
      guestCount: eventRequest.guestCount,
      location: eventRequest.location,
      vendors: quotes.map((q) => ({
        businessName: q.vendor.businessName,
        category: q.vendor.category,
        basePrice: q.basePrice,
      })),
      subtotal,
      serviceCharge,
      totalAmount,
      createdAt: booking.createdAt,
    });

    const billPdfUrl = await uploadToS3(
      { buffer: pdfBuffer, originalname: `booking-${booking.id}.pdf`, mimetype: 'application/pdf' },
      'bills'
    );

    const finalBooking = await prisma.booking.update({
      where: { id: booking.id },
      data: { billPdfUrl, billGeneratedAt: new Date() },
    });

    const customerUser = await prisma.user.findUnique({ where: { id: req.user!.userId } });

    await Promise.all([
      customerUser
        ? sendEmail({
            to: customerUser.email,
            subject: 'Your Nkwado booking is confirmed',
            html: `<p>Your booking (${booking.id}) is confirmed. Total: NGN ${totalAmount.toLocaleString()}.</p>`,
          })
        : Promise.resolve(),
      ...quotes.map((q) =>
        sendEmail({
          to: q.vendor.user.email,
          subject: 'Booking confirmed',
          html: `<p>Your quote for booking ${booking.id} has been accepted.</p>`,
        })
      ),
    ]);

    res.status(201).json({ booking: finalBooking });
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

    const formatted = bookings.map((booking) => ({
      id: booking.id,
      eventType: booking.request.eventType,
      eventDate: booking.request.eventDate,
      totalAmount: booking.totalAmount,
      status: booking.status,
      selectedVendors: booking.selectedVendors,
      billPdfUrl: booking.billPdfUrl,
      createdAt: booking.createdAt,
    }));

    res.json({ bookings: formatted });
  } catch (err) {
    next(err);
  }
}
