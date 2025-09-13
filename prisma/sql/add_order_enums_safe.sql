-- prisma/sql/add_order_enums_safe.sql
BEGIN;

-- 1) create enum types if they don't exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_status') THEN
    CREATE TYPE order_status AS ENUM ('pending','processing','shipped','delivered','cancelled','returned');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_status') THEN
    CREATE TYPE payment_status AS ENUM ('pending','paid','failed','refunded');
  END IF;
END$$;

-- 2) add temporary enum columns (nullable)
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS order_status_tmp order_status;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS payment_status_tmp payment_status;

-- 3) copy values from existing string columns into enum columns (safe mapping)
UPDATE "Order"
SET order_status_tmp =
  CASE lower("orderStatus")
    WHEN 'pending' THEN 'pending'::order_status
    WHEN 'processing' THEN 'processing'::order_status
    WHEN 'shipped' THEN 'shipped'::order_status
    WHEN 'delivered' THEN 'delivered'::order_status
    WHEN 'cancelled' THEN 'cancelled'::order_status
    WHEN 'returned' THEN 'returned'::order_status
    ELSE 'pending'::order_status
  END
WHERE "orderStatus" IS NOT NULL;

UPDATE "Order"
SET payment_status_tmp =
  CASE lower("paymentStatus")
    WHEN 'pending' THEN 'pending'::payment_status
    WHEN 'paid' THEN 'paid'::payment_status
    WHEN 'failed' THEN 'failed'::payment_status
    WHEN 'refunded' THEN 'refunded'::payment_status
    ELSE 'pending'::payment_status
  END
WHERE "paymentStatus" IS NOT NULL;

-- 4) add new fields (tracking + shippedAt)
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "trackingNumber" text;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "shippedAt" timestamp with time zone;

COMMIT;
