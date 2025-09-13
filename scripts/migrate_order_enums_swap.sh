#!/usr/bin/env bash
set -euo pipefail
DB="$DATABASE_URL"
echo "Swapping tmp columns -> final names on $DB"

psql "$DB" <<'SQL'
BEGIN;
-- drop old string columns if they exist
ALTER TABLE "Order" DROP COLUMN IF EXISTS "orderStatus";
ALTER TABLE "Order" DROP COLUMN IF EXISTS "paymentStatus";
-- rename tmp columns to final case-sensitive names expected by Prisma
ALTER TABLE "Order" RENAME COLUMN order_status_tmp TO "orderStatus";
ALTER TABLE "Order" RENAME COLUMN payment_status_tmp TO "paymentStatus";
-- create indexes (optional)
CREATE INDEX IF NOT EXISTS idx_order_orderStatus ON "Order" ("orderStatus");
CREATE INDEX IF NOT EXISTS idx_order_paymentStatus ON "Order" ("paymentStatus");
COMMIT;
SQL

echo "Swap complete. Verify columns:"
psql "$DB" -c '\d+"Order"'
