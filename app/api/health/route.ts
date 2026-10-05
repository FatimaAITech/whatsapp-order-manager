import { NextRequest } from "next/server";
import { isDemoMode, isWhatsAppConfigured } from "@/lib/config";

export async function GET() {
  return Response.json({
    ok: true,
    demoMode: isDemoMode(),
    database: isDemoMode() ? "demo-store" : "postgres",
    whatsappConfigured: isWhatsAppConfigured(),
  });
}

export async function POST(_request: NextRequest) {
  return Response.json({ ok: true });
}
