import multer from 'multer';
import { Request } from 'express';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB per file
// 21 possible files (1 CAC + 10 supporting + 10 photos) at 10MB each would otherwise allow
// ~210MB per request. Multer has no native "total upload size" limit, so this is enforced
// in onboardVendor (vendorController.ts) by summing buffer sizes after upload.
export const MAX_TOTAL_UPLOAD_SIZE = 60 * 1024 * 1024; // 60MB aggregate per request

const ALLOWED_MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);

const storage = multer.memoryStorage();

function fileFilter(
  _req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) {
  if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
    cb(new Error('Only PDF, JPEG, or PNG files are allowed'));
    return;
  }
  cb(null, true);
}

export const uploadVendorDocs = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE, files: 21 },
}).fields([
  { name: 'cacDocument', maxCount: 1 },
  { name: 'supportingDocuments', maxCount: 10 },
  { name: 'profilePhotos', maxCount: 10 },
]);
