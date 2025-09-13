// src/controllers/ordersController.ts
import { FastifyRequest, FastifyReply } from "fastify";
import { PrismaClient } from "@prisma/client";
import path from "path";
import fs from "fs/promises";
import { createReadStream } from "fs";

const prisma = new PrismaClient();

/**
 * Safe error logger — keeps logs compact and avoids throwing inside logger.
 */
function safeLogError(request: any, err: any, ctx?: string) {
  try {
    const shortStack =
      (err && err.stack && String(err.stack).split("\n").slice(0, 2).join("\n")) || undefined;
    const message = String(err && err.message ? err.message : err);
    request.log?.error?.({ message, shortStack, ctx, errCode: err?.code, meta: err?.meta });
  } catch (_) {
    // eslint-disable-next-line no-console
    console.error("safeLogError fallback:", String(err));
  }
}

/**
 * Serialize order row for client consumption.
 * Converts numeric monetary fields to strings to avoid floating precision surprises in clients.
 */
function serializeOrderForClient(raw: any) {
  if (!raw) return raw;
  return {
    id: raw.id,
    orderNumber: raw.orderNumber,
    guestAccessToken: raw.guestAccessToken ?? null,
    userId: raw.userId ?? null,
    customerName: raw.customerName,
    customerEmail: raw.customerEmail,
    customerPhone: raw.customerPhone ?? null,
    shippingAddress: raw.shippingAddress ?? null,
    subtotal: raw.subtotal != null ? String(raw.subtotal) : raw.subtotal,
    shipping: raw.shipping != null ? String(raw.shipping) : raw.shipping,
    tax: raw.tax != null ? String(raw.tax) : raw.tax,
    discount: raw.discount != null ? String(raw.discount) : raw.discount,
    grandTotal: raw.grandTotal != null ? String(raw.grandTotal) : raw.grandTotal,
    paymentMethod: raw.paymentMethod,
    paymentStatus: raw.paymentStatus,
    invoicePdfPath: raw.invoicePdfPath ?? null,
    items: Array.isArray(raw.items)
      ? raw.items.map((it: any) => ({
          id: it.id,
          productName: it.productName,
          sku: it.sku,
          quantity: it.quantity,
          price: it.price != null ? String(it.price) : it.price,
          total: it.total != null ? String(it.total) : it.total,
        }))
      : [],
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

/**
 * Resolve an invoice path safely:
 * - If invoicePdfPath is absolute and inside the invoices dir, accept it.
 * - Otherwise, treat invoicePdfPath as a relative path (or filename) under invoicesDir.
 * - Reject anything that would escape invoicesDir.
 *
 * Returns the resolved absolute path string or null if invalid/refused.
 */
async function resolveInvoiceFilePath(invoicePdfPath: string | null | undefined) {
  const invoicesDir = process.env.INVOICE_UPLOAD_DIR
    ? path.resolve(process.env.INVOICE_UPLOAD_DIR)
    : path.join(process.cwd(), "uploads", "invoices");

  if (!invoicePdfPath) return null;

  // Candidate: if stored value is absolute, resolve and ensure it's under invoicesDir
  const absoluteCandidate = path.resolve(invoicePdfPath);
  if (absoluteCandidate.startsWith(invoicesDir)) {
    return absoluteCandidate;
  }

  // Otherwise normalize stored path and join under invoicesDir.
  // Remove any prefixed "../" sequences to avoid traversal; keep safe relative subfolders like "2025/..."
  const normalized = path.normalize(invoicePdfPath).replace(/^(\.\.[/\\])+/, "");
  const candidate = path.resolve(invoicesDir, normalized);

  if (!candidate.startsWith(invoicesDir)) return null;
  return candidate;
}

/**
 * GET /api/orders/:orderNumber
 * Authorization rules:
 *  - If request.userId present => allow if order.userId === request.userId OR guest token matches.
 *  - If no request.userId => guest token must be present and match order.guestAccessToken.
 */
export const getOrder = async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    const params: any = request.params || {};
    const orderNumber = String(params.orderNumber || "");

    if (!orderNumber) return reply.code(400).send({ error: "orderNumber required" });

    // Load order (include items for client)
    const order = await prisma.order.findUnique({
      where: { orderNumber },
      include: { items: true, user: true },
    });
    if (!order) return reply.code(404).send({ error: "Order not found" });

    const reqAny: any = request;
    const userId: number | undefined = reqAny.userId;
    const guestToken: string | undefined =
      reqAny.guestToken ?? (request.query && (request.query as any).token);

    // Authorization
    if (userId) {
      if (order.userId !== null && Number(order.userId) === Number(userId)) {
        // allowed
      } else if (order.guestAccessToken && guestToken && order.guestAccessToken === guestToken) {
        // allowed (logged-in + guest token)
      } else {
        return reply.code(403).send({ error: "Forbidden" });
      }
    } else {
      // not authenticated => require a matching guest token
      if (!guestToken || order.guestAccessToken !== guestToken) {
        return reply.code(403).send({ error: "Forbidden - guest token required" });
      }
    }

    return reply.send({ data: serializeOrderForClient(order) });
  } catch (err: any) {
    safeLogError(request, err, "getOrder");
    return reply.code(500).send({ error: err?.message || "Internal error" });
  }
};

/**
 * GET /api/orders/:orderNumber/invoice.pdf
 * Streams the invoice PDF to the client if present and authorized.
 */
export const getInvoicePdf = async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    const params: any = request.params || {};
    const orderNumber = String(params.orderNumber || "");
    if (!orderNumber) return reply.code(400).send({ error: "orderNumber required" });

    const order = await prisma.order.findUnique({ where: { orderNumber } });
    if (!order) return reply.code(404).send({ error: "Order not found" });

    const reqAny: any = request;
    const userId: number | undefined = reqAny.userId;
    const guestToken: string | undefined =
      reqAny.guestToken ?? (request.query && (request.query as any).token);

    // Authorization (same as getOrder)
    if (userId) {
      if (order.userId !== null && Number(order.userId) === Number(userId)) {
        // ok
      } else if (order.guestAccessToken && guestToken && order.guestAccessToken === guestToken) {
        // ok
      } else {
        return reply.code(403).send({ error: "Forbidden" });
      }
    } else {
      if (!guestToken || order.guestAccessToken !== guestToken) {
        return reply.code(403).send({ error: "Forbidden - guest token required" });
      }
    }

    if (!order.invoicePdfPath) {
      request.log?.info?.({ orderNumber }, "order has no invoicePdfPath");
      return reply.code(404).send({ error: "Invoice PDF not found" });
    }

    const resolved = await resolveInvoiceFilePath(order.invoicePdfPath);
    if (!resolved) {
      request.log?.warn?.({ orderNumber, invoicePdfPath: order.invoicePdfPath }, "invoice path refused or invalid");
      return reply.code(400).send({ error: "Invalid invoice path" });
    }

    // Ensure file exists and is a file; use async fs.stat
    let stats;
    try {
      stats = await fs.stat(resolved);
      if (!stats.isFile()) {
        request.log?.warn?.({ resolved }, "invoice path is not a file");
        return reply.code(404).send({ error: "Invoice PDF not found" });
      }
    } catch (err) {
      request.log?.info?.({ resolved, err }, "invoice file missing");
      return reply.code(404).send({ error: "Invoice PDF not found" });
    }

    // Set headers and stream the file
    reply.header("Content-Type", "application/pdf");
    // Use attachment to force download; change to inline if you prefer preview in browser
    reply.header("Content-Disposition", `attachment; filename="${order.orderNumber}.pdf"`);
    reply.header("Content-Length", String(stats.size));

    const stream = createReadStream(resolved);
    return reply.send(stream);
  } catch (err: any) {
    safeLogError(request, err, "getInvoicePdf");
    return reply.code(500).send({ error: err?.message || "Internal error" });
  }
};

export default {
  getOrder,
  getInvoicePdf,
};
