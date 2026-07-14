import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import {
  getPendingVendors,
  approveVendor,
  rejectVendor,
  listRequests,
  listBookings,
  getDashboardMetrics,
  getActivityLog,
} from '../controllers/adminController';

const router = Router();

router.use(authenticate, requireRole('ADMIN'));

router.get('/vendors/pending', getPendingVendors);
router.post('/vendors/:vendorId/approve', approveVendor);
router.post('/vendors/:vendorId/reject', rejectVendor);
router.get('/requests', listRequests);
router.get('/bookings', listBookings);
router.get('/dashboard', getDashboardMetrics);
router.get('/activity', getActivityLog);

export default router;
