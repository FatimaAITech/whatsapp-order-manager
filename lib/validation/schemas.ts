import { z } from "zod";
import { ORDER_STATUSES } from "@/lib/orders/transition";

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

export const signupSchema = z.object({
  name: z.string().min(2).max(80),
  email: z.string().email(),
  password: z.string().min(8).max(128),
  organizationName: z.string().min(2).max(80),
});

export const productSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional().or(z.literal("")),
  price: z.coerce.number().positive(),
  sku: z.string().max(40).optional().or(z.literal("")),
  isActive: z.coerce.boolean().optional(),
});

export const customerSchema = z.object({
  displayName: z.string().min(1).max(120),
  waId: z.string().min(8).max(20).regex(/^\+?[0-9]+$/, "Use digits with optional +"),
  notes: z.string().max(500).optional().or(z.literal("")),
});

export const orderItemInputSchema = z.object({
  productId: z.string().optional().or(z.literal("")),
  name: z.string().min(1).max(120),
  unitPrice: z.coerce.number().nonnegative(),
  qty: z.coerce.number().int().positive(),
});

export const orderSchema = z.object({
  customerId: z.string().min(1, "Customer is required"),
  notes: z.string().max(1000).optional().or(z.literal("")),
  items: z.array(orderItemInputSchema).min(1, "Add at least one item"),
});

export const statusSchema = z.object({
  status: z.enum(ORDER_STATUSES),
});

export const orgSettingsSchema = z.object({
  name: z.string().min(2).max(80),
  currency: z.string().min(3).max(8),
});

export const whatsappSettingsSchema = z.object({
  wabaId: z.string().max(40).optional().or(z.literal("")),
  phoneNumberId: z.string().max(40).optional().or(z.literal("")),
  accessToken: z.string().max(512).optional().or(z.literal("")),
  webhookVerifyToken: z.string().max(80).optional().or(z.literal("")),
});
