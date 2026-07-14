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
  getCronHealth,
  getEmailFailures,
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
router.get('/health/cron', getCronHealth);
router.get('/email-failures', getEmailFailures);

export default router;
