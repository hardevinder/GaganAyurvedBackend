"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.addBlog = exports.getBlogs = void 0;
// =========================
// 📚 Get All Blogs
// =========================
const getBlogs = async (req, reply) => {
    try {
        const blogs = await req.server.prisma.blog.findMany();
        return reply.status(200).send({
            message: "Blogs fetched successfully",
            blogs,
        });
    }
    catch (error) {
        return reply.status(500).send({
            error: "Failed to fetch blogs",
            details: error,
        });
    }
};
exports.getBlogs = getBlogs;
// =========================
// ✍️ Add a Blog (Admin Only)
// =========================
const addBlog = async (req, reply) => {
    try {
        const { title, content } = req.body;
        const blog = await req.server.prisma.blog.create({
            data: { title, content },
        });
        return reply.status(201).send({
            message: "Blog created successfully",
            blog,
        });
    }
    catch (error) {
        return reply.status(500).send({
            error: "Failed to create blog",
            details: error,
        });
    }
};
exports.addBlog = addBlog;
//# sourceMappingURL=blogController.js.map