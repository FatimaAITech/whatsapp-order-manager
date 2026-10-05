import type { OrderSource, OrderStatus, Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/db/prisma";
import { AppError } from "@/lib/errors";
import { canTransition } from "@/lib/orders/transition";
import type {
  CustomerRecord,
  DashboardStats,
  OrderFilters,
  OrderRecord,
  OrderWriteInput,
  ProductRecord,
  SessionUser,
  WhatsAppRecord,
} from "@/lib/data/types";
import bcrypt from "bcryptjs";

function money(n: number) {
  return Math.round(n);
}

function mapProduct(p: {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  priceMinor: number;
  currency: string;
  sku: string | null;
  isActive: boolean;
  deletedAt: Date | null;
  createdAt: Date;
}): ProductRecord {
  return {
    ...p,
    deletedAt: p.deletedAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
  };
}

function mapCustomer(c: {
  id: string;
  organizationId: string;
  waId: string;
  displayName: string;
  notes: string | null;
  lastMessageAt: Date | null;
  createdAt: Date;
}): CustomerRecord {
  return {
    ...c,
    lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
  };
}

function mapOrder(order: {
  id: string;
  organizationId: string;
  customerId: string;
  status: OrderStatus;
  source: OrderSource;
  notes: string | null;
  needsReview: boolean;
  totalMinor: number;
  currency: string;
  externalMessageId: string | null;
  createdAt: Date;
  updatedAt: Date;
  customer?: Parameters<typeof mapCustomer>[0];
  items?: {
    id: string;
    orderId: string;
    productId: string | null;
    nameSnapshot: string;
    unitPriceMinor: number;
    qty: number;
  }[];
  events?: {
    id: string;
    orderId: string;
    fromStatus: OrderStatus | null;
    toStatus: OrderStatus;
    actorUserId: string | null;
    meta: Prisma.JsonValue | null;
    createdAt: Date;
  }[];
}): OrderRecord {
  return {
    id: order.id,
    organizationId: order.organizationId,
    customerId: order.customerId,
    status: order.status,
    source: order.source,
    notes: order.notes,
    needsReview: order.needsReview,
    totalMinor: order.totalMinor,
    currency: order.currency,
    externalMessageId: order.externalMessageId,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    customer: order.customer ? mapCustomer(order.customer) : undefined,
    items: order.items,
    events: order.events?.map((e) => ({
      id: e.id,
      orderId: e.orderId,
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
      actorUserId: e.actorUserId,
      meta: (e.meta as Record<string, unknown> | null) ?? null,
      createdAt: e.createdAt.toISOString(),
    })),
  };
}

function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "shop";
}

export const prismaStore = {
  async authenticate(email: string, password: string): Promise<SessionUser | null> {
    const prisma = getPrisma();
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: { memberships: { include: { organization: true } } },
    });
    if (!user) return null;
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return null;
    const membership = user.memberships[0];
    if (!membership) return null;
    return {
      userId: user.id,
      orgId: membership.organizationId,
      role: membership.role,
      email: user.email,
      name: user.name,
      orgName: membership.organization.name,
      currency: membership.organization.currency,
    };
  },

  async signup(input: {
    name: string;
    email: string;
    password: string;
    organizationName: string;
  }): Promise<SessionUser> {
    const prisma = getPrisma();
    const existing = await prisma.user.findUnique({
      where: { email: input.email.toLowerCase() },
    });
    if (existing) throw new AppError("CONFLICT", "An account with that email already exists.", 409);
    const user = await prisma.user.create({
      data: {
        name: input.name,
        email: input.email.toLowerCase(),
        passwordHash: await bcrypt.hash(input.password, 10),
        memberships: {
          create: {
            role: "OWNER",
            organization: {
              create: {
                name: input.organizationName,
                slug: `${slugify(input.organizationName)}-${crypto.randomUUID().slice(0, 6)}`,
                whatsapp: { create: { status: "disconnected" } },
              },
            },
          },
        },
      },
      include: { memberships: { include: { organization: true } } },
    });
    const membership = user.memberships[0];
    return {
      userId: user.id,
      orgId: membership.organizationId,
      role: membership.role,
      email: user.email,
      name: user.name,
      orgName: membership.organization.name,
      currency: membership.organization.currency,
    };
  },

  async getStats(orgId: string): Promise<DashboardStats> {
    const prisma = getPrisma();
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const [totalOrders, todayOrders, grouped, revenue, productCount, customerCount] =
      await Promise.all([
        prisma.order.count({ where: { organizationId: orgId } }),
        prisma.order.count({ where: { organizationId: orgId, createdAt: { gte: start } } }),
        prisma.order.groupBy({
          by: ["status"],
          where: { organizationId: orgId },
          _count: { _all: true },
        }),
        prisma.order.aggregate({
          where: { organizationId: orgId, status: { not: "CANCELLED" } },
          _sum: { totalMinor: true },
        }),
        prisma.product.count({ where: { organizationId: orgId, deletedAt: null } }),
        prisma.customer.count({ where: { organizationId: orgId } }),
      ]);
    const byStatus = {
      PENDING: 0,
      CONFIRMED: 0,
      PROCESSING: 0,
      SHIPPED: 0,
      DELIVERED: 0,
      CANCELLED: 0,
    } as Record<OrderStatus, number>;
    for (const row of grouped) byStatus[row.status] = row._count._all;
    return {
      totalOrders,
      todayOrders,
      revenueMinor: revenue._sum.totalMinor ?? 0,
      byStatus,
      productCount,
      customerCount,
    };
  },

  async listOrders(orgId: string, filters: OrderFilters): Promise<OrderRecord[]> {
    const prisma = getPrisma();
    const q = filters.q?.trim();
    const orders = await prisma.order.findMany({
      where: {
        organizationId: orgId,
        status: filters.status && filters.status !== "ALL" ? filters.status : undefined,
        source: filters.source && filters.source !== "ALL" ? filters.source : undefined,
        ...(q
          ? {
              OR: [
                { notes: { contains: q, mode: "insensitive" } },
                { customer: { displayName: { contains: q, mode: "insensitive" } } },
                { customer: { waId: { contains: q } } },
              ],
            }
          : {}),
      },
      include: { customer: true, items: true },
      orderBy: { createdAt: "desc" },
    });
    return orders.map(mapOrder);
  },

  async getOrder(orgId: string, orderId: string): Promise<OrderRecord | null> {
    const prisma = getPrisma();
    const order = await prisma.order.findFirst({
      where: { id: orderId, organizationId: orgId },
      include: { customer: true, items: true, events: { orderBy: { createdAt: "asc" } } },
    });
    return order ? mapOrder(order) : null;
  },

  async createOrder(orgId: string, actorUserId: string, input: OrderWriteInput): Promise<OrderRecord> {
    const prisma = getPrisma();
    const customer = await prisma.customer.findFirst({
      where: { id: input.customerId, organizationId: orgId },
    });
    if (!customer) throw new AppError("NOT_FOUND", "Customer not found.", 404);
    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    const totalMinor = input.items.reduce(
      (sum, item) => sum + money(item.unitPriceMinor) * item.qty,
      0,
    );
    const order = await prisma.order.create({
      data: {
        organizationId: orgId,
        customerId: customer.id,
        notes: input.notes || null,
        source: input.source ?? "MANUAL",
        needsReview: input.needsReview ?? false,
        externalMessageId: input.externalMessageId,
        totalMinor,
        currency: org?.currency ?? "PKR",
        items: {
          create: input.items.map((item) => ({
            productId: item.productId || null,
            nameSnapshot: item.name,
            unitPriceMinor: money(item.unitPriceMinor),
            qty: item.qty,
          })),
        },
        events: {
          create: {
            toStatus: "PENDING",
            actorUserId,
            meta: { source: input.source ?? "MANUAL" },
          },
        },
      },
      include: { customer: true, items: true, events: true },
    });
    return mapOrder(order);
  },

  async updateOrder(orgId: string, orderId: string, input: OrderWriteInput): Promise<OrderRecord> {
    const prisma = getPrisma();
    const existing = await prisma.order.findFirst({ where: { id: orderId, organizationId: orgId } });
    if (!existing) throw new AppError("NOT_FOUND", "Order not found.", 404);
    if (existing.status === "DELIVERED" || existing.status === "CANCELLED") {
      throw new AppError("CONFLICT", "Terminal orders cannot be edited.", 409);
    }
    const customer = await prisma.customer.findFirst({
      where: { id: input.customerId, organizationId: orgId },
    });
    if (!customer) throw new AppError("NOT_FOUND", "Customer not found.", 404);
    const totalMinor = input.items.reduce(
      (sum, item) => sum + money(item.unitPriceMinor) * item.qty,
      0,
    );
    await prisma.orderItem.deleteMany({ where: { orderId } });
    const order = await prisma.order.update({
      where: { id: orderId },
      data: {
        customerId: customer.id,
        notes: input.notes || null,
        totalMinor,
        items: {
          create: input.items.map((item) => ({
            productId: item.productId || null,
            nameSnapshot: item.name,
            unitPriceMinor: money(item.unitPriceMinor),
            qty: item.qty,
          })),
        },
      },
      include: { customer: true, items: true, events: true },
    });
    return mapOrder(order);
  },

  async transitionOrder(
    orgId: string,
    orderId: string,
    toStatus: OrderStatus,
    actorUserId: string,
  ): Promise<OrderRecord> {
    const prisma = getPrisma();
    const existing = await prisma.order.findFirst({ where: { id: orderId, organizationId: orgId } });
    if (!existing) throw new AppError("NOT_FOUND", "Order not found.", 404);
    if (!canTransition(existing.status, toStatus)) {
      throw new AppError("CONFLICT", `Cannot move from ${existing.status} to ${toStatus}.`, 409);
    }
    const order = await prisma.order.update({
      where: { id: orderId },
      data: {
        status: toStatus,
        events: {
          create: {
            fromStatus: existing.status,
            toStatus,
            actorUserId,
            meta: {},
          },
        },
      },
      include: { customer: true, items: true, events: true },
    });
    return mapOrder(order);
  },

  async listProducts(orgId: string): Promise<ProductRecord[]> {
    const prisma = getPrisma();
    const products = await prisma.product.findMany({
      where: { organizationId: orgId, deletedAt: null },
      orderBy: { name: "asc" },
    });
    return products.map(mapProduct);
  },

  async getProduct(orgId: string, productId: string): Promise<ProductRecord | null> {
    const prisma = getPrisma();
    const product = await prisma.product.findFirst({
      where: { id: productId, organizationId: orgId, deletedAt: null },
    });
    return product ? mapProduct(product) : null;
  },

  async findProductBySku(orgId: string, sku: string): Promise<ProductRecord | null> {
    const prisma = getPrisma();
    const product = await prisma.product.findFirst({
      where: {
        organizationId: orgId,
        deletedAt: null,
        isActive: true,
        sku: { equals: sku, mode: "insensitive" },
      },
    });
    return product ? mapProduct(product) : null;
  },

  async upsertProduct(
    orgId: string,
    input: Omit<ProductRecord, "id" | "organizationId" | "createdAt" | "deletedAt"> & {
      id?: string;
    },
  ): Promise<ProductRecord> {
    const prisma = getPrisma();
    if (input.id) {
      const existing = await prisma.product.findFirst({
        where: { id: input.id, organizationId: orgId },
      });
      if (!existing) throw new AppError("NOT_FOUND", "Product not found.", 404);
      return mapProduct(
        await prisma.product.update({
          where: { id: input.id },
          data: {
            name: input.name,
            description: input.description,
            priceMinor: input.priceMinor,
            currency: input.currency,
            sku: input.sku,
            isActive: input.isActive,
          },
        }),
      );
    }
    return mapProduct(
      await prisma.product.create({
        data: {
          organizationId: orgId,
          name: input.name,
          description: input.description,
          priceMinor: input.priceMinor,
          currency: input.currency,
          sku: input.sku,
          isActive: input.isActive,
        },
      }),
    );
  },

  async softDeleteProduct(orgId: string, productId: string) {
    const prisma = getPrisma();
    const existing = await prisma.product.findFirst({
      where: { id: productId, organizationId: orgId },
    });
    if (!existing) throw new AppError("NOT_FOUND", "Product not found.", 404);
    await prisma.product.update({
      where: { id: productId },
      data: { deletedAt: new Date(), isActive: false },
    });
  },

  async listCustomers(orgId: string, q?: string): Promise<CustomerRecord[]> {
    const prisma = getPrisma();
    const query = q?.trim();
    const customers = await prisma.customer.findMany({
      where: {
        organizationId: orgId,
        ...(query
          ? {
              OR: [
                { displayName: { contains: query, mode: "insensitive" } },
                { waId: { contains: query } },
              ],
            }
          : {}),
      },
      orderBy: { displayName: "asc" },
    });
    return customers.map(mapCustomer);
  },

  async getCustomer(orgId: string, customerId: string): Promise<CustomerRecord | null> {
    const prisma = getPrisma();
    const customer = await prisma.customer.findFirst({
      where: { id: customerId, organizationId: orgId },
    });
    return customer ? mapCustomer(customer) : null;
  },

  async findCustomerByWaId(orgId: string, waId: string): Promise<CustomerRecord | null> {
    const prisma = getPrisma();
    const normalized = waId.replace(/\D/g, "");
    const customer = await prisma.customer.findFirst({
      where: { organizationId: orgId, waId: normalized },
    });
    return customer ? mapCustomer(customer) : null;
  },

  async upsertCustomer(
    orgId: string,
    input: { id?: string; displayName: string; waId: string; notes?: string | null },
  ): Promise<CustomerRecord> {
    const prisma = getPrisma();
    const waId = input.waId.replace(/\D/g, "");
    if (input.id) {
      const existing = await prisma.customer.findFirst({
        where: { id: input.id, organizationId: orgId },
      });
      if (!existing) throw new AppError("NOT_FOUND", "Customer not found.", 404);
      try {
        return mapCustomer(
          await prisma.customer.update({
            where: { id: input.id },
            data: { displayName: input.displayName, waId, notes: input.notes ?? null },
          }),
        );
      } catch {
        throw new AppError("CONFLICT", "A customer with that phone already exists.", 409);
      }
    }
    const byPhone = await prisma.customer.findFirst({
      where: { organizationId: orgId, waId },
    });
    if (byPhone) {
      return mapCustomer(
        await prisma.customer.update({
          where: { id: byPhone.id },
          data: {
            displayName: input.displayName,
            notes: input.notes ?? byPhone.notes,
            lastMessageAt: new Date(),
          },
        }),
      );
    }
    return mapCustomer(
      await prisma.customer.create({
        data: {
          organizationId: orgId,
          waId,
          displayName: input.displayName,
          notes: input.notes ?? null,
          lastMessageAt: new Date(),
        },
      }),
    );
  },

  async getWhatsApp(orgId: string): Promise<WhatsAppRecord | null> {
    const prisma = getPrisma();
    return prisma.whatsAppConnection.findUnique({ where: { organizationId: orgId } });
  },

  async findOrgByPhoneNumberId(phoneNumberId: string): Promise<string | null> {
    const prisma = getPrisma();
    const row = await prisma.whatsAppConnection.findUnique({ where: { phoneNumberId } });
    return row?.organizationId ?? null;
  },

  async upsertWhatsApp(orgId: string, patch: Partial<WhatsAppRecord>): Promise<WhatsAppRecord> {
    const prisma = getPrisma();
    return prisma.whatsAppConnection.upsert({
      where: { organizationId: orgId },
      create: {
        organizationId: orgId,
        wabaId: patch.wabaId ?? null,
        phoneNumberId: patch.phoneNumberId ?? null,
        encryptedAccessToken: patch.encryptedAccessToken ?? null,
        webhookVerifyToken: patch.webhookVerifyToken ?? null,
        status: patch.status ?? "disconnected",
      },
      update: {
        wabaId: patch.wabaId,
        phoneNumberId: patch.phoneNumberId,
        encryptedAccessToken: patch.encryptedAccessToken,
        webhookVerifyToken: patch.webhookVerifyToken,
        status: patch.status,
      },
    });
  },

  async updateOrg(orgId: string, patch: { name: string; currency: string }) {
    const prisma = getPrisma();
    await prisma.organization.update({
      where: { id: orgId },
      data: patch,
    });
  },

  async hasProcessedWebhook(messageId: string): Promise<boolean> {
    const prisma = getPrisma();
    const row = await prisma.processedWebhook.findUnique({ where: { messageId } });
    return Boolean(row);
  },

  async markProcessedWebhook(messageId: string) {
    const prisma = getPrisma();
    await prisma.processedWebhook.upsert({
      where: { messageId },
      create: { messageId },
      update: {},
    });
  },
};
