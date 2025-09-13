-- =========================
-- CATEGORY slug (safe order)
-- =========================
DO $$ BEGIN
  ALTER TABLE "Category" ADD COLUMN "slug" TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- backfill unique-ish slug from name + id
UPDATE "Category"
SET "slug" = LOWER(REGEXP_REPLACE("name", '[^a-zA-Z0-9]+', '-', 'g')) || '-' || "id"
WHERE "slug" IS NULL;

ALTER TABLE "Category" ALTER COLUMN "slug" SET NOT NULL;

DO $$ BEGIN
  ALTER TABLE "Category" ADD CONSTRAINT "Category_slug_key" UNIQUE ("slug");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =========================
-- PRODUCT slug (safe order)
-- =========================
DO $$ BEGIN
  ALTER TABLE "Product" ADD COLUMN "slug" TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- backfill from name + id (guarantees uniqueness)
UPDATE "Product"
SET "slug" = LOWER(REGEXP_REPLACE("name", '[^a-zA-Z0-9]+', '-', 'g')) || '-' || "id"
WHERE "slug" IS NULL;

ALTER TABLE "Product" ALTER COLUMN "slug" SET NOT NULL;

DO $$ BEGIN
  ALTER TABLE "Product" ADD CONSTRAINT "Product_slug_key" UNIQUE ("slug");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
