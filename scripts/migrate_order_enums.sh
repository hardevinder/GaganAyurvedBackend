#!/usr/bin/env bash
set -euo pipefail

DB="$DATABASE_URL"
echo "Using DB: $DB"

# Helper to run SQL and capture single-line trimmed output
run_sql_single() {
  local sql="$1"
  psql "$DB" -t -A -c "$sql"
}

echo "1) Check Order table exists and list columns..."
psql "$DB" -c '\d+"Order"' || psql "$DB" -c '\d+ "Order"' || true

echo
echo "2) Detect candidate source columns for orderStatus & paymentStatus..."
# Search lowercase table name to be robust for quoted/unquoted
ORDER_COL=$(run_sql_single "SELECT column_name FROM information_schema.columns WHERE lower(table_name) = 'order' AND column_name IN ('orderStatus','order_status','status') LIMIT 1;")
PAYMENT_COL=$(run_sql_single "SELECT column_name FROM information_schema.columns WHERE lower(table_name) = 'order' AND column_name IN ('paymentStatus','payment_status') LIMIT 1;")

echo "Detected order column: '${ORDER_COL:-<none>}'"
echo "Detected payment column: '${PAYMENT_COL:-<none>}'"

echo
echo "3) Create enum types if missing, add tmp columns, add tracking fields..."
psql "$DB" <<'SQL'
BEGIN;
-- create enums if not present
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_status') THEN
    CREATE TYPE order_status AS ENUM ('pending','processing','shipped','delivered','cancelled','returned');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_status') THEN
    CREATE TYPE payment_status AS ENUM ('pending','paid','failed','refunded');
  END IF;
END$$;

-- add tmp enum columns if not exist
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS order_status_tmp order_status;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS payment_status_tmp payment_status;

-- add tracking fields if not exist
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "trackingNumber" text;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "shippedAt" timestamp with time zone;

COMMIT;
SQL

echo "tmp enum columns and tracking fields ensured."
echo

# 4) If detected source columns exist, run mapping updates accordingly.
# Use appropriate quoting depending on uppercase/lowercase in DB.
if [ -n "$ORDER_COL" ]; then
  echo "Copying/mapping values from source order column: $ORDER_COL -> order_status_tmp"
  # construct SQL with proper quoting
  if [[ "$ORDER_COL" =~ [A-Z] ]]; then
    # column name has uppercase letters -> must be quoted
    SRC_ORDER_COL="\"$ORDER_COL\""
  else
    SRC_ORDER_COL="$ORDER_COL"
  fi

  psql "$DB" -c "UPDATE \"Order\" SET order_status_tmp = CASE lower($SRC_ORDER_COL)
    WHEN 'pending' THEN 'pending'::order_status
    WHEN 'processing' THEN 'processing'::order_status
    WHEN 'shipped' THEN 'shipped'::order_status
    WHEN 'delivered' THEN 'delivered'::order_status
    WHEN 'cancelled' THEN 'cancelled'::order_status
    WHEN 'returned' THEN 'returned'::order_status
    ELSE 'pending'::order_status END WHERE $SRC_ORDER_COL IS NOT NULL;"
else
  echo "No existing source orderStatus column found — will default tmp -> 'pending' later."
fi

if [ -n "$PAYMENT_COL" ]; then
  echo "Copying/mapping values from source payment column: $PAYMENT_COL -> payment_status_tmp"
  if [[ "$PAYMENT_COL" =~ [A-Z] ]]; then
    SRC_PAYMENT_COL="\"$PAYMENT_COL\""
  else
    SRC_PAYMENT_COL="$PAYMENT_COL"
  fi

  psql "$DB" -c "UPDATE \"Order\" SET payment_status_tmp = CASE lower($SRC_PAYMENT_COL)
    WHEN 'pending' THEN 'pending'::payment_status
    WHEN 'paid' THEN 'paid'::payment_status
    WHEN 'failed' THEN 'failed'::payment_status
    WHEN 'refunded' THEN 'refunded'::payment_status
    ELSE 'pending'::payment_status END WHERE $SRC_PAYMENT_COL IS NOT NULL;"
else
  echo "No existing source paymentStatus column found — will default tmp -> 'pending' later."
fi

echo
echo "5) Ensure tmp columns are populated (set defaults for NULL rows)..."
psql "$DB" -c "UPDATE \"Order\" SET order_status_tmp = 'pending'::order_status WHERE order_status_tmp IS NULL;"
psql "$DB" -c "UPDATE \"Order\" SET payment_status_tmp = 'pending'::payment_status WHERE payment_status_tmp IS NULL;"

echo "Counts after populate:"
psql "$DB" -c "SELECT count(*) AS total_orders, count(order_status_tmp) AS order_status_populated, count(payment_status_tmp) AS payment_status_populated FROM \"Order\";"
psql "$DB" -c "SELECT order_status_tmp, count(*) FROM \"Order\" GROUP BY order_status_tmp ORDER BY order_status_tmp;"
psql "$DB" -c "SELECT payment_status_tmp, count(*) FROM \"Order\" GROUP BY payment_status_tmp ORDER BY payment_status_tmp;"

echo
echo "6) READY: If results look correct, run swap to rename tmp => final (this will DROP old string columns)."
echo "   To perform the swap run: scripts/migrate_order_enums.sh --swap"
echo
echo "If you want to perform swap now, run this script with --swap"
