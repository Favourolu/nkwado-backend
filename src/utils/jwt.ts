import jwt, { SignOptions } from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET as string;
const JWT_EXPIRES_IN = (process.env.JWT_EXPIRES_IN || '7d') as SignOptions['expiresIn'];

export interface JwtPayload {
  userId: string;
  email: string;
  role: string;
}

export function signToken(payload: JwtPayload): string {
  if (!JWT_SECRET) {
    throw new Error('JWT_SECRET is not set');
  }
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function verifyToken(token: string): JwtPayload {
  if (!JWT_SECRET) {
    throw new Error('JWT_SECRET is not set');
  }
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}
