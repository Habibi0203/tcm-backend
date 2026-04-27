/**
 * Brevo (ex-Sendinblue) transactional email — backend edition
 * Mirrors the shape in the frontend but runs server-side.
 */

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';

/** Prevent HTML/XSS injection when interpolating user input into email HTML */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface BrevoRecipient {
  email: string;
  name?: string;
}

export interface SendEmailOptions {
  to:          BrevoRecipient[];
  subject:     string;
  htmlContent: string;
  replyTo?:    BrevoRecipient;
}

export interface BrevoResult {
  ok:         boolean;
  messageId?: string;
  error?:     string;
}

export async function sendEmail(opts: SendEmailOptions): Promise<BrevoResult> {
  const apiKey      = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_SENDER_EMAIL;
  const senderName  = process.env.BREVO_SENDER_NAME ?? 'TCM Indonesia';

  if (!apiKey || !senderEmail) {
    return { ok: false, error: 'BREVO_API_KEY or BREVO_SENDER_EMAIL not set' };
  }

  const body = {
    sender:      { email: senderEmail, name: senderName },
    to:          opts.to,
    subject:     opts.subject,
    htmlContent: opts.htmlContent,
    ...(opts.replyTo ? { replyTo: opts.replyTo } : {}),
  };

  try {
    const res = await fetch(BREVO_API_URL, {
      method: 'POST',
      headers: {
        'api-key':      apiKey,
        'Content-Type': 'application/json',
        Accept:         'application/json',
      },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const data = await res.json() as { messageId?: string };
      return { ok: true, messageId: data.messageId };
    }

    const err = await res.text();
    return { ok: false, error: err };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// ─── Email template builders ────────────────────────────────────────────────

function wrap(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="id">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;padding:0;background:#f5f0e8;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0e8;padding:32px 0;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
      <!-- Header -->
      <tr><td style="background:#3d2b1f;padding:28px 36px;text-align:center;">
        <span style="font-size:28px;">道</span>
        <p style="margin:8px 0 0;color:#e8d5b7;font-size:18px;font-weight:700;letter-spacing:1px;">tcm.my.id</p>
        <p style="margin:4px 0 0;color:#c4874f;font-size:11px;letter-spacing:3px;text-transform:uppercase;">Komunitas TCM Indonesia</p>
      </td></tr>
      <!-- Body -->
      <tr><td style="padding:36px;">${body}</td></tr>
      <!-- Footer -->
      <tr><td style="background:#f5f0e8;padding:20px 36px;text-align:center;border-top:1px solid #e8d5b7;">
        <p style="margin:0;font-size:12px;color:#8b5e3c;">© 2026 tcm.my.id · <a href="https://tcm.my.id" style="color:#4a6741;text-decoration:none;">tcm.my.id</a></p>
        <p style="margin:6px 0 0;font-size:11px;color:#c4874f;">Informasi bersifat edukatif. Selalu konsultasikan dengan praktisi berlisensi.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

export function buildVerificationEmail(name: string, verifyUrl: string): { subject: string; html: string } {
  const safeName = escapeHtml(name);
  const safeUrl  = escapeHtml(verifyUrl);
  return {
    subject: 'Verifikasi Email — tcm.my.id ✉️',
    html: wrap('Verifikasi Email', `
      <h2 style="margin:0 0 12px;color:#3d2b1f;font-size:22px;">Verifikasi Email Anda</h2>
      <p style="color:#5c3d2e;line-height:1.7;margin:0 0 16px;">Halo <strong>${safeName}</strong>, terima kasih sudah mendaftar di <strong>tcm.my.id</strong>.</p>
      <p style="color:#5c3d2e;line-height:1.7;margin:0 0 24px;">Sebelum login, mohon verifikasi alamat email Anda dengan menekan tombol berikut.</p>
      <div style="text-align:center;margin:24px 0;">
        <a href="${safeUrl}" style="display:inline-block;background:#4a6741;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:600;font-size:15px;">Verifikasi Email</a>
      </div>
      <div style="background:#fff8e6;border:1px solid #e8bc65;border-radius:8px;padding:14px 18px;margin-top:16px;">
        <p style="margin:0;font-size:13px;color:#8b5e3c;">Jika tombol tidak bekerja, salin dan buka tautan ini di browser:</p>
        <p style="margin:8px 0 0;font-size:12px;word-break:break-all;color:#5c3d2e;">${safeUrl}</p>
      </div>
    `),
  };
}

export function buildWelcomeEmail(name: string): { subject: string; html: string } {
  const safeName = escapeHtml(name);
  return {
    subject: `Selamat datang di tcm.my.id, ${safeName}! 🌿`,
    html: wrap('Selamat Datang', `
      <h2 style="margin:0 0 12px;color:#3d2b1f;font-size:22px;">Selamat datang, ${safeName}!</h2>
      <p style="color:#5c3d2e;line-height:1.7;margin:0 0 16px;">Akun Anda telah berhasil dibuat di <strong>tcm.my.id</strong> — komunitas Traditional Chinese Medicine Indonesia.</p>
      <p style="color:#5c3d2e;line-height:1.7;margin:0 0 24px;">Mulai jelajahi artikel, ruang diskusi komunitas, dan konten edukatif yang terus kami kembangkan.</p>
      <div style="text-align:center;margin:24px 0;">
        <a href="https://tcm.my.id/dashboard" style="display:inline-block;background:#4a6741;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:600;font-size:15px;">Mulai Eksplorasi →</a>
      </div>
    `),
  };
}

export function buildResetPasswordEmail(name: string, resetUrl: string): { subject: string; html: string } {
  const safeName = escapeHtml(name);
  const safeUrl  = escapeHtml(resetUrl);
  return {
    subject: 'Reset Password — tcm.my.id 🔐',
    html: wrap('Reset Password', `
      <h2 style="margin:0 0 12px;color:#3d2b1f;font-size:22px;">Reset Password</h2>
      <p style="color:#5c3d2e;line-height:1.7;margin:0 0 16px;">Halo <strong>${safeName}</strong>, kami menerima permintaan reset password untuk akun Anda.</p>
      <p style="color:#5c3d2e;line-height:1.7;margin:0 0 24px;">Klik tombol berikut untuk membuat password baru. Tautan ini berlaku selama <strong>1 jam</strong>.</p>
      <div style="text-align:center;margin:24px 0;">
        <a href="${safeUrl}" style="display:inline-block;background:#c9983a;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:600;font-size:15px;">Reset Password</a>
      </div>
      <div style="background:#fff8e6;border:1px solid #e8bc65;border-radius:8px;padding:14px 18px;margin-top:16px;">
        <p style="margin:0;font-size:13px;color:#8b5e3c;">⚠️ Jika Anda tidak meminta reset password, abaikan email ini. Password Anda tidak akan berubah.</p>
      </div>
    `),
  };
}
