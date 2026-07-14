import { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { questionnaireSchema } from '../validation/customerValidation';
import { matchVendorsForRequest } from '../services/vendorMatchingService';
import { sendEmail } from '../services/emailService';

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
