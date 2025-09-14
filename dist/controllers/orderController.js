"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.placeOrder = void 0;
const client_1 = require("@prisma/client"); // Prisma.Decimal
function parseAndValidatePincode(value) {
    if (value === undefined || value === null)
        return null;
    const s = String(value).replace(/\D/g, "");
    if (!s)
        return null;
    const n = Number(s);
    if (!Number.isInteger(n))
        return null;
    if (n < 10000 || n > 999999)
        return null;
    return n;
}
const placeOrder = async (req, reply) => {
    try {
        const body = (req.body ?? {});
        const { userId: userIdFromBody, items } = body;
        if (!items || !Array.isArray(items) || items.length === 0) {
            return reply.status(400).send({ error: "Items array is required" });
        }
        const userId = req.user?.id ?? userIdFromBody;
        if (!userId) {
            return reply.status(401).send({ error: "Unauthorized: missing user" });
        }
        // Validate items
        for (const it of items) {
            if (!it || typeof it.variantId !== "number") {
                return reply.status(400).send({ error: "Each item must have a numeric variantId" });
            }
            if (!it || typeof it.quantity !== "number" || it.quantity <= 0) {
                return reply.status(400).send({ error: `Invalid quantity for variant ${it.variantId}` });
            }
        }
        const variantIds = items.map((i) => i.variantId);
        const prisma = req.server.prisma;
        const variants = await prisma.variant.findMany({
            where: { id: { in: variantIds } },
            include: { product: true },
        });
        const foundIds = new Set(variants.map((v) => v.id));
        const missing = variantIds.filter((id) => !foundIds.has(id));
        if (missing.length) {
            return reply.status(400).send({ error: `Variant(s) not found: ${missing.join(", ")}` });
        }
        const byId = new Map(variants.map((v) => [v.id, v]));
        let subtotal = new client_1.Prisma.Decimal(0);
        for (const it of items) {
            const v = byId.get(it.variantId);
            const priceDecimal = v && v.price != null ? new client_1.Prisma.Decimal(String(v.price)) : new client_1.Prisma.Decimal(0);
            subtotal = subtotal.add(priceDecimal.mul(it.quantity));
        }
        let shippingAddr = body.shippingAddress ?? null;
        if (!shippingAddr) {
            const addr = await prisma.address.findFirst({
                where: { userId },
                orderBy: [{ isDefault: "desc" }, { id: "asc" }],
            });
            if (addr) {
                shippingAddr = {
                    name: addr.name,
                    phone: addr.phone,
                    line1: addr.line1,
                    line2: addr.line2,
                    city: addr.city,
                    state: addr.state,
                    postalCode: addr.postalCode,
                    country: addr.country,
                };
            }
        }
        if (!shippingAddr || !shippingAddr.postalCode) {
            return reply.status(400).send({ error: "Shipping address (with postalCode) required" });
        }
        const pincode = parseAndValidatePincode(shippingAddr.postalCode);
        if (pincode === null) {
            return reply.status(400).send({ error: "Invalid postalCode in shipping address" });
        }
        const matchingRule = await prisma.shippingRule.findFirst({
            where: {
                isActive: true,
                pincodeFrom: { lte: pincode },
                pincodeTo: { gte: pincode },
            },
            orderBy: [{ priority: "desc" }, { id: "desc" }],
        });
        let shippingDecimal = new client_1.Prisma.Decimal(0);
        if (matchingRule && matchingRule.charge != null) {
            shippingDecimal = new client_1.Prisma.Decimal(String(matchingRule.charge));
        }
        const taxDecimal = new client_1.Prisma.Decimal(0);
        const discountDecimal = new client_1.Prisma.Decimal(0);
        const grandTotal = subtotal.add(shippingDecimal).add(taxDecimal).sub(discountDecimal);
        const orderItemsCreate = items.map((it) => {
            const v = byId.get(it.variantId);
            const priceDec = v && v.price != null ? new client_1.Prisma.Decimal(String(v.price)) : new client_1.Prisma.Decimal(0);
            const totalDec = priceDec.mul(it.quantity);
            return {
                variantId: v.id,
                productName: v.product?.name ?? "Unknown",
                sku: v.sku ?? undefined,
                quantity: it.quantity,
                price: priceDec,
                total: totalDec,
            };
        });
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, name: true, email: true, phone: true },
        });
        // guest token for guests (if no userId; here user exists because we required it)
        const guestAccessToken = null;
        const orderNumber = `ORD${Date.now()}${Math.floor(Math.random() * 900 + 100)}`;
        const createdOrder = await prisma.$transaction(async (tx) => {
            const created = await tx.order.create({
                data: {
                    orderNumber,
                    userId,
                    guestAccessToken,
                    customerName: body.customerName ?? user?.name ?? "Customer",
                    customerEmail: String(body.customerEmail ?? user?.email ?? ""),
                    customerPhone: body.customerPhone ?? user?.phone ?? undefined,
                    shippingAddress: {
                        name: shippingAddr.name ?? undefined,
                        phone: shippingAddr.phone ?? undefined,
                        line1: shippingAddr.line1 ?? undefined,
                        line2: shippingAddr.line2 ?? undefined,
                        city: shippingAddr.city ?? undefined,
                        state: shippingAddr.state ?? undefined,
                        postalCode: String(shippingAddr.postalCode),
                        country: shippingAddr.country ?? "IN",
                    },
                    subtotal,
                    shipping: shippingDecimal,
                    tax: taxDecimal,
                    discount: discountDecimal,
                    grandTotal,
                    paymentMethod: body.paymentMethod ?? "unknown",
                    paymentStatus: "pending",
                    items: {
                        create: orderItemsCreate,
                    },
                },
                include: { items: true },
            });
            return created;
        });
        return reply.status(201).send({
            message: "Order placed successfully",
            order: createdOrder,
            appliedShippingRule: matchingRule
                ? {
                    id: matchingRule.id,
                    name: matchingRule.name,
                    pincodeFrom: matchingRule.pincodeFrom,
                    pincodeTo: matchingRule.pincodeTo,
                    charge: String(matchingRule.charge ?? "0"),
                    priority: matchingRule.priority,
                }
                : null,
        });
    }
    catch (err) {
        req.log?.error?.({ err }, "placeOrder failed");
        return reply.status(500).send({
            error: "Failed to place order",
            details: err?.message ?? String(err),
        });
    }
};
exports.placeOrder = placeOrder;
exports.default = { placeOrder: exports.placeOrder };
//# sourceMappingURL=orderController.js.map