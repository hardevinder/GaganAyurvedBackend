"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOrders = exports.placeOrder = void 0;
const client_1 = require("@prisma/client"); // for Prisma.Decimal
// =========================
// 🛒 Place Order (User)
// =========================
const placeOrder = async (req, reply) => {
    try {
        const { userId: userIdFromBody, items } = (req.body ?? {});
        if (!items || !Array.isArray(items) || items.length === 0) {
            return reply.status(400).send({ error: "Items array is required" });
        }
        // Prefer user id from JWT if available; fallback to body
        const userId = req.user?.id ??
            userIdFromBody;
        if (!userId) {
            return reply.status(401).send({ error: "Unauthorized: missing user" });
        }
        // Validate quantities & collect ids
        for (const it of items) {
            if (!it?.variantId || typeof it.variantId !== "number") {
                return reply.status(400).send({ error: "Each item must have a numeric variantId" });
            }
            if (!it?.quantity || typeof it.quantity !== "number" || it.quantity <= 0) {
                return reply.status(400).send({ error: `Invalid quantity for variant ${it.variantId}` });
            }
        }
        const variantIds = items.map((i) => i.variantId);
        // Fetch all variants at once
        const variants = await req.server.prisma.variant.findMany({
            where: { id: { in: variantIds } },
            select: { id: true, price: true }, // price is Prisma.Decimal
        });
        // Ensure all exist
        const foundIds = new Set(variants.map((v) => v.id));
        const missing = variantIds.filter((id) => !foundIds.has(id));
        if (missing.length) {
            return reply.status(400).send({ error: `Variant(s) not found: ${missing.join(", ")}` });
        }
        // Map for quick lookup
        const byId = new Map(variants.map((v) => [v.id, v]));
        // Compute total using Decimal
        let total = new client_1.Prisma.Decimal(0);
        for (const item of items) {
            const v = byId.get(item.variantId);
            const line = v.price.mul(item.quantity); // Decimal * number
            total = total.add(line);
        }
        // Create order + items within a transaction (safer)
        const order = await req.server.prisma.$transaction(async (tx) => {
            const created = await tx.order.create({
                data: {
                    userId,
                    total, // Decimal column in schema
                    items: {
                        create: items.map((it) => {
                            const v = byId.get(it.variantId);
                            return {
                                variantId: it.variantId,
                                quantity: it.quantity,
                                price: v.price, // snapshot price
                            };
                        }),
                    },
                },
                include: {
                    items: {
                        include: {
                            variant: { include: { product: true } },
                        },
                    },
                    user: { select: { id: true, name: true, email: true } },
                },
            });
            return created;
        });
        return reply.status(201).send({
            message: "Order placed successfully",
            order,
        });
    }
    catch (error) {
        req.log?.error?.({ err: error }, "placeOrder failed");
        return reply.status(500).send({
            error: "Failed to place order",
            details: error?.message ?? String(error),
        });
    }
};
exports.placeOrder = placeOrder;
// =========================
// 📦 Get All Orders (Admin Only)
// =========================
const getOrders = async (req, reply) => {
    try {
        const orders = await req.server.prisma.order.findMany({
            include: {
                user: { select: { id: true, name: true, email: true } },
                items: {
                    include: {
                        variant: { include: { product: true } },
                    },
                },
            },
            orderBy: { createdAt: "desc" },
        });
        return reply.status(200).send({
            message: "Orders fetched successfully",
            orders,
        });
    }
    catch (error) {
        req.log?.error?.({ err: error }, "getOrders failed");
        return reply.status(500).send({
            error: "Failed to fetch orders",
            details: error?.message ?? String(error),
        });
    }
};
exports.getOrders = getOrders;
//# sourceMappingURL=orderController.js.map