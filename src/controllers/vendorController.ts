import { Request, Response, NextFunction } from 'express';
import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { onboardVendorSchema, submitQuoteSchema } from '../validation/vendorValidation';
import { uploadToS3, uploadManyToS3, getSignedDownloadUrl, getSignedDownloadUrls, UploadableFile } from '../services/s3Service';
import { MAX_TOTAL_UPLOAD_SIZE } from '../middleware/upload';
import { sendEmail } from '../services/emailService';
import { quoteSubmittedEmail } from '../services/emailTemplates';

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

    const totalBytes = [cacFile, ...supportingFiles, ...photoFiles]
      .filter((f): f is Express.Multer.File => !!f)
      .reduce((sum, f) => sum + f.size, 0);
    if (totalBytes > MAX_TOTAL_UPLOAD_SIZE) {
      throw new AppError(
        `Total upload size exceeds the ${MAX_TOTAL_UPLOAD_SIZE / (1024 * 1024)}MB limit`,
        400
      );
    }

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

    const [cacDocument, supportingDocuments, profilePhotos] = await Promise.all([
      getSignedDownloadUrl(vendorData.cacDocument),
      getSignedDownloadUrls(vendorData.supportingDocuments),
      getSignedDownloadUrls(vendorData.profilePhotos),
    ]);

    res.json({
      vendor: { ...vendorData, cacDocument, supportingDocuments, profilePhotos, rating, reviewCount },
    });
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

    const pendingInvitations = await prisma.quote.findMany({
      where: { vendorId: vendor.id, status: 'PENDING' },
      include: { request: true },
      orderBy: { sentAt: 'asc' },
    });

    const inquiries = pendingInvitations.map((invitation) => ({
      requestId: invitation.request.id,
      customerId: invitation.request.customerId,
      eventType: invitation.request.eventType,
      eventDate: invitation.request.eventDate,
      guestCount: invitation.request.guestCount,
      budgetRange: invitation.request.budgetRange,
      specialRequirements: invitation.request.specialRequirements,
      questionnaire: invitation.request.questionnaire,
      createdAt: invitation.request.createdAt,
      deadlineAt: invitation.deadlineAt,
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

    const invitation = await prisma.quote.findUnique({
      where: { requestId_vendorId: { requestId, vendorId: vendor.id } },
    });
    if (!invitation) {
      throw new AppError('No invitation found for this vendor on this request', 404);
    }
    if (invitation.status === 'EXPIRED') {
      throw new AppError('This inquiry has expired', 400);
    }

    const submittedAt = new Date();
    const SUBMITTED_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days for the customer to decide

    const quote = await prisma.quote.update({
      where: { id: invitation.id },
      data: {
        basePrice: value.basePrice,
        itemization: value.itemization || undefined,
        notes: value.notes || undefined,
        status: 'SUBMITTED',
        submittedAt,
        respondedAt: submittedAt,
        submittedExpiresAt: new Date(submittedAt.getTime() + SUBMITTED_EXPIRY_MS),
      },
    });

    if (eventRequest.status === 'MATCHED') {
      await prisma.eventRequest.update({
        where: { id: requestId },
        data: { status: 'QUOTED' },
      });
    }

    const customerEmail = eventRequest.customer.user.email;
    await sendEmail({
      to: customerEmail,
      ...quoteSubmittedEmail({
        businessName: vendor.businessName,
        basePrice: value.basePrice,
        eventType: eventRequest.eventType,
      }),
    });

    res.status(201).json({ quote });
  } catch (err) {
    next(err);
  }
}
