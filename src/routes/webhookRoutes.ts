import { Router } from 'express';
import { handleParthianLoanWebhook } from '../controllers/webhookController';

const router = Router();

// No authenticate middleware - these are called by Parthian, not a logged-in user.
// Authorization is a shared-secret header checked inside the handler (see webhookController.ts).
router.post('/parthian/loan-status', handleParthianLoanWebhook);

export default router;
