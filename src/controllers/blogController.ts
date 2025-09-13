import { FastifyRequest, FastifyReply } from "fastify";

// =========================
// 📚 Get All Blogs
// =========================
export const getBlogs = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    const blogs = await req.server.prisma.blog.findMany();

    return reply.status(200).send({
      message: "Blogs fetched successfully",
      blogs,
    });
  } catch (error) {
    return reply.status(500).send({
      error: "Failed to fetch blogs",
      details: error,
    });
  }
};

// =========================
// ✍️ Add a Blog (Admin Only)
// =========================
export const addBlog = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    const { title, content } = req.body as any;

    const blog = await req.server.prisma.blog.create({
      data: { title, content },
    });

    return reply.status(201).send({
      message: "Blog created successfully",
      blog,
    });
  } catch (error) {
    return reply.status(500).send({
      error: "Failed to create blog",
      details: error,
    });
  }
};
