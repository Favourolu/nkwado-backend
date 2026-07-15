import { Request, Response, NextFunction } from 'express';
import { BookingStatus } from '@prisma/client';
import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import {
  rejectVendorSchema,
  listRequestsQuerySchema,
  listBookingsQuerySchema,
  pendingVendorsQuerySchema,
} from '../validation/adminValidation';
import { sendEmail } from '../services/emailService';
import { vendorApprovedEmail, vendorRejectedEmail } from '../services/emailTemplates';
import { logAdminActivity } from '../services/adminActivityService';
import { getSignedDownloadUrl, getSignedDownloadUrls } from '../services/s3Service';

const REVENUE_COUNTED_STATUSES: BookingStatus[] = ['CONFIRMED', 'PAID', 'COMPLETED'];

export async function getPendingVendors(req: Request, res: Response, next: NextFunction) {
  try {
    const { error, value } = pendingVendorsQuerySchema.validate(req.query);
    if (error) {
      throw new AppError(error.details[0].message, 400);
    }

    const [total, vendors] = await Promise.all([
      prisma.vendor.count({ where: { status: 'PENDING' } }),
      prisma.vendor.findMany({
        where: { status: 'PENDING' },
        orderBy: { createdAt: 'asc' }, // oldest-waiting first, surfaced explicitly via waitingDays below
        take: value.limit,
        skip: value.offset,
      }),
    ]);

    const now = Date.now();
    const withDocs = await Promise.all(
      vendors.map(async (vendor) => {
        const [cacDocument, supportingDocuments, profilePhotos] = await Promise.all([
          getSignedDownloadUrl(vendor.cacDocument),
          getSignedDownloadUrls(vendor.supportingDocuments),
          getSignedDownloadUrls(vendor.profilePhotos),
        ]);
        const waitingDays = Math.floor((now - vendor.createdAt.getTime()) / (24 * 60 * 60 * 1000));
        return { ...vendor, cacDocument, supportingDocuments, profilePhotos, waitingDays };
      })
    );

    res.json({
      vendors: withDocs,
      pagination: { total, limit: value.limit, offset: value.offset, hasMore: value.offset + vendors.length < total },
    });
  } catch (err) {
    next(err);
  }
}

async function getVendorOrThrow(vendorId: string) {
  const vendor = await prisma.vendor.findUnique({
    where: { id: vendorId },
    include: { user: true },
  });
  if (!vendor) {
    throw new AppError('Vendor not found', 404);
  }
  return vendor;
}

export async function approveVendor(req: Request, res: Response, next: NextFunction) {
  try {
    const vendorId = String(req.params.vendorId);
    const vendor = await getVendorOrThrow(vendorId);

    const updated = await prisma.vendor.update({
      where: { id: vendorId },
      data: { status: 'APPROVED', verifiedAt: new Date(), rejectionReason: null },
    });

    await sendEmail({
      to: vendor.user.email,
      ...vendorApprovedEmail({ businessName: vendor.businessName }),
    });

    await logAdminActivity({
      adminId: req.user!.userId,
      action: 'vendor_approved',
      targetType: 'vendor',
      targetId: vendorId,
    });

    res.json({ vendor: updated });
  } catch (err) {
    next(err);
  }
}

export async function rejectVendor(req: Request, res: Response, next: NextFunction) {
  try {
    const vendorId = String(req.params.vendorId);
    const { error, value } = rejectVendorSchema.validate(req.body);
    if (error) {
      throw new AppError(error.details[0].message, 400);
    }

    const vendor = await getVendorOrThrow(vendorId);

    const updated = await prisma.vendor.update({
      where: { id: vendorId },
      data: { status: 'REJECTED', rejectionReason: value.rejectionReason },
    });

    await sendEmail({
      to: vendor.user.email,
      ...vendorRejectedEmail({ businessName: vendor.businessName, rejectionReason: value.rejectionReason }),
    });

    await logAdminActivity({
      adminId: req.user!.userId,
      action: 'vendor_rejected',
      targetType: 'vendor',
      targetId: vendorId,
      details: { rejectionReason: value.rejectionReason },
    });

    res.json({ vendor: updated });
  } catch (err) {
    next(err);
  }
}

export async function listRequests(req: Request, res: Response, next: NextFunction) {
  try {
    const { error, value } = listRequestsQuerySchema.validate(req.query);
    if (error) {
      throw new AppError(error.details[0].message, 400);
    }

    const requests = await prisma.eventRequest.findMany({
      where: {
        ...(value.status ? { status: value.status } : {}),
        ...(value.eventType ? { eventType: value.eventType } : {}),
      },
      include: {
        customer: { include: { user: true } },
        bookings: { select: { status: true } },
        _count: { select: { quotes: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const formatted = requests.map((request) => ({
      id: request.id,
      customerId: request.customerId,
      customer: {
        firstName: request.customer.user.firstName,
        lastName: request.customer.user.lastName,
      },
      eventType: request.eventType,
      eventDate: request.eventDate,
      budgetRange: request.budgetRange,
      status: request.status,
      quoteCount: request._count.quotes,
      bookingStatus: request.bookings[0]?.status ?? null,
      createdAt: request.createdAt,
    }));

    res.json({ requests: formatted });
  } catch (err) {
    next(err);
  }
}

export async function listBookings(req: Request, res: Response, next: NextFunction) {
  try {
    const { error, value } = listBookingsQuerySchema.validate(req.query);
    if (error) {
      throw new AppError(error.details[0].message, 400);
    }

    const bookings = await prisma.booking.findMany({
      where: {
        ...(value.status ? { status: value.status } : {}),
        ...(value.startDate ? { createdAt: { gte: value.startDate } } : {}),
      },
      include: {
        customer: { include: { user: true } },
        request: true,
        selectedVendors: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const formatted = await Promise.all(
      bookings.map(async (booking) => ({
        id: booking.id,
        customer: {
          firstName: booking.customer.user.firstName,
          lastName: booking.customer.user.lastName,
          email: booking.customer.user.email,
        },
        eventType: booking.request.eventType,
        eventDate: booking.request.eventDate,
        selectedVendors: booking.selectedVendors,
        subtotal: booking.subtotal,
        serviceCharge: booking.serviceCharge,
        totalAmount: booking.totalAmount,
        status: booking.status,
        paymentStatus: booking.paymentStatus,
        billPdfUrl: await getSignedDownloadUrl(booking.billPdfUrl),
        createdAt: booking.createdAt,
      }))
    );

    res.json({ bookings: formatted });
  } catch (err) {
    next(err);
  }
}

export async function getDashboardMetrics(req: Request, res: Response, next: NextFunction) {
  try {
    const [
      totalVendors,
      pendingVendors,
      approvedVendors,
      totalCustomers,
      activeRequests,
      completedBookings,
      revenueBookings,
    ] = await Promise.all([
      prisma.vendor.count(),
      prisma.vendor.count({ where: { status: 'PENDING' } }),
      prisma.vendor.count({ where: { status: 'APPROVED' } }),
      prisma.customer.count(),
      prisma.eventRequest.count({ where: { status: { in: ['PENDING', 'MATCHED', 'QUOTED'] } } }),
      prisma.booking.count({ where: { status: 'COMPLETED' } }),
      // OR'd on paymentStatus too - a FINANCED booking settles via paymentStatus: COMPLETED
      // (set by the Parthian webhook on disbursement) without Booking.status ever moving off
      // CONFIRMED, so status alone would silently exclude every financed booking's revenue.
      prisma.booking.findMany({
        where: { OR: [{ status: { in: REVENUE_COUNTED_STATUSES } }, { paymentStatus: 'COMPLETED' }] },
        select: { totalAmount: true },
      }),
    ]);

    const totalRevenue = revenueBookings.reduce((sum, b) => sum + b.totalAmount, 0);
    const averageEventValue = revenueBookings.length > 0 ? totalRevenue / revenueBookings.length : 0;

    res.json({
      metrics: {
        totalVendors,
        pendingVendors,
        approvedVendors,
        totalCustomers,
        activeRequests,
        completedBookings,
        totalRevenue,
        averageEventValue,
      },
    });
  } catch (err) {
    next(err);
  }
}

// The cron itself firing on schedule is what proves it's alive - if it's genuinely dead,
// no tick ever writes a fresh heartbeat, so a stale timestamp here (rather than any
// push-based alert, out of scope for this MVP) is the detection signal.
const HEARTBEAT_STALE_AFTER_MS = 15 * 60 * 1000; // 3x the default 5-minute cron cadence

export async function getCronHealth(req: Request, res: Response, next: NextFunction) {
  try {
    const heartbeats = await prisma.cronHeartbeat.findMany();
    const now = Date.now();

    const jobs = heartbeats.map((h) => ({
      name: h.name,
      lastRunAt: h.lastRunAt,
      lastRunOk: h.lastRunOk,
      lastError: h.lastError,
      stale: now - h.lastRunAt.getTime() > HEARTBEAT_STALE_AFTER_MS,
    }));

    const healthy = jobs.length > 0 && jobs.every((j) => j.lastRunOk && !j.stale);

    res.status(healthy ? 200 : 503).json({ healthy, jobs });
  } catch (err) {
    next(err);
  }
}

export async function getEmailFailures(req: Request, res: Response, next: NextFunction) {
  try {
    const failures = await prisma.emailFailure.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({ failures });
  } catch (err) {
    next(err);
  }
}

export async function listLoans(req: Request, res: Response, next: NextFunction) {
  try {
    const loans = await prisma.loanApplication.findMany({
      include: { customer: { include: { user: true } }, booking: { include: { request: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    const formatted = loans.map((loan) => ({
      id: loan.id,
      bookingId: loan.bookingId,
      customer: {
        firstName: loan.customer.user.firstName,
        lastName: loan.customer.user.lastName,
        email: loan.customer.user.email,
      },
      eventType: loan.booking.request.eventType,
      principalAmount: loan.principalAmount,
      planId: loan.planId,
      tenorMonths: loan.tenorMonths,
      monthlyPayment: loan.monthlyPayment,
      totalRepayable: loan.totalRepayable,
      status: loan.status,
      parthianReferenceId: loan.parthianReferenceId,
      rejectionReason: loan.rejectionReason,
      createdAt: loan.createdAt,
    }));

    res.json({ loans: formatted });
  } catch (err) {
    next(err);
  }
}

export async function getActivityLog(req: Request, res: Response, next: NextFunction) {
  try {
    const activity = await prisma.adminActivity.findMany({
      include: { admin: { select: { firstName: true, lastName: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    res.json({ activity });
  } catch (err) {
    next(err);
  }
}
