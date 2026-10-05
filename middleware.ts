import { NextRequest, NextResponse } from "next/server";

export async function middleware(request: NextRequest) {
  // If user navigates to /app, route them directly to the main dashboard
  if (request.nextUrl.pathname.startsWith("/app")) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/app/:path*"],
};
