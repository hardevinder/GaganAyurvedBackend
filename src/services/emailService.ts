// src/services/emailService.ts
import nodemailer from "nodemailer";

type SendOrderConfirmationOptions = {
  to: string;
  name?: string;
  orderNumber?: string;
  link?: string;
  pdfFilename?: string | null;
};

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "localhost",
  port: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 1025,
  secure: Boolean(process.env.SMTP_SECURE === "true"),
  auth:
    process.env.SMTP_USER && process.env.SMTP_PASS
      ? {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        }
      : undefined,
});

/**
 * sendOrderConfirmationEmail - best-effort, does not block on failure.
 */
export async function sendOrderConfirmationEmail(opts: SendOrderConfirmationOptions) {
  if (!opts || !opts.to) {
    throw new Error("sendOrderConfirmationEmail: missing recipient");
  }

  const subject = `Order Confirmation ${opts.orderNumber ? `- ${opts.orderNumber}` : ""}`;
  const textLines = [
    `Hello ${opts.name ?? ""}`.trim(),
    "",
    `Thank you for your order${opts.orderNumber ? ` (${opts.orderNumber})` : ""}.`,
    opts.link ? `You can view your order here: ${opts.link}` : "",
    "",
    "Regards,",
    "Your Store",
  ].filter(Boolean);

  const mailOptions: any = {
    from: process.env.EMAIL_FROM || "no-reply@example.com",
    to: opts.to,
    subject,
    text: textLines.join("\n"),
    html: `<p>${(opts.name ?? "Customer")}</p>
           <p>Thank you for your order${opts.orderNumber ? ` (<strong>${opts.orderNumber}</strong>)` : ""}.</p>
           ${opts.link ? `<p><a href="${opts.link}">View your order</a></p>` : ""}
           <p>Regards,<br/>Your Store</p>`,
  };

  if (opts.pdfFilename) {
    const invoicePathBase = process.env.INVOICE_UPLOAD_DIR || (process.cwd() + "/uploads/invoices");
    mailOptions.attachments = [
      {
        filename: opts.pdfFilename,
        path: `${invoicePathBase}/${opts.pdfFilename}`,
      },
    ];
  }

  try {
    const result = await transporter.sendMail(mailOptions);
    return result;
  } catch (err) {
    // let caller decide — rethrow so caller can log/ignore as needed
    throw err;
  }
}

export default {
  sendOrderConfirmationEmail,
};
