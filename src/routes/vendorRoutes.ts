import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { uploadVendorDocs } from '../middleware/upload';
import {
  onboardVendor,
  getVendorProfile,
  getVendorInquiries,
  submitQuote,
} from '../controllers/vendorController';

const router = Router();

router.use(authenticate, requireRole('VENDOR'));

router.post('/onboard', uploadVendorDocs, onboardVendor);
router.get('/profile', getVendorProfile);
router.get('/inquiries', getVendorInquiries);
router.post('/quotes/:requestId', submitQuote);

export default router;
