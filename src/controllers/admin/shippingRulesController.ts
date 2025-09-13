// src/controllers/admin/shippingRulesController.ts
import { FastifyRequest, FastifyReply } from "fastify";
import { PrismaClient } from "@prisma/client";
import type { Prisma } from "@prisma/client";

const prisma = new PrismaClient();

/* ---------------------------
   Safe logger (same pattern as productController)
--------------------------- */
function safeLogError(request: FastifyRequest | any, err: any, ctx?: string) {
  try {
    const shortStack = (err && err.stack && String(err.stack).split("\n").slice(0, 2).join("\n")) || undefined;
    const message = String(err && err.message ? err.message : err);
    request.log?.error?.({ message, shortStack, ctx, errCode: err?.code, meta: err?.meta });
  } catch (_) {
    // eslint-disable-next-line no-console
    console.error("safeLogError fallback:", String(err));
  }
}

/* ---------------------------
   Utilities: pin code validation & parsing
   - Accepts numeric or string; strips non-digits; expects 5-6 digit typical values
--------------------------- */
function parseAndValidatePincode(value: any): number | null {
  if (value === undefined || value === null) return null;
  const s = String(value).replace(/\D/g, "");
  if (!s) return null;
  const n = Number(s);
  if (!Number.isInteger(n)) return null;
  // allow 5-6 digits, but ensure sensible bounds
  if (n < 10000 || n > 999999) return null;
  return n;
}

/* ---------------------------
   Helper: map state code/name -> conservative pincodeFrom/pincodeTo
   - Uses broad PIN-zone based ranges as a convenience.
   - If not found, returns null.
--------------------------- */
function stateToPincodeRange(stateOrCode: string | undefined | null): [number, number] | null {
  if (!stateOrCode) return null;
  const s = String(stateOrCode).trim().toUpperCase();

  // Primary map by state code -> [from, to]
  const map: Record<string, [number, number]> = {
    // north / NCR
    DL: [110000, 119999],
    HR: [120000, 139999],
    PB: [140000, 159999],
    CH: [160000, 169999],
    HP: [170000, 179999],
    JK: [180000, 199999],
    // UP & Uttarakhand (broad)
    UP: [200000, 289999],
    UK: [200000, 289999],
    // west / north-west
    RJ: [300000, 349999],
    GJ: [360000, 399999],
    // west
    MH: [400000, 459999],
    // central / south-central
    AP: [500000, 599999],
    TG: [500000, 599999],
    KA: [560000, 599999],
    // south
    TN: [600000, 659999],
    KL: [670000, 699999],
    // east / northeast
    WB: [700000, 749999],
    OR: [750000, 769999], // Odisha
    AS: [780000, 799999],
    BR: [800000, 849999],
    JH: [820000, 849999],
    // smaller / UTs (examples)
    AN: [744000, 744999], // Andaman & Nicobar
    CHD: [160000, 169999], // Chandigarh alias
    LD: [682000, 682999], // Lakshadweep
    PY: [605000, 605999], // Puducherry / Karaikal
    LA: [194101, 194199], // Ladakh (example)
    DN: [396000, 396999], // Daman & Diu / DNH approximated
  };

  if (map[s]) return map[s];

  // accept a few full-name variants mapping
  const byName: Record<string, [number, number]> = {
    "DELHI": map["DL"],
    "HARYANA": map["HR"],
    "PUNJAB": map["PB"],
    "HIMACHAL PRADESH": map["HP"],
    "JAMMU AND KASHMIR": map["JK"],
    "UTTAR PRADESH": map["UP"],
    "UTTARAKHAND": map["UK"],
    "RAJASTHAN": map["RJ"],
    "GUJARAT": map["GJ"],
    "MAHARASHTRA": map["MH"],
    "ANDHRA PRADESH": map["AP"],
    "TELANGANA": map["TG"],
    "KARNATAKA": map["KA"],
    "TAMIL NADU": map["TN"],
    "KERALA": map["KL"],
    "WEST BENGAL": map["WB"],
    "ODISHA": map["OR"],
    "ASSAM": map["AS"],
    "BIHAR": map["BR"],
    "JHARKHAND": map["JH"],
    "ANDAMAN AND NICOBAR ISLANDS": map["AN"],
    "PUDUCHERRY": map["PY"],
    "LADAKH": map["LA"],
    "DADRA AND NAGAR HAVELI AND DAMAN AND DIU": map["DN"],
  };

  if (byName[s]) return byName[s];

  return null;
}

/* ---------------------------
   Validation helpers (create accepts state OR explicit pincodes)
--------------------------- */
function validateCreatePayload(body: any) {
  const errors: string[] = [];

  // parse explicit pincodes if provided
  const pFromSupplied = body?.pincodeFrom !== undefined ? parseAndValidatePincode(body.pincodeFrom) : null;
  const pToSupplied = body?.pincodeTo !== undefined ? parseAndValidatePincode(body.pincodeTo) : null;

  // If neither pincodes provided, require state (we will map it server-side)
  if (pFromSupplied === null && pToSupplied === null) {
    // allow state key
    if (!body?.state && !body?.stateCode) {
      errors.push("Provide either state (state/stateCode) OR pincodeFrom and pincodeTo");
    }
  }

  // If pincodes provided, validate them
  if (pFromSupplied !== null && pToSupplied !== null && pFromSupplied > pToSupplied) {
    errors.push("pincodeFrom must be <= pincodeTo");
  }

  const chargeRaw = body?.charge;
  if (chargeRaw === undefined || chargeRaw === null || String(chargeRaw).trim() === "") errors.push("charge is required");

  // minOrderValue optional but if present must be numeric-ish
  if (body?.minOrderValue !== undefined && body?.minOrderValue !== null) {
    const m = Number(String(body.minOrderValue));
    if (Number.isNaN(m)) errors.push("minOrderValue must be numeric or null");
  }

  return {
    errors,
    pFromSupplied,
    pToSupplied,
    charge: chargeRaw !== undefined && chargeRaw !== null ? String(chargeRaw) : null,
  };
}

/* ---------------------------
   Serializer
   - Ensures Decimal fields are stringified for safe client consumption
--------------------------- */
function serializeShippingRule(raw: any) {
  if (!raw) return raw;
  return {
    id: raw.id,
    name: raw.name ?? null,
    pincodeFrom: raw.pincodeFrom,
    pincodeTo: raw.pincodeTo,
    charge: raw.charge != null ? String(raw.charge) : null,
    minOrderValue: raw.minOrderValue != null ? String(raw.minOrderValue) : null,
    priority: raw.priority,
    isActive: raw.isActive,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

/* ---------------------------
   Helper: find active rule for a pincode (exported)
   - returns the rule (raw Prisma object) or null
--------------------------- */
export async function findActiveShippingRuleForPincode(pincode: number) {
  if (!Number.isInteger(pincode)) return null;
  const rule = await prisma.shippingRule.findFirst({
    where: {
      isActive: true,
      AND: [{ pincodeFrom: { lte: pincode } }, { pincodeTo: { gte: pincode } }],
    },
    orderBy: [{ priority: "desc" }, { id: "desc" }],
  });
  return rule ?? null;
}

/* ---------------------------
   Helper: compute shipping for a pincode and subtotal (exported)
   - returns { shipping: number, appliedRule: serializedRule | null }
   - shipping is 0 if subtotal >= minOrderValue (when minOrderValue present)
   - NOTE: returns shipping=0 when no rule found (you can change to null/default charge if desired)
--------------------------- */
export async function computeShippingForPincode(pincode: number, subtotal: number) {
  const rule = await findActiveShippingRuleForPincode(pincode);
  if (!rule) {
    // No rule — default shipping behaviour: return 0 here. Change as needed.
    return { shipping: 0, appliedRule: null };
  }

  const minOrderValue = rule.minOrderValue != null ? Number(String(rule.minOrderValue)) : null;
  const charge = rule.charge != null ? Number(String(rule.charge)) : 0;

  if (minOrderValue != null && Number.isFinite(subtotal) && subtotal >= minOrderValue) {
    return { shipping: 0, appliedRule: serializeShippingRule(rule) };
  }

  return { shipping: charge, appliedRule: serializeShippingRule(rule) };
}

/* ---------------------------
   LIST Shipping Rules
   GET /api/admin/shipping-rules
   supports optional pagination & filtering (isActive / q)
--------------------------- */
export const listShippingRules = async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    const q = (request.query as any).q as string | undefined;
    const isActiveQ = (request.query as any).isActive as string | undefined;
    const page = Math.max(parseInt(((request.query as any).page as string) || "1", 10), 1);
    const limit = Math.min(parseInt(((request.query as any).limit as string) || "50", 10), 500);

    const where: Prisma.ShippingRuleWhereInput = {
      ...(q ? { name: { contains: q, mode: "insensitive" } } : {}),
      ...(isActiveQ ? { isActive: isActiveQ === "true" } : {}),
    };

    const rules = await prisma.shippingRule.findMany({
      where,
      orderBy: [{ priority: "desc" }, { pincodeFrom: "asc" }],
      take: limit,
      skip: (page - 1) * limit,
    });

    const mapped = rules.map((r) => serializeShippingRule(r));
    return reply.send({ data: mapped });
  } catch (err: any) {
    safeLogError(request, err, "listShippingRules");
    return reply.code(500).send({ error: err?.message || "Internal error" });
  }
};

/* ---------------------------
   GET single Shipping Rule
   GET /api/admin/shipping-rules/:id
--------------------------- */
export const getShippingRule = async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    const params: any = request.params || {};
    const id = Number(params.id);
    if (!id) return reply.code(400).send({ error: "id required" });

    const rule = await prisma.shippingRule.findUnique({ where: { id } });
    if (!rule) return reply.code(404).send({ error: "Shipping rule not found" });

    return reply.send({ data: serializeShippingRule(rule) });
  } catch (err: any) {
    safeLogError(request, err, "getShippingRule");
    return reply.code(500).send({ error: err?.message || "Internal error" });
  }
};

/* ---------------------------
   CREATE Shipping Rule
   POST /api/admin/shipping-rules
   - accepts state OR explicit pincodeFrom/pincodeTo
   - warns if overlaps with active rule (doesn't block)
   - returns created object + optional overlap info
--------------------------- */
export const createShippingRule = async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    const body: any = request.body || {};
    const { errors, pFromSupplied, pToSupplied, charge } = validateCreatePayload(body);
    if (errors.length) return reply.code(400).send({ error: errors.join("; ") });

    // Determine final pFrom / pTo:
    let pFrom: number | null = pFromSupplied;
    let pTo: number | null = pToSupplied;

    if ((pFrom === null || pTo === null) && (body.state || body.stateCode)) {
      const range = stateToPincodeRange(body.state ?? body.stateCode);
      if (range) {
        pFrom = range[0];
        pTo = range[1];
      } else {
        return reply.code(400).send({ error: "Unknown state. Provide explicit pincodeFrom and pincodeTo." });
      }
    }

    if (pFrom === null || pTo === null) {
      return reply.code(400).send({ error: "pincodeFrom and pincodeTo required (or provide a recognized state)" });
    }
    if (pFrom > pTo) return reply.code(400).send({ error: "pincodeFrom must be <= pincodeTo" });

    // check overlap (active) for warning
    const overlapping = await prisma.shippingRule.findFirst({
      where: {
        isActive: true,
        AND: [{ pincodeFrom: { lte: pTo } }, { pincodeTo: { gte: pFrom } }],
      },
      orderBy: [{ priority: "desc" }, { id: "desc" }],
    });

    const created = await prisma.shippingRule.create({
      data: {
        name: body.name ?? (body.state ? `Shipping: ${String(body.state)}` : null),
        pincodeFrom: pFrom,
        pincodeTo: pTo,
        charge: String(charge),
        minOrderValue: body.minOrderValue !== undefined && body.minOrderValue !== null ? String(body.minOrderValue) : null,
        priority: body.priority !== undefined ? Number(body.priority) : 0,
        isActive: body.isActive !== undefined ? Boolean(body.isActive) : true,
      },
    });

    const resp: any = { data: serializeShippingRule(created) };
    if (overlapping) {
      resp.note = "There is an existing active rule that overlaps this range. Use priority to resolve overlaps.";
      resp.overlapWith = serializeShippingRule(overlapping);
    }

    return reply.code(201).send(resp);
  } catch (err: any) {
    safeLogError(request, err, "createShippingRule");
    return reply.code(500).send({ error: err?.message || "Internal error" });
  }
};

/* ---------------------------
   UPDATE Shipping Rule
   PUT /api/admin/shipping-rules/:id
   - accepts state (recomputes pincodeFrom/pincodeTo) or explicit pincodeFrom/pincodeTo
   - warns if update will overlap with other active rules
--------------------------- */
export const updateShippingRule = async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    const params: any = request.params || {};
    const id = Number(params.id);
    if (!id) return reply.code(400).send({ error: "id required" });

    const body: any = request.body || {};

    // Validate provided pin codes (if provided)
    const pFromProvided = body.pincodeFrom !== undefined ? parseAndValidatePincode(body.pincodeFrom) : undefined;
    const pToProvided = body.pincodeTo !== undefined ? parseAndValidatePincode(body.pincodeTo) : undefined;
    if (pFromProvided !== undefined && pFromProvided === null) return reply.code(400).send({ error: "Invalid pincodeFrom" });
    if (pToProvided !== undefined && pToProvided === null) return reply.code(400).send({ error: "Invalid pincodeTo" });
    if (pFromProvided !== undefined && pToProvided !== undefined && pFromProvided > pToProvided) return reply.code(400).send({ error: "pincodeFrom must be <= pincodeTo" });

    // We'll compute final pFrom/pTo if body.state provided and either pFrom or pTo missing
    let finalPFrom: number | undefined = pFromProvided;
    let finalPTo: number | undefined = pToProvided;

    if ((body.state || body.stateCode) && (finalPFrom === undefined || finalPTo === undefined)) {
      const range = stateToPincodeRange(body.state ?? body.stateCode);
      if (!range) {
        return reply.code(400).send({ error: "Unknown state. Provide explicit pincodeFrom and pincodeTo." });
      }
      finalPFrom = range[0];
      finalPTo = range[1];
    }

    // If neither state nor pin provided, we will leave pincodes unchanged (unless explicitly provided)
    if (finalPFrom !== undefined && finalPTo !== undefined && finalPFrom > finalPTo) {
      return reply.code(400).send({ error: "pincodeFrom must be <= pincodeTo" });
    }

    const updateData: any = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (finalPFrom !== undefined) updateData.pincodeFrom = finalPFrom;
    if (finalPTo !== undefined) updateData.pincodeTo = finalPTo;
    if (body.charge !== undefined) {
      if (String(body.charge).trim() === "") return reply.code(400).send({ error: "charge cannot be empty" });
      updateData.charge = String(body.charge);
    }
    if (body.minOrderValue !== undefined) updateData.minOrderValue = body.minOrderValue === null ? null : String(body.minOrderValue);
    if (body.priority !== undefined) updateData.priority = Number(body.priority);
    if (body.isActive !== undefined) updateData.isActive = Boolean(body.isActive);

    const before = await prisma.shippingRule.findUnique({ where: { id } });
    if (!before) return reply.code(404).send({ error: "Shipping rule not found" });

    // optional: if pincodeFrom/to updated and isActive true, warn about overlaps
    if ((updateData.pincodeFrom !== undefined || updateData.pincodeTo !== undefined) && (updateData.isActive === undefined ? before.isActive : updateData.isActive)) {
      const checkFrom = updateData.pincodeFrom !== undefined ? updateData.pincodeFrom : before.pincodeFrom;
      const checkTo = updateData.pincodeTo !== undefined ? updateData.pincodeTo : before.pincodeTo;
      const overlapping = await prisma.shippingRule.findFirst({
        where: {
          isActive: true,
          id: { not: id },
          AND: [{ pincodeFrom: { lte: checkTo } }, { pincodeTo: { gte: checkFrom } }],
        },
      });
      if (overlapping) {
        // include overlap info in response later
        updateData.__overlapWarning = serializeShippingRule(overlapping);
      }
    }

    const updated = await prisma.shippingRule.update({
      where: { id },
      data: {
        ...(updateData.name !== undefined ? { name: updateData.name } : undefined),
        ...(updateData.pincodeFrom !== undefined ? { pincodeFrom: updateData.pincodeFrom } : undefined),
        ...(updateData.pincodeTo !== undefined ? { pincodeTo: updateData.pincodeTo } : undefined),
        ...(updateData.charge !== undefined ? { charge: updateData.charge } : undefined),
        ...(updateData.minOrderValue !== undefined ? { minOrderValue: updateData.minOrderValue } : undefined),
        ...(updateData.priority !== undefined ? { priority: updateData.priority } : undefined),
        ...(updateData.isActive !== undefined ? { isActive: updateData.isActive } : undefined),
      },
    });

    const resp: any = { data: serializeShippingRule(updated) };
    if (updateData.__overlapWarning) {
      resp.note = "Overlap detected with another active rule";
      resp.overlapWith = updateData.__overlapWarning;
    }

    return reply.send(resp);
  } catch (err: any) {
    safeLogError(request, err, "updateShippingRule");
    if (err?.code === "P2025") return reply.code(404).send({ error: "Shipping rule not found" });
    return reply.code(500).send({ error: err?.message || "Internal error" });
  }
};

/* ---------------------------
   DELETE Shipping Rule (hard delete)
   DELETE /api/admin/shipping-rules/:id
   - We perform a safe transaction and return 204 on success
--------------------------- */
export const deleteShippingRule = async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    const params: any = request.params || {};
    const id = Number(params.id);
    if (!id) return reply.code(400).send({ error: "id required" });

    // We can consider soft-delete via isActive=false, but currently perform hard delete
    await prisma.$transaction(async (tx) => {
      // If you want to prevent deletion when other things depend on it, add checks here.
      await tx.shippingRule.delete({ where: { id } });
    });

    return reply.code(204).send();
  } catch (err: any) {
    safeLogError(request, err, "deleteShippingRule");
    if (err?.code === "P2025") return reply.code(404).send({ error: "Shipping rule not found" });
    return reply.code(500).send({ error: err?.message || "Internal error" });
  }
};

export default {
  listShippingRules,
  getShippingRule,
  createShippingRule,
  updateShippingRule,
  deleteShippingRule,
  // also expose helpers on default export for convenience:
  findActiveShippingRuleForPincode,
  computeShippingForPincode,
};
