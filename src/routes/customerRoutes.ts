import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import {
  submitQuestionnaire,
  getRequestById,
  getRequestQuotes,
  customizeRequest,
  createBooking,
  listBookings,
  getProgress,
} from '../controllers/customerController';

const router = Router();

router.use(authenticate, requireRole('CUSTOMER'));

router.post('/questionnaire', submitQuestionnaire);
router.get('/requests/:requestId', getRequestById);
router.get('/requests/:requestId/quotes', getRequestQuotes);
router.post('/customize/:requestId', customizeRequest);
router.post('/booking/:requestId', createBooking);
router.get('/bookings', listBookings);
router.get('/progress/:requestId', getProgress);

export default router;
