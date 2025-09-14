// src/services/invoiceService.ts
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
// pdfkit has no bundled TypeScript types in many setups — silence the import error here.
// You can alternatively add `declare module "pdfkit";` in a global d.ts file.
 // @ts-ignore
import PDFDocument from "pdfkit";

/**
 * Simple invoice generator using pdfkit.
 * - Writes PDF to uploads/invoices/ (or INVOICE_UPLOAD_DIR)
 * - Returns the filename (not full path) on success, or null on failure.
 *
 * Order shape: minimal fields used here:
 * {
 *   orderNumber: string,
 *   createdAt?: string | Date,
 *   customerName?: string,
 *   customerEmail?: string,
 *   subtotal?: string | number,
 *   shipping?: string | number,
 *   tax?: string | number,
 *   discount?: string | number,
 *   grandTotal?: string | number,
 *   items?: Array<{ productName?: string, variantName?: string, sku?: string, quantity?: number, price?: string|number, total?: string|number }>
 * }
 */

const INVOICES_DIR = process.env.INVOICE_UPLOAD_DIR
  ? path.resolve(process.env.INVOICE_UPLOAD_DIR)
  : path.resolve(process.cwd(), "uploads", "invoices");

async function ensureInvoicesDir() {
  await fsPromises.mkdir(INVOICES_DIR, { recursive: true });
}

/**
 * Format money for invoice (simple).
 */
function formatMoney(v: any) {
  if (v == null) return "—";
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  if (!isFinite(n)) return String(v);
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(n);
  } catch {
    return String(n);
  }
}

/**
 * Options:
 * - deterministicFilename: if true uses `${orderNumber}.pdf` (overwrites if exists)
 * - filename: explicit filename to use (overrides deterministic)
 */
export async function generateInvoicePdf(
  order: any,
  opts?: { deterministicFilename?: boolean; filename?: string }
): Promise<string | null> {
  try {
    await ensureInvoicesDir();

    const orderNumber = String(order?.orderNumber ?? `ORD-${Date.now()}`);
    const safeOrder = orderNumber.replace(/[^a-zA-Z0-9_-]/g, "_");

    let filename: string;
    if (opts?.filename) {
      filename = String(opts.filename).replace(/[^a-zA-Z0-9._-]/g, "_");
    } else if (opts?.deterministicFilename) {
      filename = `${safeOrder}.pdf`;
    } else {
      const timestamp = Date.now();
      filename = `${safeOrder}_${timestamp}.pdf`;
    }

    const outPath = path.resolve(INVOICES_DIR, filename);

    // Promise wrapper to handle both writeStream and PDFKit errors
    return await new Promise<string>((resolve, reject) => {
      // create write stream
      let writeStream: fs.WriteStream;
      try {
        writeStream = fs.createWriteStream(outPath);
      } catch (err) {
        return reject(err);
      }

      const doc = new (PDFDocument as any)({ size: "A4", margin: 50 });

      // Reject on PDFKit errors
      doc.on("error", (err: any) => {
        // ensure stream closed
        try {
          writeStream.destroy();
        } catch (_) {}
        return reject(err);
      });

      // Reject if stream errors
      writeStream.on("error", (err: any) => {
        try {
          doc.end();
        } catch (_) {}
        return reject(err);
      });

      // Resolve when stream finishes writing
      writeStream.on("finish", () => {
        return resolve(filename);
      });

      // Pipe and write content
      doc.pipe(writeStream);

      try {
        // Header
        doc.fontSize(20).text("Invoice", { align: "right" });
        doc.moveDown(0.25);
        doc.fontSize(10).text(`Order: ${orderNumber}`, { align: "right" });
        doc.text(`Date: ${new Date(order?.createdAt ?? Date.now()).toLocaleString()}`, {
          align: "right",
        });

        doc.moveDown(1);

        // Seller (you)
        doc.fontSize(12).text("Seller:", { underline: true });
        doc.fontSize(10).text("Your Store Name");
        doc.text("Address line 1");
        doc.text("Address line 2");
        doc.text("");

        // Customer
        doc.moveDown(0.5);
        doc.fontSize(12).text("Bill To:", { underline: true });
        doc.fontSize(10).text(order?.customerName ?? "-");
        if (order?.customerEmail) doc.text(order.customerEmail);
        if (order?.customerPhone) doc.text(order.customerPhone);
        doc.moveDown(1);

        // Items table header
        doc.fontSize(11).text("Items:", { underline: true });
        doc.moveDown(0.3);
        doc.fontSize(10);

        const items = Array.isArray(order?.items) ? order.items : [];
        if (items.length === 0) {
          doc.text("No items");
        } else {
          // simple column positions
          const startX = doc.x;
          const col1 = startX;
          const col2 = startX + 240; // sku
          const col3 = startX + 320; // qty
          const col4 = startX + 370; // price
          const col5 = startX + 460; // total

          // header row
          try {
            doc.font("Helvetica-Bold");
          } catch (_) {
            // ignore font switching if unavailable
          }
          doc.text("Description", col1, undefined, { width: 240 });
          doc.text("SKU", col2, doc.y, { width: 80 });
          doc.text("Qty", col3, doc.y, { width: 40 });
          doc.text("Price", col4, doc.y, { width: 80, align: "right" });
          doc.text("Total", col5, doc.y, { width: 80, align: "right" });
          doc.moveDown(0.5);
          try {
            doc.font("Helvetica");
          } catch (_) {}

          for (const it of items) {
            const desc = String(it.productName ?? it.variantName ?? "Item");
            const sku = String(it.sku ?? "");
            const qty = Number(it.quantity ?? 0);
            const price = formatMoney(it.price ?? 0);
            const total = formatMoney(it.total ?? (Number(it.price || 0) * qty));

            const yBefore = doc.y;
            doc.text(desc, col1, yBefore, { width: 240 });
            doc.text(sku, col2, yBefore, { width: 80 });
            doc.text(String(qty), col3, yBefore, { width: 40 });
            doc.text(price, col4, yBefore, { width: 80, align: "right" });
            doc.text(total, col5, yBefore, { width: 80, align: "right" });
            doc.moveDown(0.5);
          }
        }

        doc.moveDown(1);

        // Totals
        const subtotal = formatMoney(order?.subtotal ?? 0);
        const shipping = formatMoney(order?.shipping ?? 0);
        const tax = formatMoney(order?.tax ?? 0);
        const discount = formatMoney(order?.discount ?? 0);
        const grandTotal = formatMoney(order?.grandTotal ?? 0);

        const rightColX = doc.page.width - 200;
        doc.text(`Subtotal: ${subtotal}`, rightColX, undefined, { align: "left" });
        doc.text(`Shipping: ${shipping}`, rightColX, undefined, { align: "left" });
        doc.text(`Tax: ${tax}`, rightColX, undefined, { align: "left" });
        doc.text(`Discount: ${discount}`, rightColX, undefined, { align: "left" });
        doc.moveDown(0.2);
        try {
          doc.font("Helvetica-Bold");
        } catch (_) {}
        doc.text(`Grand Total: ${grandTotal}`, rightColX, undefined, { align: "left" });
        try {
          doc.font("Helvetica");
        } catch (_) {}

        doc.moveDown(2);
        doc.fontSize(10).text("Thank you for your purchase!", { align: "center" });
      } catch (err) {
        // If any synchronous PDF operations throw, clean up and reject
        try {
          doc.end();
        } catch (_) {}
        try {
          writeStream.destroy();
        } catch (_) {}
        return reject(err);
      }

      // finalize PDFKit stream
      doc.end();
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("generateInvoicePdf error", err);
    return null;
  }
}

export default {
  generateInvoicePdf,
};
