import { Request, Response, NextFunction } from 'express';
import multer from 'multer';

export class AppError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
}

export function errorHandler(
  err: Error | AppError,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction
) {
  // multer surfaces both size-limit violations and our fileFilter rejection as plain
  // Errors passed to next() - treat both as client errors, not server errors.
  const isUploadRejection = err instanceof multer.MulterError || /Only PDF, JPEG, or PNG/.test(err.message || '');
  const statusCode = err instanceof AppError ? err.statusCode : isUploadRejection ? 400 : 500;
  const message = err.message || 'Internal server error';

  if (statusCode >= 500) {
    console.error(err);
  }

  res.status(statusCode).json({ error: message });
}
