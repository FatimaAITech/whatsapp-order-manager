import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { isDemoMode } from "@/lib/config";
import { getStore } from "@/lib/data/repository";
import { DashboardApp } from "@/components/dashboard/DashboardApp";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await getSession();

  // Production: login ke baghair dashboard access na ho
  if (!session) {
    redirect("/login");
  }

  const orgId = session.orgId;

  const store = getStore();

  const [stats, orders, customers, products, whatsapp] = await Promise.all([
    store.getStats(orgId),
    store.listOrders(orgId, {}),
    store.listCustomers(orgId),
    store.listProducts(orgId),
    store.getWhatsApp(orgId),
  ]);

  return (
    <DashboardApp
      initialData={{
        session,
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