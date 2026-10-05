import Link from "next/link";
import { logoutAction } from "@/lib/actions";
import type { SessionUser } from "@/lib/data/types";

const LINKS = [
  { href: "/app", label: "Dashboard" },
  { href: "/app/orders", label: "Orders" },
  { href: "/app/customers", label: "Customers" },
  { href: "/app/catalog", label: "Catalog" },
  { href: "/app/settings", label: "Settings" },
  { href: "/app/settings/whatsapp", label: "WhatsApp" },
];

export function AppShell({
  session,
  demoMode,
  whatsappLabel,
  children,
}: {
  session: SessionUser;
  demoMode: boolean;
  whatsappLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#f0f2f5] text-[#111b21]">
      <div className="flex min-h-screen">
        <aside className="hidden w-64 flex-col bg-[#111b21] text-[#e9edef] md:flex">
          <div className="border-b border-white/10 px-5 py-5">
            <p className="text-xs uppercase tracking-[0.2em] text-[#00a884]">WhatsApp</p>
            <h1 className="text-lg font-semibold">Order Manager</h1>
            <p className="mt-1 truncate text-sm text-[#8696a0]">{session.orgName}</p>
          </div>
          <nav className="flex-1 space-y-1 p-3">
            {LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="block rounded-lg px-3 py-2 text-sm hover:bg-white/10"
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <form action={logoutAction} className="border-t border-white/10 p-4">
            <p className="truncate text-sm">{session.name}</p>
            <p className="truncate text-xs text-[#8696a0]">{session.email}</p>
            <button className="mt-3 text-sm text-[#00a884]" type="submit">
              Sign out
            </button>
          </form>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between border-b border-black/5 bg-white px-4 py-3 md:px-8">
            <div className="md:hidden">
              <p className="font-semibold">Order Manager</p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {demoMode ? (
                <span className="badge bg-amber-100 text-amber-800">Demo mode</span>
              ) : (
                <span className="badge bg-emerald-100 text-emerald-800">Postgres</span>
              )}
              <span className="badge bg-zinc-100 text-zinc-700">{whatsappLabel}</span>
            </div>
            <Link className="btn btn-primary text-xs" href="/app/orders/new">
              New order
            </Link>
          </header>
          <nav className="flex gap-3 overflow-x-auto border-b border-black/5 bg-white px-4 py-2 md:hidden">
            {LINKS.map((link) => (
              <Link key={link.href} href={link.href} className="whitespace-nowrap text-sm">
                {link.label}
              </Link>
            ))}
          </nav>
          <main className="flex-1 p-4 md:p-8">{children}</main>
        </div>
      </div>
    </div>
  );
}
