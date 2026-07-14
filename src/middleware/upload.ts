import multer from 'multer';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const storage = multer.memoryStorage();

export const uploadVendorDocs = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
}).fields([
  { name: 'cacDocument', maxCount: 1 },
  { name: 'supportingDocuments', maxCount: 10 },
  { name: 'profilePhotos', maxCount: 10 },
]);
