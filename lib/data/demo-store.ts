import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import bcrypt from "bcryptjs";
import type { MemberRole, OrderSource, OrderStatus } from "@/app/generated/prisma/client";
import { demoCredentials } from "@/lib/config";
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

type UserRow = {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
};

type MembershipRow = {
  userId: string;
  organizationId: string;
  role: MemberRole;
};

type OrgRow = {
  id: string;
  name: string;
  slug: string;
  currency: string;
};

type DemoState = {
  users: UserRow[];
  orgs: OrgRow[];
  memberships: MembershipRow[];
  products: ProductRecord[];
  customers: CustomerRecord[];
  orders: OrderRecord[];
  whatsapp: WhatsAppRecord[];
  processedWebhooks: string[];
};

const filePath = path.join(process.cwd(), "data", "demo-store.json");

let memory: DemoState | null = null;
let writeQueue: Promise<void> = Promise.resolve();

function nowIso() {
  return new Date().toISOString();
}

function id() {
  return crypto.randomUUID();
}

function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "shop";
}

async function emptyState(): Promise<DemoState> {
  const creds = demoCredentials();
  const passwordHash = await bcrypt.hash(creds.password, 10);
  const orgId = "org-demo";
  const userId = "user-demo";
  const customers: CustomerRecord[] = [
    {
      id: "cust-1",
      organizationId: orgId,
      waId: "923001112233",
      displayName: "Ayesha Khan",
      notes: "Prefers evening delivery",
      lastMessageAt: nowIso(),
      createdAt: nowIso(),
    },
    {
      id: "cust-2",
      organizationId: orgId,
      waId: "923004445566",
      displayName: "Bilal Ahmed",
      notes: null,
      lastMessageAt: nowIso(),
      createdAt: nowIso(),
    },
  ];
  const products: ProductRecord[] = [
    {
      id: "prod-1",
      organizationId: orgId,
      name: "Chicken Biryani",
      description: "Family tray",
      priceMinor: 85000,
      currency: "PKR",
      sku: "BIRYANI",
      isActive: true,
      deletedAt: null,
      createdAt: nowIso(),
    },
    {
      id: "prod-2",
      organizationId: orgId,
      name: "Naan",
      description: "Tandoor naan",
      priceMinor: 4000,
      currency: "PKR",
      sku: "NAAN",
      isActive: true,
      deletedAt: null,
      createdAt: nowIso(),
    },
    {
      id: "prod-3",
      organizationId: orgId,
      name: "Mango Lassi",
      description: "16 oz",
      priceMinor: 18000,
      currency: "PKR",
      sku: "LASSI",
      isActive: true,
      deletedAt: null,
      createdAt: nowIso(),
    },
  ];
  const order: OrderRecord = {
    id: "order-1",
    organizationId: orgId,
    customerId: "cust-1",
    status: "PENDING",
    source: "WHATSAPP",
    notes: "No extra spice",
    needsReview: false,
    totalMinor: 93000,
    currency: "PKR",
    externalMessageId: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    items: [
      {
        id: "item-1",
        orderId: "order-1",
        productId: "prod-1",
        nameSnapshot: "Chicken Biryani",
        unitPriceMinor: 85000,
        qty: 1,
      },
      {
        id: "item-2",
        orderId: "order-1",
        productId: "prod-2",
        nameSnapshot: "Naan",
        unitPriceMinor: 4000,
        qty: 2,
      },
    ],
    events: [
      {
        id: "evt-1",
        orderId: "order-1",
        fromStatus: null,
        toStatus: "PENDING",
        actorUserId: userId,
        meta: { source: "seed" },
        createdAt: nowIso(),
      },
    ],
  };
  return {
    users: [
      {
        id: userId,
        email: creds.email.toLowerCase(),
        passwordHash,
        name: "Demo Owner",
      },
    ],
    orgs: [{ id: orgId, name: "Demo Kitchen", slug: "demo-kitchen", currency: "PKR" }],
    memberships: [{ userId, organizationId: orgId, role: "OWNER" }],
    products,
    customers,
    orders: [order],
    whatsapp: [
      {
        id: "wa-1",
        organizationId: orgId,
        wabaId: null,
        phoneNumberId: null,
        encryptedAccessToken: null,
        webhookVerifyToken: process.env.WHATSAPP_VERIFY_TOKEN ?? "demo-verify",
        status: "disconnected",
      },
    ],
    processedWebhooks: [],
  };
}

async function load(): Promise<DemoState> {
  if (memory) return memory;
  try {
    const raw = await readFile(filePath, "utf8");
    memory = JSON.parse(raw) as DemoState;
    return memory;
  } catch {
    memory = await emptyState();
    await persist(memory);
    return memory;
  }
}

async function persist(state: DemoState) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(state, null, 2), "utf8");
}

function queueWrite(mutator: (state: DemoState) => void | Promise<void>) {
  writeQueue = writeQueue.then(async () => {
    const state = await load();
    await mutator(state);
    await persist(state);
  });
  return writeQueue;
}

function withCustomer(state: DemoState, order: OrderRecord): OrderRecord {
  const customer = state.customers.find((c) => c.id === order.customerId);
  return { ...order, customer, items: order.items ?? [], events: order.events ?? [] };
}

export const demoStore = {
  async authenticate(email: string, password: string): Promise<SessionUser | null> {
    const state = await load();
    const user = state.users.find((u) => u.email === email.toLowerCase());
    if (!user) return null;
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return null;
    const membership = state.memberships.find((m) => m.userId === user.id);
    const org = state.orgs.find((o) => o.id === membership?.organizationId);
    if (!membership || !org) return null;
    return {
      userId: user.id,
      orgId: org.id,
      role: membership.role,
      email: user.email,
      name: user.name,
      orgName: org.name,
      currency: org.currency,
    };
  },

  async signup(input: {
    name: string;
    email: string;
    password: string;
    organizationName: string;
  }): Promise<SessionUser> {
    let created: SessionUser | null = null;
    await queueWrite(async (state) => {
      if (state.users.some((u) => u.email === input.email.toLowerCase())) {
        throw new AppError("CONFLICT", "An account with that email already exists.", 409);
      }
      const userId = id();
      const orgId = id();
      state.users.push({
        id: userId,
        email: input.email.toLowerCase(),
        passwordHash: await bcrypt.hash(input.password, 10),
        name: input.name,
      });
      state.orgs.push({
        id: orgId,
        name: input.organizationName,
        slug: `${slugify(input.organizationName)}-${orgId.slice(0, 6)}`,
        currency: "PKR",
      });
      state.memberships.push({ userId, organizationId: orgId, role: "OWNER" });
      state.whatsapp.push({
        id: id(),
        organizationId: orgId,
        wabaId: null,
        phoneNumberId: null,
        encryptedAccessToken: null,
        webhookVerifyToken: null,
        status: "disconnected",
      });
      created = {
        userId,
        orgId,
        role: "OWNER",
        email: input.email.toLowerCase(),
        name: input.name,
        orgName: input.organizationName,
        currency: "PKR",
      };
    });
    if (!created) throw new AppError("INTERNAL", "Signup failed.", 500);
    return created;
  },

  async getStats(orgId: string): Promise<DashboardStats> {
    const state = await load();
    const orders = state.orders.filter((o) => o.organizationId === orgId);
    const today = new Date().toISOString().slice(0, 10);
    const byStatus = {
      PENDING: 0,
      CONFIRMED: 0,
      PROCESSING: 0,
      SHIPPED: 0,
      DELIVERED: 0,
      CANCELLED: 0,
    } as Record<OrderStatus, number>;
    for (const order of orders) byStatus[order.status] += 1;
    return {
      totalOrders: orders.length,
      todayOrders: orders.filter((o) => o.createdAt.startsWith(today)).length,
      revenueMinor: orders
        .filter((o) => o.status !== "CANCELLED")
        .reduce((sum, o) => sum + o.totalMinor, 0),
      byStatus,
      productCount: state.products.filter((p) => p.organizationId === orgId && !p.deletedAt).length,
      customerCount: state.customers.filter((c) => c.organizationId === orgId).length,
    };
  },

  async listOrders(orgId: string, filters: OrderFilters): Promise<OrderRecord[]> {
    const state = await load();
    const q = filters.q?.toLowerCase().trim();
    return state.orders
      .filter((o) => o.organizationId === orgId)
      .filter((o) => !filters.status || filters.status === "ALL" || o.status === filters.status)
      .filter((o) => !filters.source || filters.source === "ALL" || o.source === filters.source)
      .map((o) => withCustomer(state, o))
      .filter((o) => {
        if (!q) return true;
        return (
          o.id.toLowerCase().includes(q) ||
          o.customer?.displayName.toLowerCase().includes(q) ||
          o.customer?.waId.includes(q) ||
          (o.notes ?? "").toLowerCase().includes(q)
        );
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async getOrder(orgId: string, orderId: string): Promise<OrderRecord | null> {
    const state = await load();
    const order = state.orders.find((o) => o.id === orderId && o.organizationId === orgId);
    return order ? withCustomer(state, order) : null;
  },

  async createOrder(orgId: string, actorUserId: string, input: OrderWriteInput): Promise<OrderRecord> {
    let created: OrderRecord | null = null;
    await queueWrite((state) => {
      const customer = state.customers.find(
        (c) => c.id === input.customerId && c.organizationId === orgId,
      );
      if (!customer) throw new AppError("NOT_FOUND", "Customer not found.", 404);
      const orderId = id();
      const items = input.items.map((item) => ({
        id: id(),
        orderId,
        productId: item.productId ?? null,
        nameSnapshot: item.name,
        unitPriceMinor: item.unitPriceMinor,
        qty: item.qty,
      }));
      const totalMinor = items.reduce((sum, item) => sum + item.unitPriceMinor * item.qty, 0);
      const order: OrderRecord = {
        id: orderId,
        organizationId: orgId,
        customerId: customer.id,
        status: "PENDING",
        source: input.source ?? "MANUAL",
        notes: input.notes || null,
        needsReview: input.needsReview ?? false,
        totalMinor,
        currency: state.orgs.find((o) => o.id === orgId)?.currency ?? "PKR",
        externalMessageId: input.externalMessageId ?? null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        items,
        events: [
          {
            id: id(),
            orderId,
            fromStatus: null,
            toStatus: "PENDING",
            actorUserId,
            meta: { source: input.source ?? "MANUAL" },
            createdAt: nowIso(),
          },
        ],
      };
      state.orders.push(order);
      created = order;
    });
    if (!created) throw new AppError("INTERNAL", "Could not create order.", 500);
    return created;
  },

  async updateOrder(orgId: string, orderId: string, input: OrderWriteInput): Promise<OrderRecord> {
    let updated: OrderRecord | null = null;
    await queueWrite((state) => {
      const order = state.orders.find((o) => o.id === orderId && o.organizationId === orgId);
      if (!order) throw new AppError("NOT_FOUND", "Order not found.", 404);
      if (order.status === "DELIVERED" || order.status === "CANCELLED") {
        throw new AppError("CONFLICT", "Terminal orders cannot be edited.", 409);
      }
      const customer = state.customers.find(
        (c) => c.id === input.customerId && c.organizationId === orgId,
      );
      if (!customer) throw new AppError("NOT_FOUND", "Customer not found.", 404);
      order.customerId = customer.id;
      order.notes = input.notes || null;
      order.items = input.items.map((item) => ({
        id: id(),
        orderId,
        productId: item.productId ?? null,
        nameSnapshot: item.name,
        unitPriceMinor: item.unitPriceMinor,
        qty: item.qty,
      }));
      order.totalMinor = order.items.reduce(
        (sum, item) => sum + item.unitPriceMinor * item.qty,
        0,
      );
      order.updatedAt = nowIso();
      updated = order;
    });
    if (!updated) throw new AppError("INTERNAL", "Could not update order.", 500);
    return updated;
  },

  async transitionOrder(
    orgId: string,
    orderId: string,
    toStatus: OrderStatus,
    actorUserId: string,
  ): Promise<OrderRecord> {
    let updated: OrderRecord | null = null;
    await queueWrite((state) => {
      const order = state.orders.find((o) => o.id === orderId && o.organizationId === orgId);
      if (!order) throw new AppError("NOT_FOUND", "Order not found.", 404);
      if (!canTransition(order.status, toStatus)) {
        throw new AppError("CONFLICT", `Cannot move from ${order.status} to ${toStatus}.`, 409);
      }
      const from = order.status;
      order.status = toStatus;
      order.updatedAt = nowIso();
      order.events = [
        ...(order.events ?? []),
        {
          id: id(),
          orderId,
          fromStatus: from,
          toStatus,
          actorUserId,
          meta: {},
          createdAt: nowIso(),
        },
      ];
      updated = order;
    });
    if (!updated) throw new AppError("INTERNAL", "Could not update status.", 500);
    return updated;
  },

  async listProducts(orgId: string): Promise<ProductRecord[]> {
    const state = await load();
    return state.products
      .filter((p) => p.organizationId === orgId && !p.deletedAt)
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  async getProduct(orgId: string, productId: string): Promise<ProductRecord | null> {
    const state = await load();
    return (
      state.products.find((p) => p.id === productId && p.organizationId === orgId && !p.deletedAt) ??
      null
    );
  },

  async findProductBySku(orgId: string, sku: string): Promise<ProductRecord | null> {
    const state = await load();
    return (
      state.products.find(
        (p) =>
          p.organizationId === orgId &&
          !p.deletedAt &&
          p.isActive &&
          p.sku?.toLowerCase() === sku.toLowerCase(),
      ) ?? null
    );
  },

  async upsertProduct(
    orgId: string,
    input: Omit<ProductRecord, "id" | "organizationId" | "createdAt" | "deletedAt"> & {
      id?: string;
    },
  ): Promise<ProductRecord> {
    let saved: ProductRecord | null = null;
    await queueWrite((state) => {
      if (input.id) {
        const existing = state.products.find((p) => p.id === input.id && p.organizationId === orgId);
        if (!existing) throw new AppError("NOT_FOUND", "Product not found.", 404);
        Object.assign(existing, {
          name: input.name,
          description: input.description,
          priceMinor: input.priceMinor,
          currency: input.currency,
          sku: input.sku,
          isActive: input.isActive,
        });
        saved = existing;
        return;
      }
      const product: ProductRecord = {
        id: id(),
        organizationId: orgId,
        createdAt: nowIso(),
        deletedAt: null,
        ...input,
      };
      state.products.push(product);
      saved = product;
    });
    if (!saved) throw new AppError("INTERNAL", "Could not save product.", 500);
    return saved;
  },

  async softDeleteProduct(orgId: string, productId: string) {
    await queueWrite((state) => {
      const product = state.products.find((p) => p.id === productId && p.organizationId === orgId);
      if (!product) throw new AppError("NOT_FOUND", "Product not found.", 404);
      product.deletedAt = nowIso();
      product.isActive = false;
    });
  },

  async listCustomers(orgId: string, q?: string): Promise<CustomerRecord[]> {
    const state = await load();
    const query = q?.toLowerCase().trim();
    return state.customers
      .filter((c) => c.organizationId === orgId)
      .filter((c) => {
        if (!query) return true;
        return c.displayName.toLowerCase().includes(query) || c.waId.includes(query);
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  },

  async getCustomer(orgId: string, customerId: string): Promise<CustomerRecord | null> {
    const state = await load();
    return state.customers.find((c) => c.id === customerId && c.organizationId === orgId) ?? null;
  },

  async findCustomerByWaId(orgId: string, waId: string): Promise<CustomerRecord | null> {
    const state = await load();
    const normalized = waId.replace(/\D/g, "");
    return (
      state.customers.find(
        (c) => c.organizationId === orgId && c.waId.replace(/\D/g, "") === normalized,
      ) ?? null
    );
  },

  async upsertCustomer(
    orgId: string,
    input: { id?: string; displayName: string; waId: string; notes?: string | null },
  ): Promise<CustomerRecord> {
    let saved: CustomerRecord | null = null;
    await queueWrite((state) => {
      const waId = input.waId.replace(/\D/g, "");
      if (input.id) {
        const existing = state.customers.find((c) => c.id === input.id && c.organizationId === orgId);
        if (!existing) throw new AppError("NOT_FOUND", "Customer not found.", 404);
        if (
          state.customers.some(
            (c) => c.organizationId === orgId && c.waId === waId && c.id !== existing.id,
          )
        ) {
          throw new AppError("CONFLICT", "A customer with that phone already exists.", 409);
        }
        existing.displayName = input.displayName;
        existing.waId = waId;
        existing.notes = input.notes ?? null;
        saved = existing;
        return;
      }
      const byPhone = state.customers.find((c) => c.organizationId === orgId && c.waId === waId);
      if (byPhone) {
        byPhone.displayName = input.displayName;
        byPhone.notes = input.notes ?? byPhone.notes;
        byPhone.lastMessageAt = nowIso();
        saved = byPhone;
        return;
      }
      const customer: CustomerRecord = {
        id: id(),
        organizationId: orgId,
        waId,
        displayName: input.displayName,
        notes: input.notes ?? null,
        lastMessageAt: nowIso(),
        createdAt: nowIso(),
      };
      state.customers.push(customer);
      saved = customer;
    });
    if (!saved) throw new AppError("INTERNAL", "Could not save customer.", 500);
    return saved;
  },

  async getWhatsApp(orgId: string): Promise<WhatsAppRecord | null> {
    const state = await load();
    return state.whatsapp.find((w) => w.organizationId === orgId) ?? null;
  },

  async findOrgByPhoneNumberId(phoneNumberId: string): Promise<string | null> {
    const state = await load();
    return state.whatsapp.find((w) => w.phoneNumberId === phoneNumberId)?.organizationId ?? null;
  },

  async upsertWhatsApp(orgId: string, patch: Partial<WhatsAppRecord>): Promise<WhatsAppRecord> {
    let saved: WhatsAppRecord | null = null;
    await queueWrite((state) => {
      let row = state.whatsapp.find((w) => w.organizationId === orgId);
      if (!row) {
        row = {
          id: id(),
          organizationId: orgId,
          wabaId: null,
          phoneNumberId: null,
          encryptedAccessToken: null,
          webhookVerifyToken: null,
          status: "disconnected",
        };
        state.whatsapp.push(row);
      }
      Object.assign(row, patch);
      saved = row;
    });
    if (!saved) throw new AppError("INTERNAL", "Could not save WhatsApp settings.", 500);
    return saved;
  },

  async updateOrg(orgId: string, patch: { name: string; currency: string }) {
    await queueWrite((state) => {
      const org = state.orgs.find((o) => o.id === orgId);
      if (!org) throw new AppError("NOT_FOUND", "Organization not found.", 404);
      org.name = patch.name;
      org.currency = patch.currency;
    });
  },

  async hasProcessedWebhook(messageId: string): Promise<boolean> {
    const state = await load();
    return state.processedWebhooks.includes(messageId);
  },

  async markProcessedWebhook(messageId: string) {
    await queueWrite((state) => {
      if (!state.processedWebhooks.includes(messageId)) {
        state.processedWebhooks.push(messageId);
      }
    });
  },
};
