import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import {
  submitQuestionnaire,
  listMyRequests,
  getRequestById,
  getRequestQuotes,
  customizeRequest,
  getBookingFinancingOptions,
  createBooking,
  listBookings,
  listMyLoans,
  getProgress,
} from '../controllers/customerController';

const router = Router();

router.use(authenticate, requireRole('CUSTOMER'));

router.post('/questionnaire', submitQuestionnaire);
router.get('/requests', listMyRequests);
router.get('/requests/:requestId', getRequestById);
router.get('/requests/:requestId/quotes', getRequestQuotes);
router.post('/customize/:requestId', customizeRequest);
router.get('/financing-options', getBookingFinancingOptions);
router.post('/booking/:requestId', createBooking);
router.get('/bookings', listBookings);
router.get('/loans', listMyLoans);
router.get('/progress/:requestId', getProgress);

export default router;
