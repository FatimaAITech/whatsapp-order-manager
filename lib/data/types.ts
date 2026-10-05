import type { MemberRole, OrderSource, OrderStatus } from "@prisma/client";

export type SessionUser = {
  userId: string;
  orgId: string;
  role: MemberRole;
  email: string;
  name: string;
  orgName: string;
  currency: string;
};

export type ProductRecord = {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  priceMinor: number;
  currency: string;
  sku: string | null;
  isActive: boolean;
  deletedAt: string | null;
  createdAt: string;
};

export type CustomerRecord = {
  id: string;
  organizationId: string;
  waId: string;
  displayName: string;
  notes: string | null;
  lastMessageAt: string | null;
  createdAt: string;
};

export type OrderItemRecord = {
  id: string;
  orderId: string;
  productId: string | null;
  nameSnapshot: string;
  unitPriceMinor: number;
  qty: number;
};

export type OrderEventRecord = {
  id: string;
  orderId: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  actorUserId: string | null;
  meta: Record<string, unknown> | null;
  createdAt: string;
};

export type OrderRecord = {
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
  createdAt: string;
  updatedAt: string;
  customer?: CustomerRecord;
  items?: OrderItemRecord[];
  events?: OrderEventRecord[];
};

export type WhatsAppRecord = {
  id: string;
  organizationId: string;
  wabaId: string | null;
  phoneNumberId: string | null;
  encryptedAccessToken: string | null;
  webhookVerifyToken: string | null;
  status: string;
};

export type DashboardStats = {
  totalOrders: number;
  todayOrders: number;
  revenueMinor: number;
  byStatus: Record<OrderStatus, number>;
  productCount: number;
  customerCount: number;
};

export type OrderFilters = {
  q?: string;
  status?: OrderStatus | "ALL";
  source?: OrderSource | "ALL";
};

export type OrderWriteInput = {
  customerId: string;
  notes?: string;
  source?: OrderSource;
  needsReview?: boolean;
  externalMessageId?: string;
  items: {
    productId?: string;
    name: string;
    unitPriceMinor: number;
    qty: number;
  }[];
};
