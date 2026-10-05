import { PrismaClient } from '../app/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL! })
const prisma = new PrismaClient({ adapter })
import bcrypt from "bcryptjs";

// const prisma = new PrismaClient();

async function main() {
  const email = (process.env.DEMO_USER_EMAIL ?? "demo@shop.local").toLowerCase();
  const password = process.env.DEMO_USER_PASSWORD ?? "Demo1234!";
  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, name: "Demo Owner" },
    create: { email, passwordHash, name: "Demo Owner" },
  });

  const org = await prisma.organization.upsert({
    where: { slug: "demo-kitchen" },
    update: { name: "Demo Kitchen" },
    create: {
      name: "Demo Kitchen",
      slug: "demo-kitchen",
      currency: "PKR",
      whatsapp: { create: { status: "disconnected" } },
    },
  });

  await prisma.membership.upsert({
    where: { userId_organizationId: { userId: user.id, organizationId: org.id } },
    update: { role: "OWNER" },
    create: { userId: user.id, organizationId: org.id, role: "OWNER" },
  });

  const products = await Promise.all([
    prisma.product.create({
      data: {
        organizationId: org.id,
        name: "Chicken Biryani",
        description: "Family tray",
        priceMinor: 85000,
        sku: "BIRYANI",
      },
    }),
    prisma.product.create({
      data: {
        organizationId: org.id,
        name: "Naan",
        description: "Tandoor naan",
        priceMinor: 4000,
        sku: "NAAN",
      },
    }),
  ]);

  const customer = await prisma.customer.create({
    data: {
      organizationId: org.id,
      waId: "923001112233",
      displayName: "Ayesha Khan",
      notes: "Prefers evening delivery",
    },
  });

  await prisma.order.create({
    data: {
      organizationId: org.id,
      customerId: customer.id,
      status: "PENDING",
      source: "WHATSAPP",
      notes: "No extra spice",
      totalMinor: 89000,
      currency: "PKR",
      items: {
        create: [
          {
            productId: products[0].id,
            nameSnapshot: "Chicken Biryani",
            unitPriceMinor: 85000,
            qty: 1,
          },
          {
            productId: products[1].id,
            nameSnapshot: "Naan",
            unitPriceMinor: 4000,
            qty: 1,
          },
        ],
      },
      events: {
        create: { toStatus: "PENDING", actorUserId: user.id, meta: { source: "seed" } },
      },
    },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
