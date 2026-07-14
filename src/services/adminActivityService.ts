import prisma from '../utils/prisma';
import { Prisma } from '@prisma/client';

interface LogActivityInput {
  adminId: string;
  action: string;
  targetType: string;
  targetId: string;
  details?: Record<string, unknown>;
}

export async function logAdminActivity(input: LogActivityInput): Promise<void> {
  await prisma.adminActivity.create({
    data: {
      adminId: input.adminId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      details: input.details as unknown as Prisma.InputJsonValue | undefined,
    },
  });
}
