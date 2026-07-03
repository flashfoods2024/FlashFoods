import { Resend } from 'resend';

let _resend = null;

function getResend() {
  if (!_resend) {
    _resend = new Resend(process.env.RESEND_API_KEY);
  }
  return _resend;
}

export async function sendPasswordResetEmail(email, resetUrl) {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #e74c3c;">FlashFoods</h1>
      <p>You requested a password reset.</p>
      <p>Click the button below to reset your password. This link expires in 15 minutes.</p>
      <a href="${resetUrl}" style="display: inline-block; padding: 12px 24px; background-color: #e74c3c; color: #fff; text-decoration: none; border-radius: 4px;">Reset Password</a>
      <p style="margin-top: 20px;">If the button doesn't work, copy and paste this link into your browser:</p>
      <p>${resetUrl}</p>
      <p style="margin-top: 20px; color: #666;">If you didn't request this, ignore this email.</p>
    </div>
  `;

  try {
    const { data, error } = await getResend().emails.send({
      from: 'FlashFoods <noreply@flashfoods.in>',
      to: email,
      subject: 'FlashFoods - Password Reset Request',
      html,
      text: `Reset your FlashFoods password: ${resetUrl}\n\nThis link expires in 15 minutes.\n\nIf you didn't request this, ignore this email.`,
    });

    if (error) {
      console.error('Failed to send password reset email:', error);
    }

    return data;
  } catch (err) {
    console.error('Failed to send password reset email:', err);
  }
}
