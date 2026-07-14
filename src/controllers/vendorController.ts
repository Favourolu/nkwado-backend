import { Request, Response, NextFunction } from 'express';
import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { onboardVendorSchema, submitQuoteSchema } from '../validation/vendorValidation';
import { uploadToS3, uploadManyToS3, UploadableFile } from '../services/s3Service';
import { sendEmail } from '../services/emailService';

type MulterFiles = { [fieldname: string]: Express.Multer.File[] };

function parseServices(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string' && raw.trim().length > 0) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // not JSON - fall back to comma-separated
      return raw.split(',').map((s) => s.trim()).filter(Boolean);
    }
  }
  return [];
}

export async function onboardVendor(req: Request, res: Response, next: NextFunction) {
  try {
    const body = { ...req.body, services: parseServices(req.body.services) };
    const { error, value } = onboardVendorSchema.validate(body);
    if (error) {
      throw new AppError(error.details[0].message, 400);
    }

    const files = (req.files || {}) as MulterFiles;
    const cacFile = files.cacDocument?.[0];
    const supportingFiles = files.supportingDocuments || [];
    const photoFiles = files.profilePhotos || [];

    const [cacDocument, supportingDocuments, profilePhotos] = await Promise.all([
      cacFile ? uploadToS3(cacFile as UploadableFile, 'cac-documents') : Promise.resolve(undefined),
      uploadManyToS3(supportingFiles as UploadableFile[], 'supporting-documents'),
      uploadManyToS3(photoFiles as UploadableFile[], 'profile-photos'),
    ]);

    const userId = req.user!.userId;

    const vendor = await prisma.vendor.upsert({
      where: { userId },
      create: {
        userId,
        businessName: value.businessName,
        businessType: value.businessType || undefined,
        category: value.category,
        description: value.description || undefined,
        location: value.location || undefined,
        phoneNumber: value.phoneNumber || undefined,
        priceRange: value.priceRange || undefined,
        services: value.services,
        cacDocument,
        supportingDocuments,
        profilePhotos,
      },
      update: {
        businessName: value.businessName,
        businessType: value.businessType || undefined,
        category: value.category,
        description: value.description || undefined,
        location: value.location || undefined,
        phoneNumber: value.phoneNumber || undefined,
        priceRange: value.priceRange || undefined,
        services: value.services,
        ...(cacDocument ? { cacDocument } : {}),
        ...(supportingDocuments.length ? { supportingDocuments } : {}),
        ...(profilePhotos.length ? { profilePhotos } : {}),
        status: 'PENDING',
      },
    });

    res.status(201).json({ vendor });
  } catch (err) {
    next(err);
  }
}

export async function getVendorProfile(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;

    const vendor = await prisma.vendor.findUnique({
      where: { userId },
      include: { listings: true, reviews: true },
    });

    if (!vendor) {
      throw new AppError('Vendor profile not found', 404);
    }

    const reviewCount = vendor.reviews.length;
    const rating =
      reviewCount > 0
        ? vendor.reviews.reduce((sum, r) => sum + r.rating, 0) / reviewCount
        : null;

    const { reviews, ...vendorData } = vendor;

    res.json({ vendor: { ...vendorData, rating, reviewCount } });
  } catch (err) {
    next(err);
  }
}

export async function getVendorInquiries(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;

    const vendor = await prisma.vendor.findUnique({ where: { userId } });
    if (!vendor) {
      throw new AppError('Vendor profile not found', 404);
    }

    const candidateRequests = await prisma.eventRequest.findMany({
      where: { status: { in: ['matched', 'quoted'] } },
      include: { customer: { include: { user: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const inquiries = candidateRequests
      .filter((request) => {
        const matched = (request.aiMatchedVendors as Array<{ vendorId: string }> | null) || [];
        return matched.some((m) => m.vendorId === vendor.id);
      })
      .map((request) => ({
        requestId: request.id,
        customerId: request.customerId,
        eventType: request.eventType,
        eventDate: request.eventDate,
        guestCount: request.guestCount,
        budgetRange: request.budgetRange,
        specialRequirements: request.specialRequirements,
        questionnaire: request.questionnaire,
        createdAt: request.createdAt,
        deadlineAt: request.expiresAt,
      }));

    res.json({ inquiries });
  } catch (err) {
    next(err);
  }
}

export async function submitQuote(req: Request, res: Response, next: NextFunction) {
  try {
    const requestId = String(req.params.requestId);
    const { error, value } = submitQuoteSchema.validate(req.body);
    if (error) {
      throw new AppError(error.details[0].message, 400);
    }

    const userId = req.user!.userId;
    const vendor = await prisma.vendor.findUnique({ where: { userId } });
    if (!vendor) {
      throw new AppError('Vendor profile not found', 404);
    }

    const eventRequest = await prisma.eventRequest.findUnique({
      where: { id: requestId },
      include: { customer: { include: { user: true } } },
    });
    if (!eventRequest) {
      throw new AppError('Event request not found', 404);
    }

    const sentAt = new Date();
    const deadlineAt = new Date(sentAt.getTime() + 24 * 60 * 60 * 1000);

    const quote = await prisma.quote.create({
      data: {
        requestId,
        vendorId: vendor.id,
        basePrice: value.basePrice,
        itemization: value.itemization || undefined,
        notes: value.notes || undefined,
        status: 'SUBMITTED',
        sentAt,
        submittedAt: sentAt,
        respondedAt: sentAt,
        deadlineAt,
      },
    });

    if (eventRequest.status === 'matched') {
      await prisma.eventRequest.update({
        where: { id: requestId },
        data: { status: 'quoted' },
      });
    }

    const customerEmail = eventRequest.customer.user.email;
    await sendEmail({
      to: customerEmail,
      subject: `New quote from ${vendor.businessName}`,
      html: `<p>${vendor.businessName} submitted a quote of ₦${value.basePrice.toLocaleString()} for your ${eventRequest.eventType.toLowerCase()} event.</p>`,
    });

    res.status(201).json({ quote });
  } catch (err) {
    next(err);
  }
}
