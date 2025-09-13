import { FastifyRequest, FastifyReply } from "fastify";

const slugify = (str: string) =>
  str
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

// =========================
// 📜 Public: list categories
// GET /api/categories
// =========================
export const listCategories = async (req: FastifyRequest, reply: FastifyReply) => {
  const categories = await req.server.prisma.category.findMany({
    orderBy: { name: "asc" },
  });
  return reply.send({ categories });
};

// =========================
// 📜 Public: get by slug
// GET /api/categories/:slug
// =========================
export const getCategoryBySlug = async (req: FastifyRequest, reply: FastifyReply) => {
  const { slug } = req.params as { slug: string };
  const cat = await req.server.prisma.category.findUnique({ where: { slug } });
  if (!cat) return reply.code(404).send({ error: "Category not found" });
  return reply.send({ category: cat });
};

// =========================
// 🔐 Admin: create
// POST /api/admin/categories
// body: { name: string, description?: string }
// =========================
export const createCategory = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    const { name, description = "" } = (req.body ?? {}) as {
      name?: string;
      description?: string;
    };
    if (!name || !name.trim()) {
      return reply.code(400).send({ error: "Name is required" });
    }
    const cleanName = name.trim();

    // 🚫 Early guard to avoid P2002 on unique(name)
    const exists = await req.server.prisma.category.findUnique({
      where: { name: cleanName },
      select: { id: true },
    });
    if (exists) {
      return reply.code(409).send({ error: "Category name already exists" });
    }

    // Create with a temporary slug (can be base or empty)
    const base = slugify(cleanName);
    const created = await req.server.prisma.category.create({
      data: { name: cleanName, description, slug: base || "" },
      select: { id: true, name: true },
    });

    // Final slug guaranteed unique by appending id (e.g., "herbs-12")
    const finalSlug = base ? `${base}-${created.id}` : String(created.id);

    const updated = await req.server.prisma.category.update({
      where: { id: created.id },
      data: { slug: finalSlug },
      select: { id: true, name: true, slug: true, description: true, createdAt: true },
    });

    return reply.code(201).send({ message: "Category created", category: updated });
  } catch (err: any) {
    // If we still somehow race into a duplicate, map Prisma error to 409
    if (err?.code === "P2002" && err?.meta?.target?.includes("name")) {
      return reply.code(409).send({ error: "Category name already exists" });
    }
    req.log.error({ err }, "createCategory failed");
    return reply.code(500).send({ error: "Failed to create category" });
  }
};

// =========================
// 🔐 Admin: update
// PUT /api/admin/categories/:id
// body: { name?: string, slug?: string, description?: string }
// =========================
export const updateCategory = async (req: FastifyRequest, reply: FastifyReply) => {
  const { id } = req.params as { id: string };
  const body = (req.body ?? {}) as { name?: string; slug?: string; description?: string };

  const categoryId = Number(id);
  if (!Number.isFinite(categoryId)) {
    return reply.code(400).send({ error: "Invalid id" });
  }

  const existing = await req.server.prisma.category.findUnique({
    where: { id: categoryId },
  });
  if (!existing) return reply.code(404).send({ error: "Category not found" });

  let nextSlug = body.slug?.trim();
  if (!nextSlug && body.name?.trim()) {
    // Regenerate slug from new name, preserve -id suffix
    const base = slugify(body.name);
    nextSlug = `${base}-${existing.id}`;
  }

  try {
    const updated = await req.server.prisma.category.update({
      where: { id: existing.id },
      data: {
        name: body.name?.trim() ?? existing.name,
        slug: nextSlug ?? existing.slug,
        description: body.description ?? existing.description,
      },
    });
    return reply.send({ message: "Category updated", category: updated });
  } catch (err: any) {
    if (err?.code === "P2002" && err?.meta?.target?.includes("name")) {
      return reply.code(409).send({ error: "Category name already exists" });
    }
    if (err?.code === "P2002" && err?.meta?.target?.includes("slug")) {
      return reply.code(409).send({ error: "Category slug already exists" });
    }
    req.log.error({ err }, "updateCategory failed");
    return reply.code(500).send({ error: "Failed to update category" });
  }
};

// =========================
// 🔐 Admin: delete
// DELETE /api/admin/categories/:id
// =========================
export const deleteCategory = async (req: FastifyRequest, reply: FastifyReply) => {
  const { id } = req.params as { id: string };
  const categoryId = Number(id);
  if (!Number.isFinite(categoryId)) {
    return reply.code(400).send({ error: "Invalid id" });
  }

  // Optional: block delete if products exist
  const count = await req.server.prisma.product.count({
    where: { categoryId },
  });
  if (count > 0) {
    return reply.code(400).send({ error: "Cannot delete: category has products" });
  }

  await req.server.prisma.category.delete({ where: { id: categoryId } });
  return reply.send({ message: "Category deleted" });
};
