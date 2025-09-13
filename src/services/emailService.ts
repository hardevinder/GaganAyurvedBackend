// src/services/emailService.ts
import nodemailer from "nodemailer";
import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.example.com",
  port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_SECURE === "true", // true for 465, false for other ports
  auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
});

/**
 * Send order confirmation email.
 * If pdfFilename is provided, will attach from uploads/invoices/<pdfFilename>
 */
export async function sendOrderConfirmationEmail(opts: { to: string; name: string; orderNumber: string; link: string; pdfFilename?: string | null }) {
  const from = process.env.EMAIL_FROM || `no-reply@${process.env.FRONTEND_ORIGINS?.split(",")[0] || "example.com"}`;
  const subject = `Order confirmation — ${opts.orderNumber}`;
  const html = `<p>Hi ${opts.name},</p>
  <p>Thanks for your order <strong>${opts.orderNumber}</strong>.</p>
  <p>You can view your order here: <a href="${opts.link}">${opts.link}</a></p>
  <p>Regards,<br/>My Shop</p>`;

  const attachments: any[] = [];
  if (opts.pdfFilename) {
    const invoicesDir = process.env.INVOICE_UPLOAD_DIR || path.join(process.cwd(), "uploads", "invoices");
    const p = path.join(invoicesDir, path.basename(opts.pdfFilename));
    if (existsSync(p)) {
      attachments.push({ filename: `${opts.orderNumber}.pdf`, path: p });
    }
  }

  const info = await transporter.sendMail({
    from,
    to: opts.to,
    subject,
    html,
    attachments,
  });
  return info;
}
