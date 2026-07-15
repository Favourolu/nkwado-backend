import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { handleParthianLoanWebhook } from '../controllers/webhookController';

const router = Router();

// The only thing standing between a caller and flipping a booking's payment status is the
// shared secret in X-Parthian-Webhook-Secret. Cap the request rate per IP so that secret
// can't be brute-forced with high-volume guessing. Parthian's real callback volume is far
// below this, so a legitimate integration is never throttled.
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many webhook requests' },
});

// No authenticate middleware - these are called by Parthian, not a logged-in user.
// Authorization is a shared-secret header checked inside the handler (see webhookController.ts).
router.post('/parthian/loan-status', webhookLimiter, handleParthianLoanWebhook);

export default router;
