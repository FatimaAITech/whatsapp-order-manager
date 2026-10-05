import { getSession } from "@/lib/auth/session";
import { isDemoMode } from "@/lib/config";
import { getStore } from "@/lib/data/repository";
import { DashboardApp } from "@/components/dashboard/DashboardApp";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await getSession();
  const orgId = session?.orgId || "org-demo";

  const store = getStore();
  const [stats, orders, customers, products, whatsapp] = await Promise.all([
    store.getStats(orgId),
    store.listOrders(orgId, {}),
    store.listCustomers(orgId),
    store.listProducts(orgId),
    store.getWhatsApp(orgId),
  ]);

  const activeSession = session || {
    userId: "user-demo",
    orgId: "org-demo",
    role: "OWNER" as const,
    email: "demo@shop.local",
    name: "Demo Owner",
    orgName: "Demo Kitchen",
    currency: "PKR",
  };

  return (
    <DashboardApp
      initialData={{
        session: activeSession,
        stats,
        orders,
        customers,
        products,
        whatsapp,
        demoMode: isDemoMode(),
      }}
    />
  );
}
