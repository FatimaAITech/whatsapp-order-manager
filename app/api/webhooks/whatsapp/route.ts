import { NextRequest } from "next/server";
import { isDemoMode } from "@/lib/config";
import { AppError, jsonError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { ingestInboundText, verifyMetaSignature } from "@/lib/whatsapp/client";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");
  const expected = process.env.WHATSAPP_VERIFY_TOKEN;
  if (mode === "subscribe" && expected && token === expected) {
    return new Response(challenge ?? "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

export async function POST(request: NextRequest) {
  try {
    if (!rateLimit("webhook", 120, 60_000)) {
      throw new AppError("RATE_LIMIT", "Too many webhook requests.", 429);
    }
    const raw = await request.text();
    const signature = request.headers.get("x-hub-signature-256");
    const hasSecret = Boolean(process.env.WHATSAPP_APP_SECRET);
    if (hasSecret && !verifyMetaSignature(raw, signature)) {
      return new Response("Invalid signature", { status: 403 });
    }
    if (!hasSecret && !isDemoMode()) {
      return new Response("WHATSAPP_APP_SECRET is required outside demo mode", { status: 403 });
    }

    const body = JSON.parse(raw || "{}") as {
      entry?: {
        changes?: {
          value?: {
            metadata?: { phone_number_id?: string };
            contacts?: { profile?: { name?: string }; wa_id?: string }[];
            messages?: { id: string; from: string; type?: string; text?: { body?: string } }[];
          };
        }[];
      }[];
    };

    const messages = body.entry?.flatMap((entry) =>
      entry.changes?.flatMap((change) => {
        const phoneNumberId = change.value?.metadata?.phone_number_id;
        const contactName = change.value?.contacts?.[0]?.profile?.name;
        return (change.value?.messages ?? []).map((message) => ({
          ...message,
          phoneNumberId,
          contactName,
        }));
      }),
    );

    for (const message of messages ?? []) {
      if (!message?.id || !message.from) continue;
      const text = message.text?.body ?? "";
      await ingestInboundText({
        phoneNumberId: message.phoneNumberId,
        from: message.from,
        text,
        messageId: message.id,
        profileName: message.contactName,
      });
    }

    return Response.json({ received: true });
  } catch (error) {
    return jsonError(error);
  }
}
