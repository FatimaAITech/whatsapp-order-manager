import type { OrderStatus } from "@/app/generated/prisma/client";
import { statusLabel } from "@/lib/orders/transition";

const COLORS: Record<OrderStatus, string> = {
  PENDING: "bg-amber-100 text-amber-800",
  CONFIRMED: "bg-sky-100 text-sky-800",
  PROCESSING: "bg-indigo-100 text-indigo-800",
  SHIPPED: "bg-teal-100 text-teal-800",
  DELIVERED: "bg-emerald-100 text-emerald-800",
  CANCELLED: "bg-rose-100 text-rose-800",
};

export function StatusBadge({ status }: { status: OrderStatus }) {
  return <span className={`badge ${COLORS[status]}`}>{statusLabel(status)}</span>;
}
