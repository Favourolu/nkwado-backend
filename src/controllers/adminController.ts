import { Request, Response, NextFunction } from 'express';
import { BookingStatus } from '@prisma/client';
import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import {
  rejectVendorSchema,
  listRequestsQuerySchema,
  listBookingsQuerySchema,
} from '../validation/adminValidation';
import { sendEmail } from '../services/emailService';
import { logAdminActivity } from '../services/adminActivityService';

const REVENUE_COUNTED_STATUSES: BookingStatus[] = ['CONFIRMED', 'PAID', 'COMPLETED'];

export async function getPendingVendors(req: Request, res: Response, next: NextFunction) {
  try {
    const vendors = await prisma.vendor.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
    });

    res.json({ vendors });
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
      subject: 'Your Nkwado vendor application has been approved',
      html: `<p>Congratulations! ${vendor.businessName} is now an approved vendor on Nkwado.</p>`,
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
      subject: 'Update on your Nkwado vendor application',
      html: `<p>Your application for ${vendor.businessName} was not approved. Reason: ${value.rejectionReason}</p>`,
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

    const formatted = bookings.map((booking) => ({
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
      createdAt: booking.createdAt,
    }));

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
      prisma.eventRequest.count({ where: { status: { in: ['pending', 'matched', 'quoted'] } } }),
      prisma.booking.count({ where: { status: 'COMPLETED' } }),
      prisma.booking.findMany({
        where: { status: { in: REVENUE_COUNTED_STATUSES } },
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
