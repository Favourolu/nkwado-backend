import { Request, Response, NextFunction } from 'express';
import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { rejectVendorSchema } from '../validation/adminValidation';
import { sendEmail } from '../services/emailService';
import { logAdminActivity } from '../services/adminActivityService';

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
