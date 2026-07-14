import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import {
  submitQuestionnaire,
  getRequestById,
  getRequestQuotes,
} from '../controllers/customerController';

const router = Router();

router.use(authenticate, requireRole('CUSTOMER'));

router.post('/questionnaire', submitQuestionnaire);
router.get('/requests/:requestId', getRequestById);
router.get('/requests/:requestId/quotes', getRequestQuotes);

export default router;
