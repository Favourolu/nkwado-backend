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
  const anyErr = err as Error & { status?: number; statusCode?: number; type?: string; expose?: boolean };

  // multer surfaces both size-limit violations and our fileFilter rejection as plain
  // Errors passed to next() - treat both as client errors, not server errors.
  const isUploadRejection = err instanceof multer.MulterError || /Only PDF, JPEG, or PNG/.test(err.message || '');
  // express.json() raises a SyntaxError with status 400 / type 'entity.parse.failed' on a
  // malformed request body. Without this it fell through to the 500 branch below, returning
  // the raw parser message ("Unexpected token b in JSON...") — a client mistake reported as
  // a server error, and a small internal-detail leak.
  const isBodyParseError = anyErr.type === 'entity.parse.failed';
  // body-parser / http-errors (malformed body, payload-too-large, unsupported encoding, ...)
  // flag safe-to-expose client errors with expose:true and a 4xx status. Honour that so an
  // oversized body is a 413, not a 500 with a stack trace logged as if it were a server bug.
  const httpStatus = anyErr.status ?? anyErr.statusCode;
  const isExposedClientError =
    anyErr.expose === true && typeof httpStatus === 'number' && httpStatus >= 400 && httpStatus < 500;

  let statusCode: number;
  if (err instanceof AppError) statusCode = err.statusCode;
  else if (isUploadRejection || isBodyParseError) statusCode = 400;
  else if (isExposedClientError) statusCode = httpStatus as number;
  else statusCode = 500;

  if (statusCode >= 500) {
    // Log the real error server-side, but never echo an unexpected error's raw message back
    // to the client — internal exceptions (Prisma failures, stack details, etc.) can leak
    // schema/infra information. Developer-authored AppError messages are intentional and
    // still surfaced; everything else gets a generic response.
    console.error(err);
    const message = err instanceof AppError ? err.message : 'Internal server error';
    res.status(statusCode).json({ error: message });
    return;
  }

  const message = isBodyParseError ? 'Malformed request body' : err.message || 'Bad request';
  res.status(statusCode).json({ error: message });
}
