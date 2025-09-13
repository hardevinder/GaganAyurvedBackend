-- CreateTable
CREATE TABLE "ShippingRule" (
    "id" SERIAL PRIMARY KEY,
    "name" TEXT,
    "pincodeFrom" INTEGER NOT NULL,
    "pincodeTo" INTEGER NOT NULL,
    "charge" DECIMAL(10,2) NOT NULL,
    "minOrderValue" DECIMAL(12,2),
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- CreateIndex
CREATE INDEX "ShippingRule_pincodeFrom_pincodeTo_idx" ON "ShippingRule"("pincodeFrom", "pincodeTo");

-- CreateIndex
CREATE INDEX "ShippingRule_isActive_priority_idx" ON "ShippingRule"("isActive", "priority");
