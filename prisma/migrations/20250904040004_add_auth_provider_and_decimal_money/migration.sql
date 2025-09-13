-- USER changes
ALTER TABLE "User"
  ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'credentials',
  ADD COLUMN "avatar" TEXT,
  ALTER COLUMN "password" DROP NOT NULL;

-- Timestamps (safe backfill with defaults)
ALTER TABLE "User"    ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Blog"    ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Product" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Order"   ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Variant" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "OrderItem" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Money: Float -> Decimal (NUMERIC) with USING
ALTER TABLE "Variant"
  ALTER COLUMN "price" TYPE NUMERIC(10,2) USING "price"::numeric(10,2);

ALTER TABLE "Order"
  ALTER COLUMN "total" TYPE NUMERIC(12,2) USING "total"::numeric(12,2);

ALTER TABLE "OrderItem"
  ALTER COLUMN "price" TYPE NUMERIC(10,2) USING "price"::numeric(10,2);

-- Optional helpful indexes (match your schema intentions)
-- CREATE INDEX "User_provider_idx" ON "User"("provider");
-- CREATE INDEX "Product_categoryId_idx" ON "Product"("categoryId");
-- CREATE INDEX "Order_userId_idx" ON "Order"("userId");
-- CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");
-- CREATE INDEX "OrderItem_variantId_idx" ON "OrderItem"("variantId");
