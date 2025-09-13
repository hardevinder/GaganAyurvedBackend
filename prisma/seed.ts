import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function main() {
  // ✅ Clear existing data (safe for dev only)
  await prisma.order.deleteMany();
  await prisma.blog.deleteMany();
  await prisma.product.deleteMany();
  await prisma.user.deleteMany();

  // ✅ Create users
  const adminPassword = await bcrypt.hash("admin123", 10);
  const userPassword = await bcrypt.hash("user123", 10);

  await prisma.user.create({
    data: {
      name: "Admin",
      email: "admin@example.com",
      password: adminPassword,
      isAdmin: true,
    },
  });

  const user = await prisma.user.create({
    data: {
      name: "Regular User",
      email: "user@example.com",
      password: userPassword,
      isAdmin: false,
    },
  });

  // ✅ Create products
  await prisma.product.createMany({
    data: [
      {
        name: "Ashwagandha Capsules",
        description: "Boosts energy, reduces stress, supports immunity.",
        price: 299,
        imageUrl: "https://example.com/ashwagandha.jpg",
      },
      {
        name: "Triphala Powder",
        description: "Supports digestion and detoxification.",
        price: 199,
        imageUrl: "https://example.com/triphala.jpg",
      },
      {
        name: "Neem Oil",
        description: "Natural skin and hair care solution.",
        price: 149,
        imageUrl: "https://example.com/neem-oil.jpg",
      },
    ],
  });

  // ✅ Create blogs
  await prisma.blog.createMany({
    data: [
      {
        title: "Top 5 Ayurvedic Herbs for Daily Health",
        content:
          "Ayurveda has a rich tradition of herbs like Ashwagandha, Triphala, and Neem that help in boosting immunity, digestion, and overall wellness.",
      },
      {
        title: "Ayurveda & Modern Lifestyle",
        content:
          "Balancing modern lifestyle with Ayurveda can help reduce stress, improve sleep quality, and boost productivity naturally.",
      },
    ],
  });

  // ✅ Create a sample order for Regular User
  await prisma.order.create({
    data: {
      userId: user.id,
      items: [
        { product: "Ashwagandha Capsules", quantity: 2 },
        { product: "Neem Oil", quantity: 1 },
      ],
      total: 747, // 2*299 + 149
    } as any, // Prisma JSON field
  });

  console.log("✅ Seed data inserted successfully!");
}

main()
  .catch((e) => {
    console.error("❌ Error seeding data:", e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
