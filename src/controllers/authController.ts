import { Request, Response, NextFunction } from 'express';
import prisma from '../utils/prisma';
import { hashPassword, comparePassword } from '../utils/password';
import { signToken } from '../utils/jwt';
import { registerSchema, loginSchema } from '../validation/authValidation';
import { AppError } from '../middleware/errorHandler';

export async function register(req: Request, res: Response, next: NextFunction) {
  try {
    const { error, value } = registerSchema.validate(req.body);
    if (error) {
      throw new AppError(error.details[0].message, 400);
    }

    const { email, password, firstName, lastName, phone, role } = value;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new AppError('An account with this email already exists', 409);
    }

    const hashedPassword = await hashPassword(password);

    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        firstName,
        lastName,
        phone: phone || undefined,
        role,
        ...(role === 'CUSTOMER' ? { customer: { create: {} } } : {}),
      },
    });

    const token = signToken({ userId: user.id, email: user.email, role: user.role, tokenVersion: user.tokenVersion });

    res.status(201).json({
      token,
      user: { id: user.id, email: user.email, role: user.role },
    });
  } catch (err) {
    next(err);
  }
}

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const { error, value } = loginSchema.validate(req.body);
    if (error) {
      throw new AppError(error.details[0].message, 400);
    }

    const { email, password } = value;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new AppError('Invalid email or password', 401);
    }

    const isValid = await comparePassword(password, user.password);
    if (!isValid) {
      throw new AppError('Invalid email or password', 401);
    }

    const token = signToken({ userId: user.id, email: user.email, role: user.role, tokenVersion: user.tokenVersion });

    res.status(200).json({
      token,
      user: { id: user.id, email: user.email, role: user.role },
    });
  } catch (err) {
    next(err);
  }
}

/** Bumps the user's tokenVersion, immediately invalidating every previously-issued JWT
 *  (there's no separate session store to delete from — this is the revocation mechanism). */
export async function logoutAll(req: Request, res: Response, next: NextFunction) {
  try {
    await prisma.user.update({
      where: { id: req.user!.userId },
      data: { tokenVersion: { increment: 1 } },
    });
    res.json({ message: 'Logged out of all sessions' });
  } catch (err) {
    next(err);
  }
}
