"use server";

import { redirect } from "next/navigation";
import { createSession, destroySession, requireOwner, requireSession } from "@/lib/auth/session";
import { getStore } from "@/lib/data/repository";
import { actionError } from "@/lib/errors";
import { AppError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import {
  customerSchema,
  loginSchema,
  orderSchema,
  orgSettingsSchema,
  productSchema,
  signupSchema,
  statusSchema,
  whatsappSettingsSchema,
} from "@/lib/validation/schemas";
import { encryptSecret } from "@/lib/crypto";
import { toMinor } from "@/lib/format";
import { sendWhatsAppText, statusMessage } from "@/lib/whatsapp/client";
import type { OrderStatus } from "@/app/generated/prisma/client";

export async function loginAction(formData: FormData) {
  try {
    if (!rateLimit("login", 10, 60_000)) {
      throw new AppError("RATE_LIMIT", "Too many login attempts. Try again shortly.", 429);
    }
    const parsed = loginSchema.parse({
      email: formData.get("email"),
      password: formData.get("password"),
    });
    const session = await getStore().authenticate(parsed.email, parsed.password);
    if (!session) throw new AppError("UNAUTHORIZED", "Invalid email or password.", 401);
    await createSession(session);
  } catch (error) {
    return actionError(error);
  }
  redirect("/");
}

export async function signupAction(formData: FormData) {
  try {
    if (!rateLimit("signup", 8, 60_000)) {
      throw new AppError("RATE_LIMIT", "Too many signup attempts.", 429);
    }
    const parsed = signupSchema.parse({
      name: formData.get("name"),
      email: formData.get("email"),
      password: formData.get("password"),
      organizationName: formData.get("organizationName"),
    });
    const session = await getStore().signup(parsed);
    await createSession(session);
  } catch (error) {
    return actionError(error);
  }
  redirect("/");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}

export async function saveProductAction(formData: FormData) {
  try {
    const session = await requireSession();
    const parsed = productSchema.parse({
      name: formData.get("name"),
      description: formData.get("description"),
      price: formData.get("price"),
      sku: formData.get("sku"),
      isActive: formData.get("isActive") === "on",
    });
    const id = String(formData.get("id") || "");
    await getStore().upsertProduct(session.orgId, {
      id: id || undefined,
      name: parsed.name,
      description: parsed.description || null,
      priceMinor: toMinor(parsed.price),
      currency: session.currency,
      sku: parsed.sku || null,
      isActive: parsed.isActive ?? true,
    });
    return { ok: true as const };
  } catch (error) {
    return actionError(error);
  }
}

export async function deleteProductAction(productId: string) {
  try {
    const session = await requireSession();
    await getStore().softDeleteProduct(session.orgId, productId);
    return { ok: true as const };
  } catch (error) {
    return actionError(error);
  }
}

export async function saveCustomerAction(formData: FormData) {
  try {
    const session = await requireSession();
    const parsed = customerSchema.parse({
      displayName: formData.get("displayName"),
      waId: formData.get("waId"),
      notes: formData.get("notes"),
    });
    const id = String(formData.get("id") || "");
    await getStore().upsertCustomer(session.orgId, {
      id: id || undefined,
      displayName: parsed.displayName,
      waId: parsed.waId,
      notes: parsed.notes || null,
    });
    return { ok: true as const };
  } catch (error) {
    return actionError(error);
  }
}

function itemsFromForm(formData: FormData) {
  const names = formData.getAll("itemName").map(String);
  const prices = formData.getAll("itemPrice");
  const qtys = formData.getAll("itemQty");
  const productIds = formData.getAll("itemProductId").map(String);
  return names.map((name, index) => ({
    name,
    unitPrice: Number(prices[index]),
    qty: Number(qtys[index]),
    productId: productIds[index] || "",
  }));
}

export async function saveOrderAction(formData: FormData) {
  try {
    const session = await requireSession();
    const parsed = orderSchema.parse({
      customerId: formData.get("customerId"),
      notes: formData.get("notes"),
      items: itemsFromForm(formData),
    });
    const payload = {
      customerId: parsed.customerId,
      notes: parsed.notes,
      items: parsed.items.map((item) => ({
        productId: item.productId || undefined,
        name: item.name,
        unitPriceMinor: toMinor(item.unitPrice),
        qty: item.qty,
      })),
    };
    const id = String(formData.get("id") || "");
    const store = getStore();
    if (id) {
      await store.updateOrder(session.orgId, id, payload);
      return { ok: true as const, id };
    }
    const order = await store.createOrder(session.orgId, session.userId, payload);
    return { ok: true as const, id: order.id };
  } catch (error) {
    return actionError(error);
  }
}

export async function transitionOrderAction(orderId: string, status: OrderStatus) {
  try {
    const session = await requireSession();
    statusSchema.parse({ status });
    const store = getStore();
    const order = await store.transitionOrder(session.orgId, orderId, status, session.userId);
    const connection = await store.getWhatsApp(session.orgId);
    const customer = order.customer ?? (await store.getCustomer(session.orgId, order.customerId));
    const notify = await sendWhatsAppText({
      connection,
      to: customer?.waId ?? "",
      body: statusMessage(order),
    });
    return { ok: true as const, notify };
  } catch (error) {
    return actionError(error);
  }
}

export async function saveOrgSettingsAction(formData: FormData) {
  try {
    const session = await requireSession();
    requireOwner(session);
    const parsed = orgSettingsSchema.parse({
      name: formData.get("name"),
      currency: formData.get("currency"),
    });
    await getStore().updateOrg(session.orgId, parsed);
    return { ok: true as const };
  } catch (error) {
    return actionError(error);
  }
}

export async function saveWhatsAppSettingsAction(formData: FormData) {
  try {
    const session = await requireSession();
    requireOwner(session);
    const parsed = whatsappSettingsSchema.parse({
      wabaId: formData.get("wabaId"),
      phoneNumberId: formData.get("phoneNumberId"),
      accessToken: formData.get("accessToken"),
      webhookVerifyToken: formData.get("webhookVerifyToken"),
    });
    const store = getStore();
    const existing = await store.getWhatsApp(session.orgId);
    const encryptedAccessToken = parsed.accessToken
      ? encryptSecret(parsed.accessToken)
      : existing?.encryptedAccessToken ?? null;
    const connected = Boolean(parsed.phoneNumberId && (parsed.accessToken || existing?.encryptedAccessToken));
    await store.upsertWhatsApp(session.orgId, {
      wabaId: parsed.wabaId || null,
      phoneNumberId: parsed.phoneNumberId || null,
      encryptedAccessToken,
      webhookVerifyToken: parsed.webhookVerifyToken || null,
      status: connected ? "connected" : "disconnected",
    });
    return { ok: true as const };
  } catch (error) {
    return actionError(error);
  }
}

export async function sendTestWhatsAppAction(formData: FormData) {
  try {
    const session = await requireSession();
    requireOwner(session);
    const to = String(formData.get("to") || "");
    if (!to) throw new AppError("VALIDATION", "Enter a destination phone number.", 400);
    const connection = await getStore().getWhatsApp(session.orgId);
    const result = await sendWhatsAppText({
      connection,
      to,
      body: `Test message from ${session.orgName} via WhatsApp Order Manager.`,
    });
    return { ok: true as const, result };
  } catch (error) {
    return actionError(error);
  }
}
