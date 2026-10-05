import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { demoCredentials, getAuthSecret, isDemoMode } from "@/lib/config";
import type { SessionUser } from "@/lib/data/types";
import { AppError } from "@/lib/errors";

const COOKIE = "wom_session";

function secretKey() {
  return new TextEncoder().encode(getAuthSecret());
}

export async function createSession(user: SessionUser) {
  const token = await new SignJWT(user)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secretKey());
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function destroySession() {
  const jar = await cookies();
  jar.delete(COOKIE);
}

export async function getSession(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) {
    if (isDemoMode()) {
      const creds = demoCredentials();
      return {
        userId: "user-demo",
        orgId: "org-demo",
        role: "OWNER",
        email: creds.email,
        name: "Demo Owner",
        orgName: "Demo Kitchen",
        currency: "PKR",
      };
    }
    return null;
  }
  try {
    const { payload } = await jwtVerify(token, secretKey());
    return payload as unknown as SessionUser;
  } catch {
    if (isDemoMode()) {
      const creds = demoCredentials();
      return {
        userId: "user-demo",
        orgId: "org-demo",
        role: "OWNER",
        email: creds.email,
        name: "Demo Owner",
        orgName: "Demo Kitchen",
        currency: "PKR",
      };
    }
    return null;
  }
}

export async function requireSession(): Promise<SessionUser> {
  const session = await getSession();
  if (!session) throw new AppError("UNAUTHORIZED", "Please sign in.", 401);
  return session;
}

export function requireOwner(session: SessionUser) {
  if (session.role !== "OWNER") {
    throw new AppError("FORBIDDEN", "Only the owner can change these settings.", 403);
  }
}
