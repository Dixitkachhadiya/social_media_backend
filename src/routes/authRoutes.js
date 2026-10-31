import { Router } from 'express';
import { register, login, getMe } from '../controllers/authController.js';
import { sendVerification, resendVerification, verifyEmail } from '../controllers/emailVerificationController.js';
import { forgotPassword, verifyResetOtp, verifyResetToken, resetPassword } from '../controllers/passwordResetController.js';
import { protect } from '../middleware/authMiddleware.js';
import { authLimiter, emailLimiter, otpLimiter, tokenLimiter } from '../middleware/rateLimiters.js';
import { validate, allowOnlyFields } from '../middleware/validate.js';
import { emailRule, otpRule, tokenRule, newPasswordRule } from '../validators/index.js';

const router = Router();

router.post('/register', authLimiter, register);
router.post('/login', authLimiter, login);
router.get('/me', protect, getMe);

// Email verification (6-digit code). Verifying always applies to the JWT's own account.
router.post('/send-verification', protect, emailLimiter, sendVerification);
router.post('/resend-verification', emailLimiter, validate(emailRule), resendVerification);
router.post('/verify-email', protect, otpLimiter, allowOnlyFields('otp'), validate(otpRule), verifyEmail);

// Password recovery: email -> 6-digit code -> single-use reset token -> new password
router.post('/forgot-password', emailLimiter, validate(emailRule), forgotPassword);
router.post('/verify-reset-otp', otpLimiter, allowOnlyFields('email', 'otp'), validate(emailRule, otpRule), verifyResetOtp);
router.post('/verify-reset-token', tokenLimiter, validate(tokenRule), verifyResetToken);
router.post('/reset-password', tokenLimiter, validate(tokenRule, newPasswordRule), resetPassword);

export default router;
