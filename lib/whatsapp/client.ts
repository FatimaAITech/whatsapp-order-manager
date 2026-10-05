import { createHmac, timingSafeEqual } from "crypto";
import { isDemoMode, isWhatsAppConfigured } from "@/lib/config";
import { decryptSecret } from "@/lib/crypto";
import { getStore } from "@/lib/data/repository";
import type { OrderRecord, WhatsAppRecord } from "@/lib/data/types";

export type WhatsAppSendResult =
  | { attempted: false; reason: "not_configured" | "demo_mode"; message: string }
  | { attempted: true; ok: true; providerId: string }
  | { attempted: true; ok: false; status: number; message: string };

function graphUrl(phoneNumberId: string) {
  const version = process.env.WHATSAPP_API_VERSION || "v21.0";
  return `https://graph.facebook.com/${version}/${phoneNumberId}/messages`;
}

function resolveCredentials(connection: WhatsAppRecord | null): {
  token: string;
  phoneNumberId: string;
} | null {
  if (connection?.encryptedAccessToken && connection.phoneNumberId) {
    try {
      return {
        token: decryptSecret(connection.encryptedAccessToken),
        phoneNumberId: connection.phoneNumberId,
      };
    } catch {
      return null;
    }
  }
  if (process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID) {
    return {
      token: process.env.WHATSAPP_ACCESS_TOKEN,
      phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    };
  }
  return null;
}

export function whatsappStatus(connection: WhatsAppRecord | null) {
  const creds = resolveCredentials(connection);
  if (creds) {
    return { configured: true, live: !isDemoMode(), label: isDemoMode() ? "Configured (demo will not send)" : "Connected" };
  }
  return { configured: false, live: false, label: "Not configured" };
}

export async function sendWhatsAppText(options: {
  connection: WhatsAppRecord | null;
  to: string;
  body: string;
}): Promise<WhatsAppSendResult> {
  if (isDemoMode() && !isWhatsAppConfigured() && !options.connection?.encryptedAccessToken) {
    return {
      attempted: false,
      reason: "demo_mode",
      message:
        "Demo mode: no WhatsApp Cloud API credentials are configured, so no message was sent.",
    };
  }
  const creds = resolveCredentials(options.connection);
  if (!creds) {
    return {
      attempted: false,
      reason: "not_configured",
      message:
        "WhatsApp Cloud API is not configured. Add WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID, or save a tenant token in Settings.",
    };
  }

  const res = await fetch(graphUrl(creds.phoneNumberId), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: options.to.replace(/\D/g, ""),
      type: "text",
      text: { body: options.body },
    }),
  });

  const payload = (await res.json().catch(() => ({}))) as {
    messages?: { id?: string }[];
    error?: { message?: string };
  };

  if (!res.ok) {
    return {
      attempted: true,
      ok: false,
      status: res.status,
      message: payload.error?.message || `WhatsApp API returned ${res.status}.`,
    };
  }

  const providerId = payload.messages?.[0]?.id;
  if (!providerId) {
    return {
      attempted: true,
      ok: false,
      status: res.status,
      message: "WhatsApp API did not return a message id.",
    };
  }

  return { attempted: true, ok: true, providerId };
}

export function statusMessage(order: OrderRecord): string {
  const total = (order.totalMinor / 100).toFixed(2);
  return `Order ${order.id.slice(0, 8)} is now ${order.status.toLowerCase()}. Total: ${order.currency} ${total}.`;
}

export function verifyMetaSignature(rawBody: string, header: string | null): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return false;
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const provided = header.slice("sha256=".length);
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
  } catch {
    return false;
  }
}

export async function ingestInboundText(options: {
  phoneNumberId?: string;
  from: string;
  text: string;
  messageId: string;
  profileName?: string;
}) {
  const store = getStore();
  if (await store.hasProcessedWebhook(options.messageId)) {
    return { duplicate: true as const };
  }

  let orgId = options.phoneNumberId
    ? await store.findOrgByPhoneNumberId(options.phoneNumberId)
    : null;
  if (!orgId && isDemoMode()) {
    orgId = "org-demo";
  }
  if (!orgId) {
    return { ignored: true as const, reason: "unknown_phone_number_id" };
  }

  const customer = await store.upsertCustomer(orgId, {
    displayName: options.profileName || options.from,
    waId: options.from,
  });

  const parsed = parseOrderText(options.text);
  let product = parsed.sku ? await store.findProductBySku(orgId, parsed.sku) : null;
  const needsReview = !product;
  const items = product
    ? [
        {
          productId: product.id,
          name: product.name,
          unitPriceMinor: product.priceMinor,
          qty: parsed.qty,
        },
      ]
    : [
        {
          name: options.text.slice(0, 80) || "Unparsed WhatsApp message",
          unitPriceMinor: 0,
          qty: 1,
        },
      ];

  const order = await store.createOrder(orgId, "system", {
    customerId: customer.id,
    notes: needsReview ? options.text : parsed.note,
    source: "WHATSAPP",
    needsReview,
    externalMessageId: options.messageId,
    items,
  });
  await store.markProcessedWebhook(options.messageId);
  return { duplicate: false as const, order };
}

function parseOrderText(text: string): { sku?: string; qty: number; note?: string } {
  const orderMatch = text.match(/ORDER:\s*([A-Za-z0-9_-]+)(?:\s+(\d+))?/i);
  if (orderMatch) {
    return { sku: orderMatch[1], qty: Number(orderMatch[2] || 1) };
  }
  const numbered = text.trim();
  if (/^\d+$/.test(numbered)) {
    return { sku: numbered, qty: 1 };
  }
  return { qty: 1, note: text };
}
