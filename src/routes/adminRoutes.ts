import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { getPendingVendors, approveVendor, rejectVendor } from '../controllers/adminController';

const router = Router();

router.use(authenticate, requireRole('ADMIN'));

router.get('/vendors/pending', getPendingVendors);
router.post('/vendors/:vendorId/approve', approveVendor);
router.post('/vendors/:vendorId/reject', rejectVendor);

export default router;
