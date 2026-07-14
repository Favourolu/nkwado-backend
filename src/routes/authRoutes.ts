import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { register, login, logoutAll } from '../controllers/authController';
import { authenticate } from '../middleware/auth';

const router = Router();

// Keyed on IP + email so one attacker can't lock out a real user by spamming their
// address, while still capping brute-force volume against any single account.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.ip}:${(req.body?.email || '').toLowerCase()}`,
  message: { error: 'Too many login attempts, please try again later' },
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many accounts created from this network, please try again later' },
});

router.post('/register', registerLimiter, register);
router.post('/login', loginLimiter, login);
router.post('/logout-all', authenticate, logoutAll);
router.get('/me', authenticate, (req: Request, res: Response) => {
  res.json({ user: req.user });
});

export default router;
