"use client";

import React, { useState, useTransition } from "react";
import type { OrderStatus, OrderSource } from "@prisma/client";
import type {
  CustomerRecord,
  DashboardStats,
  OrderRecord,
  ProductRecord,
  SessionUser,
  WhatsAppRecord,
} from "@/lib/data/types";
import { formatMoney, formatDate, fromMinor } from "@/lib/format";
import { ORDER_STATUSES, ALLOWED_TRANSITIONS, statusLabel } from "@/lib/orders/transition";
import {
  saveOrderAction,
  transitionOrderAction,
  saveProductAction,
  deleteProductAction,
  saveCustomerAction,
  saveOrgSettingsAction,
  saveWhatsAppSettingsAction,
  sendTestWhatsAppAction,
} from "@/lib/actions";

type Tab =
  | "dashboard"
  | "orders"
  | "customers"
  | "products"
  | "whatsapp"
  | "reports"
  | "settings";

interface DashboardAppProps {
  initialData: {
    session: SessionUser;
    stats: DashboardStats;
    orders: OrderRecord[];
    customers: CustomerRecord[];
    products: ProductRecord[];
    whatsapp: WhatsAppRecord | null;
    demoMode: boolean;
  };
}

export function DashboardApp({ initialData }: DashboardAppProps) {
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Data states
  const [orders, setOrders] = useState<OrderRecord[]>(initialData.orders);
  const [customers, setCustomers] = useState<CustomerRecord[]>(initialData.customers);
  const [products, setProducts] = useState<ProductRecord[]>(initialData.products);
  const [stats, setStats] = useState<DashboardStats>(initialData.stats);
  const [whatsapp, setWhatsapp] = useState<WhatsAppRecord | null>(initialData.whatsapp);
  const [session, setSession] = useState<SessionUser>(initialData.session);
  const demoMode = initialData.demoMode;

  // Filter & Search states
  const [orderSearch, setOrderSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<OrderStatus | "ALL">("ALL");
  const [sourceFilter, setSourceFilter] = useState<OrderSource | "ALL">("ALL");

  const [customerSearch, setCustomerSearch] = useState("");
  const [productSearch, setProductSearch] = useState("");

  // Notification message
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);

  const showToast = (message: string, type: "success" | "error" | "info" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4500);
  };

  // Modals state
  const [isAddOrderOpen, setIsAddOrderOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<OrderRecord | null>(null);
  const [selectedOrderDetails, setSelectedOrderDetails] = useState<OrderRecord | null>(null);

  const [isAddCustomerOpen, setIsAddCustomerOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<CustomerRecord | null>(null);

  const [isAddProductOpen, setIsAddProductOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductRecord | null>(null);

  // New / Edit Order form state
  const [orderCustomerSelect, setOrderCustomerSelect] = useState("");
  const [orderNotes, setOrderNotes] = useState("");
  const [orderItems, setOrderItems] = useState<
    Array<{ productId: string; name: string; unitPrice: number; qty: number }>
  >([{ productId: "", name: "", unitPrice: 0, qty: 1 }]);

  // Test WhatsApp message state
  const [testPhone, setTestPhone] = useState("");
  const [testResult, setTestResult] = useState<string | null>(null);

  // Quick reset order form
  const resetOrderForm = () => {
    setOrderCustomerSelect(customers[0]?.id || "");
    setOrderNotes("");
    setOrderItems([{ productId: "", name: "", unitPrice: 0, qty: 1 }]);
    setEditingOrder(null);
  };

  const openAddOrder = (preselectedCustomerId?: string) => {
    resetOrderForm();
    if (preselectedCustomerId) {
      setOrderCustomerSelect(preselectedCustomerId);
    }
    setIsAddOrderOpen(true);
  };

  const openEditOrder = (order: OrderRecord) => {
    setEditingOrder(order);
    setOrderCustomerSelect(order.customerId);
    setOrderNotes(order.notes || "");
    if (order.items && order.items.length > 0) {
      setOrderItems(
        order.items.map((item) => ({
          productId: item.productId || "",
          name: item.nameSnapshot,
          unitPrice: fromMinor(item.unitPriceMinor),
          qty: item.qty,
        }))
      );
    } else {
      setOrderItems([{ productId: "", name: "", unitPrice: 0, qty: 1 }]);
    }
    setIsAddOrderOpen(true);
  };

  // Status transition handler
  const handleTransition = (orderId: string, toStatus: OrderStatus) => {
    startTransition(async () => {
      const res = await transitionOrderAction(orderId, toStatus);
      if (res && "ok" in res && !res.ok) {
        showToast(res.message || "Failed to update order status", "error");
      } else {
        setOrders((prev) =>
          prev.map((o) => (o.id === orderId ? { ...o, status: toStatus, updatedAt: new Date().toISOString() } : o))
        );
        // Update stats
        setStats((prev) => {
          const target = orders.find((o) => o.id === orderId);
          if (!target) return prev;
          const oldStatus = target.status;
          return {
            ...prev,
            byStatus: {
              ...prev.byStatus,
              [oldStatus]: Math.max(0, (prev.byStatus[oldStatus] || 1) - 1),
              [toStatus]: (prev.byStatus[toStatus] || 0) + 1,
            },
          };
        });
        showToast(`Order status updated to ${statusLabel(toStatus)}!`);
      }
    });
  };

  // Submit Order (Add / Edit)
  const handleOrderSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orderCustomerSelect) {
      showToast("Please select a customer", "error");
      return;
    }
    if (orderItems.length === 0 || !orderItems.some((i) => i.name.trim() && i.qty > 0)) {
      showToast("Please add at least one valid item", "error");
      return;
    }

    const formData = new FormData();
    if (editingOrder) {
      formData.set("id", editingOrder.id);
    }
    formData.set("customerId", orderCustomerSelect);
    formData.set("notes", orderNotes);

    orderItems.forEach((item) => {
      if (item.name.trim()) {
        formData.append("itemName", item.name);
        formData.append("itemPrice", String(item.unitPrice));
        formData.append("itemQty", String(item.qty));
        formData.append("itemProductId", item.productId || "");
      }
    });

    startTransition(async () => {
      const res = await saveOrderAction(formData);
      if (res && "ok" in res && !res.ok) {
        showToast(res.message || "Failed to save order", "error");
      } else {
        const cust = customers.find((c) => c.id === orderCustomerSelect);
        const totalMinor = Math.round(
          orderItems.reduce((acc, it) => acc + it.unitPrice * it.qty, 0) * 100
        );
        const now = new Date().toISOString();

        if (editingOrder) {
          setOrders((prev) =>
            prev.map((o) =>
              o.id === editingOrder.id
                ? {
                    ...o,
                    customerId: orderCustomerSelect,
                    customer: cust,
                    notes: orderNotes,
                    totalMinor,
                    updatedAt: now,
                    items: orderItems.map((it, idx) => ({
                      id: `item-${Date.now()}-${idx}`,
                      orderId: o.id,
                      productId: it.productId || null,
                      nameSnapshot: it.name,
                      unitPriceMinor: Math.round(it.unitPrice * 100),
                      qty: it.qty,
                    })),
                  }
                : o
            )
          );
          showToast("Order updated successfully!");
        } else {
          const newId = (res as { id: string }).id || `order-${Date.now().toString().slice(-6)}`;
          const newOrder: OrderRecord = {
            id: newId,
            organizationId: session.orgId,
            customerId: orderCustomerSelect,
            customer: cust,
            status: "PENDING",
            source: "MANUAL",
            notes: orderNotes,
            needsReview: false,
            totalMinor,
            currency: session.currency,
            externalMessageId: null,
            createdAt: now,
            updatedAt: now,
            items: orderItems.map((it, idx) => ({
              id: `item-${Date.now()}-${idx}`,
              orderId: newId,
              productId: it.productId || null,
              nameSnapshot: it.name,
              unitPriceMinor: Math.round(it.unitPrice * 100),
              qty: it.qty,
            })),
            events: [
              {
                id: `evt-${Date.now()}`,
                orderId: newId,
                fromStatus: null,
                toStatus: "PENDING",
                actorUserId: session.userId,
                meta: { source: "MANUAL" },
                createdAt: now,
              },
            ],
          };
          setOrders((prev) => [newOrder, ...prev]);
          setStats((prev) => ({
            ...prev,
            totalOrders: prev.totalOrders + 1,
            todayOrders: prev.todayOrders + 1,
            revenueMinor: prev.revenueMinor + totalMinor,
            byStatus: {
              ...prev.byStatus,
              PENDING: (prev.byStatus.PENDING || 0) + 1,
            },
          }));
          showToast("New order placed successfully!");
        }
        setIsAddOrderOpen(false);
        resetOrderForm();
      }
    });
  };

  // Submit Customer (Add / Edit)
  const handleCustomerSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);

    startTransition(async () => {
      const res = await saveCustomerAction(formData);
      if (res && "ok" in res && !res.ok) {
        showToast(res.message || "Failed to save customer", "error");
      } else {
        const id = (formData.get("id") as string) || `cust-${Date.now().toString().slice(-6)}`;
        const displayName = formData.get("displayName") as string;
        const waId = (formData.get("waId") as string).replace(/\D/g, "");
        const notes = (formData.get("notes") as string) || null;

        if (editingCustomer) {
          setCustomers((prev) =>
            prev.map((c) => (c.id === editingCustomer.id ? { ...c, displayName, waId, notes } : c))
          );
          showToast("Customer updated successfully!");
        } else {
          const newCust: CustomerRecord = {
            id,
            organizationId: session.orgId,
            displayName,
            waId,
            notes,
            lastMessageAt: null,
            createdAt: new Date().toISOString(),
          };
          setCustomers((prev) => [newCust, ...prev]);
          setStats((prev) => ({ ...prev, customerCount: prev.customerCount + 1 }));
          showToast("Customer added successfully!");
        }
        setIsAddCustomerOpen(false);
        setEditingCustomer(null);
      }
    });
  };

  // Submit Product (Add / Edit)
  const handleProductSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);

    startTransition(async () => {
      const res = await saveProductAction(formData);
      if (res && "ok" in res && !res.ok) {
        showToast(res.message || "Failed to save product", "error");
      } else {
        const id = (formData.get("id") as string) || `prod-${Date.now().toString().slice(-6)}`;
        const name = formData.get("name") as string;
        const description = (formData.get("description") as string) || null;
        const price = Number(formData.get("price"));
        const sku = (formData.get("sku") as string) || null;
        const isActive = formData.get("isActive") === "on";

        if (editingProduct) {
          setProducts((prev) =>
            prev.map((p) =>
              p.id === editingProduct.id
                ? {
                    ...p,
                    name,
                    description,
                    priceMinor: Math.round(price * 100),
                    sku,
                    isActive,
                  }
                : p
            )
          );
          showToast("Product updated successfully!");
        } else {
          const newProd: ProductRecord = {
            id,
            organizationId: session.orgId,
            name,
            description,
            priceMinor: Math.round(price * 100),
            currency: session.currency,
            sku,
            isActive,
            deletedAt: null,
            createdAt: new Date().toISOString(),
          };
          setProducts((prev) => [newProd, ...prev]);
          setStats((prev) => ({ ...prev, productCount: prev.productCount + 1 }));
          showToast("Product created successfully!");
        }
        setIsAddProductOpen(false);
        setEditingProduct(null);
      }
    });
  };

  // Delete Product
  const handleDeleteProduct = (productId: string) => {
    if (!confirm("Are you sure you want to deactivate/delete this product?")) return;
    startTransition(async () => {
      const res = await deleteProductAction(productId);
      if (res && "ok" in res && !res.ok) {
        showToast(res.message || "Failed to delete product", "error");
      } else {
        setProducts((prev) => prev.filter((p) => p.id !== productId));
        setStats((prev) => ({ ...prev, productCount: Math.max(0, prev.productCount - 1) }));
        showToast("Product removed successfully!");
      }
    });
  };

  // Submit WhatsApp Settings
  const handleWhatsAppSettings = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await saveWhatsAppSettingsAction(formData);
      if (res && "ok" in res && !res.ok) {
        showToast(res.message || "Failed to save WhatsApp settings", "error");
      } else {
        const wabaId = (formData.get("wabaId") as string) || null;
        const phoneNumberId = (formData.get("phoneNumberId") as string) || null;
        const webhookVerifyToken = (formData.get("webhookVerifyToken") as string) || null;
        setWhatsapp((prev) => ({
          id: prev?.id || "wa-1",
          organizationId: session.orgId,
          wabaId,
          phoneNumberId,
          encryptedAccessToken: prev?.encryptedAccessToken || null,
          webhookVerifyToken,
          status: phoneNumberId ? "connected" : "disconnected",
        }));
        showToast("WhatsApp connection settings saved!");
      }
    });
  };

  // Send Test WhatsApp Message
  const handleSendTest = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setTestResult("Sending...");
    startTransition(async () => {
      const res = await sendTestWhatsAppAction(formData);
      if (res && "ok" in res && !res.ok) {
        setTestResult(`Error: ${res.message}`);
        showToast(res.message, "error");
      } else {
        const result = (res as { result?: { attempted: boolean; reason?: string; message?: string } })
          ?.result;
        if (result && !result.attempted) {
          setTestResult(`Notice: ${result.message}`);
          showToast(result.message || "Demo Mode: No message sent", "info");
        } else {
          setTestResult("Test message triggered successfully!");
          showToast("Test message sent successfully!");
        }
      }
    });
  };

  // Submit Org Settings
  const handleOrgSettings = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await saveOrgSettingsAction(formData);
      if (res && "ok" in res && !res.ok) {
        showToast(res.message || "Failed to update store settings", "error");
      } else {
        const name = formData.get("name") as string;
        const currency = formData.get("currency") as string;
        setSession((prev) => ({ ...prev, orgName: name, currency }));
        showToast("Store settings updated successfully!");
      }
    });
  };

  // Filtered orders
  const filteredOrders = orders.filter((o) => {
    const matchesSearch =
      !orderSearch.trim() ||
      o.id.toLowerCase().includes(orderSearch.toLowerCase()) ||
      (o.customer?.displayName || "").toLowerCase().includes(orderSearch.toLowerCase()) ||
      (o.customer?.waId || "").includes(orderSearch) ||
      (o.notes || "").toLowerCase().includes(orderSearch.toLowerCase());

    const matchesStatus = statusFilter === "ALL" || o.status === statusFilter;
    const matchesSource = sourceFilter === "ALL" || o.source === sourceFilter;

    return matchesSearch && matchesStatus && matchesSource;
  });

  // Filtered customers
  const filteredCustomers = customers.filter((c) => {
    const q = customerSearch.toLowerCase().trim();
    return !q || c.displayName.toLowerCase().includes(q) || c.waId.includes(q);
  });

  // Filtered products
  const filteredProducts = products.filter((p) => {
    const q = productSearch.toLowerCase().trim();
    return !q || p.name.toLowerCase().includes(q) || (p.sku || "").toLowerCase().includes(q);
  });

  // Helper badge color
  const statusColorMap: Record<OrderStatus, { bg: string; text: string; border: string }> = {
    PENDING: { bg: "bg-amber-50", text: "text-amber-800", border: "border-amber-200" },
    CONFIRMED: { bg: "bg-sky-50", text: "text-sky-800", border: "border-sky-200" },
    PROCESSING: { bg: "bg-indigo-50", text: "text-indigo-800", border: "border-indigo-200" },
    SHIPPED: { bg: "bg-teal-50", text: "text-teal-800", border: "border-teal-200" },
    DELIVERED: { bg: "bg-emerald-50", text: "text-emerald-800", border: "border-emerald-200" },
    CANCELLED: { bg: "bg-rose-50", text: "text-rose-800", border: "border-rose-200" },
  };

  return (
    <div className="flex h-screen overflow-hidden bg-[#f0f2f5] font-sans text-[#111b21]">
      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 flex items-center gap-3 rounded-xl px-5 py-3.5 shadow-xl transition-all ${
            toast.type === "success"
              ? "bg-[#075e54] text-white"
              : toast.type === "error"
              ? "bg-rose-700 text-white"
              : "bg-[#111b21] text-white"
          }`}
        >
          <span className="text-lg">
            {toast.type === "success" ? "✓" : toast.type === "error" ? "⚠️" : "ℹ️"}
          </span>
          <p className="text-sm font-medium">{toast.message}</p>
          <button
            onClick={() => setToast(null)}
            className="ml-2 text-xs opacity-75 hover:opacity-100"
          >
            ✕
          </button>
        </div>
      )}

      {/* Sidebar Navigation */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-[#111b21] text-[#e9edef] transition-transform duration-200 md:static md:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Brand Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#00a884] text-xl font-bold text-white shadow-md">
              💬
            </div>
            <div>
              <h1 className="text-base font-bold leading-tight tracking-tight text-white">
                Order Manager
              </h1>
              <span className="text-xs text-[#00a884] font-medium">WhatsApp SaaS Desk</span>
            </div>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-white/10 md:hidden"
          >
            ✕
          </button>
        </div>

        {/* Store Profile Card */}
        <div className="mx-3 mt-3 rounded-xl bg-white/5 p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-[#8696a0] uppercase tracking-wider">
              Active Store
            </p>
            <span className="rounded bg-[#00a884]/20 px-1.5 py-0.5 text-[10px] font-semibold text-[#00a884]">
              {session.currency}
            </span>
          </div>
          <p className="mt-1 truncate text-sm font-bold text-white">{session.orgName}</p>
          <p className="truncate text-xs text-[#8696a0]">{session.email}</p>
        </div>

        {/* Navigation Items */}
        <nav className="flex-1 space-y-1.5 overflow-y-auto px-3 py-4">
          {[
            { id: "dashboard", label: "Dashboard", icon: "📊" },
            { id: "orders", label: "Orders", icon: "📦", count: orders.length },
            { id: "customers", label: "Customers", icon: "👥", count: customers.length },
            { id: "products", label: "Products", icon: "🏷️", count: products.length },
            {
              id: "whatsapp",
              label: "WhatsApp",
              icon: "📱",
              badge: whatsapp?.phoneNumberId ? "Connected" : "Setup",
            },
            { id: "reports", label: "Reports", icon: "📈" },
            { id: "settings", label: "Settings", icon: "⚙️" },
          ].map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setActiveTab(item.id as Tab);
                  setSidebarOpen(false);
                }}
                className={`flex w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-[#00a884] text-white shadow-sm"
                    : "text-[#8696a0] hover:bg-white/10 hover:text-white"
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-base">{item.icon}</span>
                  <span>{item.label}</span>
                </div>
                {item.count !== undefined && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      isActive ? "bg-black/20 text-white" : "bg-white/10 text-zinc-300"
                    }`}
                  >
                    {item.count}
                  </span>
                )}
                {item.badge && (
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                      isActive
                        ? "bg-black/20 text-white"
                        : item.badge === "Connected"
                        ? "bg-emerald-500/20 text-emerald-400"
                        : "bg-amber-500/20 text-amber-400"
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Footer Database Mode Indicator */}
        <div className="border-t border-white/10 p-3">
          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-amber-400"></span>
              <p className="text-xs font-semibold text-zinc-300">
                {demoMode ? "Demo Mode (Mock Store)" : "PostgreSQL Database"}
              </p>
            </div>
            <p className="mt-1 text-[11px] text-[#8696a0]">
              {demoMode
                ? "Local JSON data. No SQL setup required."
                : "Live database connected via Prisma."}
            </p>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top Header */}
        <header className="flex h-16 items-center justify-between border-b border-[#e9edef] bg-white px-4 md:px-8">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="rounded-lg p-2 text-zinc-600 hover:bg-zinc-100 md:hidden"
            >
              ☰
            </button>
            <div>
              <h2 className="text-lg font-bold capitalize text-[#111b21]">
                {activeTab === "dashboard"
                  ? "Store Dashboard"
                  : activeTab === "whatsapp"
                  ? "WhatsApp Cloud API Integration"
                  : activeTab}
              </h2>
              <p className="text-xs text-[#667781]">
                {activeTab === "dashboard" && "Live orders, performance overview and quick operations"}
                {activeTab === "orders" && "Manage customer orders, track progress and send updates"}
                {activeTab === "customers" && "Customer phone numbers and WhatsApp ordering history"}
                {activeTab === "products" && "Product catalog, items, pricing, and active SKU management"}
                {activeTab === "whatsapp" && "Meta WhatsApp Cloud API credentials & webhook status"}
                {activeTab === "reports" && "Sales revenue, order status distribution and trends"}
                {activeTab === "settings" && "Store profile, currency, and database configuration"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Status indicator badges */}
            <div className="hidden sm:flex items-center gap-2">
              {demoMode ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 border border-amber-200">
                  <span className="h-2 w-2 rounded-full bg-amber-500"></span>
                  Demo Store
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800 border border-emerald-200">
                  <span className="h-2 w-2 rounded-full bg-emerald-500"></span>
                  Postgres Live
                </span>
              )}

              {whatsapp?.phoneNumberId ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800 border border-emerald-200">
                  <span className="h-2 w-2 rounded-full bg-emerald-500"></span>
                  WhatsApp Connected
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-600 border border-zinc-200">
                  <span className="h-2 w-2 rounded-full bg-zinc-400"></span>
                  WhatsApp Setup Pending
                </span>
              )}
            </div>

            {/* Quick Create Order Button */}
            <button
              onClick={() => openAddOrder()}
              className="inline-flex items-center gap-2 rounded-xl bg-[#00a884] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#008f71] transition-all"
            >
              <span className="text-base">+</span> New Order
            </button>
          </div>
        </header>

        {/* Scrollable View Container */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
          {/* ============================================================== */}
          {/* TAB 1: DASHBOARD VIEW */}
          {/* ============================================================== */}
          {activeTab === "dashboard" && (
            <div className="space-y-6">
              {/* Demo Mode Notice Banner */}
              {demoMode && (
                <div className="flex flex-col gap-2 rounded-2xl border border-amber-200 bg-amber-50/80 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3">
                    <span className="text-2xl">💡</span>
                    <div>
                      <h4 className="text-sm font-bold text-amber-900">
                        Running in Interactive Demo Mode
                      </h4>
                      <p className="text-xs text-amber-800 mt-0.5">
                        Data is stored locally in <code className="bg-amber-200/60 px-1 py-0.5 rounded font-mono text-[11px]">data/demo-store.json</code>. You can create orders, change statuses, manage catalog and customers immediately without setting up PostgreSQL.
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setActiveTab("settings")}
                    className="self-start sm:self-auto rounded-lg bg-amber-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-900"
                  >
                    View DB Config
                  </button>
                </div>
              )}

              {/* Stat Metric Cards */}
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-2xl border border-black/5 bg-white p-5 shadow-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-[#667781]">
                      Today&apos;s Orders
                    </span>
                    <span className="rounded-xl bg-emerald-50 p-2 text-emerald-600 text-lg">
                      📦
                    </span>
                  </div>
                  <p className="mt-2 text-3xl font-extrabold text-[#111b21]">
                    {stats.todayOrders}
                  </p>
                  <p className="mt-1 text-xs text-[#667781]">New today</p>
                </div>

                <div className="rounded-2xl border border-black/5 bg-white p-5 shadow-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-[#667781]">
                      Total Orders
                    </span>
                    <span className="rounded-xl bg-blue-50 p-2 text-blue-600 text-lg">
                      📋
                    </span>
                  </div>
                  <p className="mt-2 text-3xl font-extrabold text-[#111b21]">
                    {stats.totalOrders}
                  </p>
                  <p className="mt-1 text-xs text-[#667781]">All-time received</p>
                </div>

                <div className="rounded-2xl border border-black/5 bg-white p-5 shadow-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-[#667781]">
                      Total Revenue
                    </span>
                    <span className="rounded-xl bg-emerald-50 p-2 text-emerald-600 text-lg">
                      💰
                    </span>
                  </div>
                  <p className="mt-2 text-3xl font-extrabold text-[#00a884]">
                    {formatMoney(stats.revenueMinor, session.currency)}
                  </p>
                  <p className="mt-1 text-xs text-[#667781]">Completed / active sales</p>
                </div>

                <div className="rounded-2xl border border-black/5 bg-white p-5 shadow-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-[#667781]">
                      Store Catalog
                    </span>
                    <span className="rounded-xl bg-indigo-50 p-2 text-indigo-600 text-lg">
                      🏷️
                    </span>
                  </div>
                  <p className="mt-2 text-3xl font-extrabold text-[#111b21]">
                    {stats.productCount}
                  </p>
                  <p className="mt-1 text-xs text-[#667781]">
                    {stats.customerCount} registered customers
                  </p>
                </div>
              </div>

              {/* Status Breakdown Grid */}
              <div>
                <h3 className="text-sm font-bold uppercase tracking-wider text-[#667781] mb-3">
                  Orders Pipeline Status
                </h3>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  {ORDER_STATUSES.map((status) => {
                    const count = stats.byStatus[status] || 0;
                    const style = statusColorMap[status];
                    return (
                      <button
                        key={status}
                        onClick={() => {
                          setStatusFilter(status);
                          setActiveTab("orders");
                        }}
                        className={`flex flex-col items-start rounded-2xl border p-4 text-left transition-all hover:shadow-md ${style.bg} ${style.border}`}
                      >
                        <span className={`text-xs font-bold uppercase ${style.text}`}>
                          {statusLabel(status)}
                        </span>
                        <span className="mt-2 text-2xl font-black text-[#111b21]">
                          {count}
                        </span>
                        <span className="mt-1 text-[11px] text-zinc-500">
                          Click to filter →
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Recent Orders Section */}
              <div className="rounded-2xl border border-black/5 bg-white p-5 shadow-xs">
                <div className="flex items-center justify-between border-b border-black/5 pb-4">
                  <div>
                    <h3 className="text-base font-bold text-[#111b21]">Recent Orders</h3>
                    <p className="text-xs text-[#667781]">
                      Latest WhatsApp & manual orders requiring desk attention
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setStatusFilter("ALL");
                      setActiveTab("orders");
                    }}
                    className="text-xs font-semibold text-[#00a884] hover:underline"
                  >
                    View all orders ({orders.length}) →
                  </button>
                </div>

                <div className="mt-4 overflow-x-auto">
                  {orders.length === 0 ? (
                    <div className="py-12 text-center text-[#8696a0]">
                      <p className="text-3xl mb-2">📦</p>
                      <p className="text-sm font-medium">No orders recorded yet.</p>
                      <button
                        onClick={() => openAddOrder()}
                        className="mt-3 rounded-lg bg-[#00a884] px-4 py-2 text-xs font-semibold text-white"
                      >
                        Create First Order
                      </button>
                    </div>
                  ) : (
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-black/5 text-xs text-[#667781]">
                          <th className="pb-3 font-semibold">Order ID</th>
                          <th className="pb-3 font-semibold">Customer</th>
                          <th className="pb-3 font-semibold">Items</th>
                          <th className="pb-3 font-semibold">Amount</th>
                          <th className="pb-3 font-semibold">Status</th>
                          <th className="pb-3 font-semibold">Source</th>
                          <th className="pb-3 font-semibold text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-black/5">
                        {orders.slice(0, 6).map((order) => {
                          const style = statusColorMap[order.status];
                          const nextStatuses = ALLOWED_TRANSITIONS[order.status];
                          return (
                            <tr key={order.id} className="hover:bg-zinc-50/60 transition-colors">
                              <td className="py-3 font-mono text-xs font-bold text-[#111b21]">
                                #{order.id.slice(0, 8)}
                              </td>
                              <td className="py-3">
                                <p className="font-semibold text-[#111b21]">
                                  {order.customer?.displayName || "Guest Customer"}
                                </p>
                                <p className="text-xs text-[#8696a0]">
                                  +{order.customer?.waId}
                                </p>
                              </td>
                              <td className="py-3 max-w-xs">
                                <p className="truncate text-xs text-zinc-700">
                                  {order.items && order.items.length > 0
                                    ? order.items.map((i) => `${i.qty}x ${i.nameSnapshot}`).join(", ")
                                    : "No items listed"}
                                </p>
                              </td>
                              <td className="py-3 font-bold text-[#111b21]">
                                {formatMoney(order.totalMinor, order.currency)}
                              </td>
                              <td className="py-3">
                                <span
                                  className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${style.bg} ${style.text} ${style.border}`}
                                >
                                  {statusLabel(order.status)}
                                </span>
                              </td>
                              <td className="py-3">
                                <span
                                  className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${
                                    order.source === "WHATSAPP"
                                      ? "bg-[#00a884]/10 text-[#00a884]"
                                      : "bg-zinc-100 text-zinc-700"
                                  }`}
                                >
                                  {order.source === "WHATSAPP" ? "💬 WhatsApp" : "Desk Manual"}
                                </span>
                              </td>
                              <td className="py-3 text-right">
                                <div className="inline-flex items-center gap-1.5">
                                  {nextStatuses.length > 0 && nextStatuses[0] && (
                                    <button
                                      disabled={isPending}
                                      onClick={() => handleTransition(order.id, nextStatuses[0])}
                                      className="rounded-lg bg-[#00a884] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#008f71]"
                                    >
                                      → {statusLabel(nextStatuses[0])}
                                    </button>
                                  )}
                                  <button
                                    onClick={() => setSelectedOrderDetails(order)}
                                    className="rounded-lg border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
                                  >
                                    View
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB 2: ORDERS MANAGEMENT VIEW */}
          {/* ============================================================== */}
          {activeTab === "orders" && (
            <div className="space-y-5">
              {/* Order Controls Bar */}
              <div className="flex flex-col gap-3 rounded-2xl border border-black/5 bg-white p-4 shadow-xs md:flex-row md:items-center md:justify-between">
                <div className="flex flex-1 flex-wrap items-center gap-3">
                  {/* Search Input */}
                  <div className="relative min-w-[240px] flex-1">
                    <span className="absolute left-3 top-2.5 text-zinc-400">🔍</span>
                    <input
                      type="text"
                      placeholder="Search orders by customer, phone, ID or notes..."
                      value={orderSearch}
                      onChange={(e) => setOrderSearch(e.target.value)}
                      className="w-full rounded-xl border border-zinc-200 bg-zinc-50/50 py-2 pl-9 pr-4 text-xs font-medium focus:border-[#00a884] focus:bg-white focus:outline-none"
                    />
                  </div>

                  {/* Source Filter */}
                  <select
                    value={sourceFilter}
                    onChange={(e) => setSourceFilter(e.target.value as OrderSource | "ALL")}
                    className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-700 focus:outline-none"
                  >
                    <option value="ALL">All Sources</option>
                    <option value="WHATSAPP">WhatsApp Channel</option>
                    <option value="MANUAL">Manual Desk</option>
                  </select>
                </div>

                <button
                  onClick={() => openAddOrder()}
                  className="rounded-xl bg-[#00a884] px-4 py-2 text-xs font-semibold text-white hover:bg-[#008f71]"
                >
                  + Add New Order
                </button>
              </div>

              {/* Status Filter Tabs */}
              <div className="flex flex-wrap gap-1.5 overflow-x-auto pb-1">
                <button
                  onClick={() => setStatusFilter("ALL")}
                  className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition-all ${
                    statusFilter === "ALL"
                      ? "bg-[#111b21] text-white shadow-sm"
                      : "bg-white text-zinc-600 hover:bg-zinc-100"
                  }`}
                >
                  All Orders ({orders.length})
                </button>
                {ORDER_STATUSES.map((status) => {
                  const count = orders.filter((o) => o.status === status).length;
                  const isSelected = statusFilter === status;
                  return (
                    <button
                      key={status}
                      onClick={() => setStatusFilter(status)}
                      className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-all ${
                        isSelected
                          ? "bg-[#00a884] text-white shadow-sm"
                          : "bg-white text-zinc-600 hover:bg-zinc-100"
                      }`}
                    >
                      <span>{statusLabel(status)}</span>
                      <span
                        className={`rounded-full px-1.5 py-0.2 text-[10px] ${
                          isSelected ? "bg-black/20 text-white" : "bg-zinc-100 text-zinc-600"
                        }`}
                      >
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Full Orders Table */}
              <div className="rounded-2xl border border-black/5 bg-white shadow-xs overflow-hidden">
                <div className="overflow-x-auto">
                  {filteredOrders.length === 0 ? (
                    <div className="py-16 text-center text-[#8696a0]">
                      <p className="text-4xl mb-2">🔍</p>
                      <p className="text-base font-semibold text-zinc-700">No orders found</p>
                      <p className="text-xs text-zinc-500 mt-1">
                        Try changing the search keyword or status filters.
                      </p>
                    </div>
                  ) : (
                    <table className="w-full text-left text-sm">
                      <thead className="bg-[#f0f2f5]/60 text-xs text-[#667781] uppercase font-semibold">
                        <tr>
                          <th className="px-5 py-3.5">Order</th>
                          <th className="px-5 py-3.5">Customer</th>
                          <th className="px-5 py-3.5">Items & Details</th>
                          <th className="px-5 py-3.5">Total Amount</th>
                          <th className="px-5 py-3.5">Status</th>
                          <th className="px-5 py-3.5">Channel</th>
                          <th className="px-5 py-3.5">Date</th>
                          <th className="px-5 py-3.5 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-black/5">
                        {filteredOrders.map((order) => {
                          const style = statusColorMap[order.status];
                          const nextStatuses = ALLOWED_TRANSITIONS[order.status];

                          return (
                            <tr key={order.id} className="hover:bg-zinc-50/70 transition-colors">
                              <td className="px-5 py-4">
                                <span className="font-mono text-xs font-bold text-[#111b21]">
                                  #{order.id.slice(0, 8)}
                                </span>
                              </td>
                              <td className="px-5 py-4">
                                <p className="font-bold text-[#111b21]">
                                  {order.customer?.displayName || "Unknown Customer"}
                                </p>
                                <a
                                  href={`https://wa.me/${order.customer?.waId}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs text-[#00a884] font-medium hover:underline inline-flex items-center gap-1"
                                >
                                  💬 +{order.customer?.waId}
                                </a>
                              </td>
                              <td className="px-5 py-4 max-w-xs">
                                <div className="space-y-1">
                                  {order.items && order.items.length > 0 ? (
                                    order.items.map((it, idx) => (
                                      <p key={idx} className="text-xs text-zinc-800">
                                        <span className="font-semibold text-zinc-950">{it.qty}x</span>{" "}
                                        {it.nameSnapshot}
                                      </p>
                                    ))
                                  ) : (
                                    <p className="text-xs text-zinc-400">No items listed</p>
                                  )}
                                  {order.notes && (
                                    <p className="text-[11px] italic text-[#8696a0]">
                                      Note: {order.notes}
                                    </p>
                                  )}
                                </div>
                              </td>
                              <td className="px-5 py-4">
                                <span className="font-black text-[#111b21] text-base">
                                  {formatMoney(order.totalMinor, order.currency)}
                                </span>
                              </td>
                              <td className="px-5 py-4">
                                <span
                                  className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-bold ${style.bg} ${style.text} ${style.border}`}
                                >
                                  {statusLabel(order.status)}
                                </span>
                              </td>
                              <td className="px-5 py-4">
                                <span
                                  className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${
                                    order.source === "WHATSAPP"
                                      ? "bg-[#00a884]/10 text-[#00a884]"
                                      : "bg-zinc-100 text-zinc-700"
                                  }`}
                                >
                                  {order.source === "WHATSAPP" ? "💬 WhatsApp" : "Desk Manual"}
                                </span>
                              </td>
                              <td className="px-5 py-4 text-xs text-[#8696a0]">
                                {formatDate(order.createdAt)}
                              </td>
                              <td className="px-5 py-4 text-right">
                                <div className="inline-flex items-center gap-1.5">
                                  {/* Quick status progress buttons */}
                                  {nextStatuses.map((nextSt) => (
                                    <button
                                      key={nextSt}
                                      disabled={isPending}
                                      onClick={() => handleTransition(order.id, nextSt)}
                                      className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-all ${
                                        nextSt === "CANCELLED"
                                          ? "border border-rose-200 text-rose-700 hover:bg-rose-50"
                                          : "bg-[#00a884] text-white hover:bg-[#008f71]"
                                      }`}
                                    >
                                      {nextSt === "CANCELLED" ? "Cancel" : `→ ${statusLabel(nextSt)}`}
                                    </button>
                                  ))}

                                  <button
                                    onClick={() => openEditOrder(order)}
                                    className="rounded-lg border border-zinc-200 px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100"
                                    title="Edit order"
                                  >
                                    ✏️
                                  </button>
                                  <button
                                    onClick={() => setSelectedOrderDetails(order)}
                                    className="rounded-lg border border-zinc-200 px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100"
                                    title="View full details"
                                  >
                                    👁️
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB 3: CUSTOMERS VIEW */}
          {/* ============================================================== */}
          {activeTab === "customers" && (
            <div className="space-y-5">
              <div className="flex flex-col gap-3 rounded-2xl border border-black/5 bg-white p-4 shadow-xs sm:flex-row sm:items-center sm:justify-between">
                <div className="relative min-w-[260px] flex-1">
                  <span className="absolute left-3 top-2.5 text-zinc-400">🔍</span>
                  <input
                    type="text"
                    placeholder="Search customers by name or WhatsApp phone..."
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                    className="w-full rounded-xl border border-zinc-200 bg-zinc-50/50 py-2 pl-9 pr-4 text-xs font-medium focus:border-[#00a884] focus:bg-white focus:outline-none"
                  />
                </div>
                <button
                  onClick={() => {
                    setEditingCustomer(null);
                    setIsAddCustomerOpen(true);
                  }}
                  className="rounded-xl bg-[#00a884] px-4 py-2 text-xs font-semibold text-white hover:bg-[#008f71]"
                >
                  + Add New Customer
                </button>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {filteredCustomers.map((customer) => {
                  const customerOrders = orders.filter((o) => o.customerId === customer.id);
                  const totalSpent = customerOrders
                    .filter((o) => o.status !== "CANCELLED")
                    .reduce((sum, o) => sum + o.totalMinor, 0);

                  return (
                    <div
                      key={customer.id}
                      className="flex flex-col justify-between rounded-2xl border border-black/5 bg-white p-5 shadow-xs hover:shadow-md transition-shadow"
                    >
                      <div>
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-3">
                            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#00a884]/15 text-lg font-bold text-[#00a884]">
                              {customer.displayName.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <h4 className="font-bold text-[#111b21]">{customer.displayName}</h4>
                              <a
                                href={`https://wa.me/${customer.waId}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs font-semibold text-[#00a884] hover:underline"
                              >
                                💬 +{customer.waId}
                              </a>
                            </div>
                          </div>

                          <button
                            onClick={() => {
                              setEditingCustomer(customer);
                              setIsAddCustomerOpen(true);
                            }}
                            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
                          >
                            ✏️
                          </button>
                        </div>

                        {customer.notes && (
                          <div className="mt-3 rounded-xl bg-zinc-50 p-2.5 text-xs text-zinc-600">
                            <span className="font-semibold text-zinc-700">Note:</span> {customer.notes}
                          </div>
                        )}

                        <div className="mt-4 grid grid-cols-2 gap-2 border-t border-black/5 pt-3 text-xs">
                          <div>
                            <p className="text-[#8696a0]">Total Orders</p>
                            <p className="font-bold text-[#111b21] text-sm">
                              {customerOrders.length}
                            </p>
                          </div>
                          <div>
                            <p className="text-[#8696a0]">Total Spent</p>
                            <p className="font-bold text-[#00a884] text-sm">
                              {formatMoney(totalSpent, session.currency)}
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 pt-3 border-t border-black/5">
                        <button
                          onClick={() => openAddOrder(customer.id)}
                          className="w-full rounded-xl bg-[#00a884]/10 py-2 text-xs font-semibold text-[#00a884] hover:bg-[#00a884] hover:text-white transition-colors"
                        >
                          + Create Order for {customer.displayName.split(" ")[0]}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB 4: PRODUCTS VIEW */}
          {/* ============================================================== */}
          {activeTab === "products" && (
            <div className="space-y-5">
              <div className="flex flex-col gap-3 rounded-2xl border border-black/5 bg-white p-4 shadow-xs sm:flex-row sm:items-center sm:justify-between">
                <div className="relative min-w-[260px] flex-1">
                  <span className="absolute left-3 top-2.5 text-zinc-400">🔍</span>
                  <input
                    type="text"
                    placeholder="Search catalog by product name or SKU..."
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    className="w-full rounded-xl border border-zinc-200 bg-zinc-50/50 py-2 pl-9 pr-4 text-xs font-medium focus:border-[#00a884] focus:bg-white focus:outline-none"
                  />
                </div>
                <button
                  onClick={() => {
                    setEditingProduct(null);
                    setIsAddProductOpen(true);
                  }}
                  className="rounded-xl bg-[#00a884] px-4 py-2 text-xs font-semibold text-white hover:bg-[#008f71]"
                >
                  + Add New Product
                </button>
              </div>

              <div className="rounded-2xl border border-black/5 bg-white shadow-xs overflow-hidden">
                <table className="w-full text-left text-sm">
                  <thead className="bg-[#f0f2f5]/60 text-xs text-[#667781] uppercase font-semibold">
                    <tr>
                      <th className="px-5 py-3.5">Product Name</th>
                      <th className="px-5 py-3.5">SKU</th>
                      <th className="px-5 py-3.5">Description</th>
                      <th className="px-5 py-3.5">Price</th>
                      <th className="px-5 py-3.5">Status</th>
                      <th className="px-5 py-3.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/5">
                    {filteredProducts.map((product) => (
                      <tr key={product.id} className="hover:bg-zinc-50/70 transition-colors">
                        <td className="px-5 py-4 font-bold text-[#111b21]">{product.name}</td>
                        <td className="px-5 py-4">
                          <code className="rounded bg-zinc-100 px-2 py-1 font-mono text-xs text-zinc-700">
                            {product.sku || "—"}
                          </code>
                        </td>
                        <td className="px-5 py-4 text-xs text-[#8696a0] max-w-sm">
                          {product.description || "No description"}
                        </td>
                        <td className="px-5 py-4 font-extrabold text-[#111b21] text-base">
                          {formatMoney(product.priceMinor, product.currency)}
                        </td>
                        <td className="px-5 py-4">
                          {product.isActive ? (
                            <span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-700 border border-emerald-200">
                              Active
                            </span>
                          ) : (
                            <span className="inline-flex rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-bold text-zinc-600">
                              Inactive
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-4 text-right">
                          <div className="inline-flex items-center gap-2">
                            <button
                              onClick={() => {
                                setEditingProduct(product);
                                setIsAddProductOpen(true);
                              }}
                              className="rounded-lg border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDeleteProduct(product.id)}
                              className="rounded-lg border border-rose-200 px-2.5 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB 5: WHATSAPP CLOUD API CONFIGURATION VIEW */}
          {/* ============================================================== */}
          {activeTab === "whatsapp" && (
            <div className="space-y-6 max-w-4xl">
              {/* Requirement 9: Truthful Status Banner */}
              <div className="rounded-2xl border border-blue-200 bg-blue-50/80 p-5">
                <div className="flex items-start gap-3">
                  <span className="text-2xl">📱</span>
                  <div>
                    <h3 className="text-sm font-bold text-blue-950">
                      Official Meta WhatsApp Cloud API Channel
                    </h3>
                    <p className="mt-1 text-xs text-blue-900 leading-relaxed">
                      This application connects directly to Meta&apos;s official WhatsApp Business Cloud API.
                      {whatsapp?.phoneNumberId ? (
                        <span className="font-semibold text-emerald-800 ml-1">
                          Tenant credentials are saved in the database.
                        </span>
                      ) : (
                        <span className="font-semibold text-amber-800 ml-1">
                          No credentials configured yet. Live WhatsApp messages will not be sent until you provide valid Meta Cloud API credentials.
                        </span>
                      )}
                    </p>
                  </div>
                </div>
              </div>

              {/* Webhook Configuration Box */}
              <div className="rounded-2xl border border-black/5 bg-white p-6 shadow-xs">
                <h3 className="text-base font-bold text-[#111b21]">Meta Webhook Setup</h3>
                <p className="text-xs text-[#667781] mt-1">
                  Configure these details inside your Meta App Dashboard under WhatsApp &gt; Configuration:
                </p>

                <div className="mt-4 space-y-3">
                  <div>
                    <label className="text-xs font-semibold text-zinc-700">Webhook Callback URL</label>
                    <div className="mt-1 flex items-center gap-2">
                      <input
                        readOnly
                        value={
                          typeof window !== "undefined"
                            ? `${window.location.origin}/api/webhooks/whatsapp`
                            : "http://localhost:3000/api/webhooks/whatsapp"
                        }
                        className="flex-1 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 font-mono text-xs text-zinc-800"
                      />
                      <button
                        onClick={() => {
                          const url = `${window.location.origin}/api/webhooks/whatsapp`;
                          navigator.clipboard.writeText(url);
                          showToast("Webhook URL copied to clipboard!");
                        }}
                        className="rounded-xl bg-zinc-100 px-3 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-200"
                      >
                        Copy
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-zinc-700">Webhook Verify Token</label>
                    <div className="mt-1 flex items-center gap-2">
                      <input
                        readOnly
                        value={whatsapp?.webhookVerifyToken || "change-me-webhook-verify-token"}
                        className="flex-1 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 font-mono text-xs text-zinc-800"
                      />
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(
                            whatsapp?.webhookVerifyToken || "change-me-webhook-verify-token"
                          );
                          showToast("Verify Token copied!");
                        }}
                        className="rounded-xl bg-zinc-100 px-3 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-200"
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* WhatsApp Credentials Form */}
              <div className="rounded-2xl border border-black/5 bg-white p-6 shadow-xs">
                <h3 className="text-base font-bold text-[#111b21]">WhatsApp API Credentials</h3>
                <p className="text-xs text-[#667781] mt-1">
                  Tokens are encrypted with AES-256-GCM before saving into the database.
                </p>

                <form onSubmit={handleWhatsAppSettings} className="mt-5 space-y-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className="text-xs font-bold text-zinc-700">WABA ID (WhatsApp Business Account ID)</label>
                      <input
                        type="text"
                        name="wabaId"
                        defaultValue={whatsapp?.wabaId || ""}
                        placeholder="e.g. 109283746592817"
                        className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm focus:border-[#00a884] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-zinc-700">Phone Number ID</label>
                      <input
                        type="text"
                        name="phoneNumberId"
                        defaultValue={whatsapp?.phoneNumberId || ""}
                        placeholder="e.g. 102938475610293"
                        className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm focus:border-[#00a884] focus:outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-bold text-zinc-700">
                      System User Permanent Access Token
                    </label>
                    <input
                      type="password"
                      name="accessToken"
                      placeholder={
                        whatsapp?.encryptedAccessToken
                          ? "•••••••••••••••• (Encrypted token already saved - leave blank to keep)"
                          : "Paste Meta System User Access Token (EAAG...)"
                      }
                      className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm focus:border-[#00a884] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-bold text-zinc-700">Verify Token</label>
                    <input
                      type="text"
                      name="webhookVerifyToken"
                      defaultValue={whatsapp?.webhookVerifyToken || "demo-verify"}
                      placeholder="e.g. demo-verify"
                      className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm focus:border-[#00a884] focus:outline-none"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isPending}
                    className="rounded-xl bg-[#00a884] px-5 py-2.5 text-xs font-bold text-white hover:bg-[#008f71]"
                  >
                    Save WhatsApp Connection
                  </button>
                </form>
              </div>

              {/* Test Message Simulator */}
              <div className="rounded-2xl border border-black/5 bg-white p-6 shadow-xs">
                <h3 className="text-base font-bold text-[#111b21]">Test Notification Sender</h3>
                <p className="text-xs text-[#667781] mt-1">
                  Send a test status message to verify integration.
                </p>

                <form onSubmit={handleSendTest} className="mt-4 flex flex-col gap-3 sm:flex-row">
                  <input
                    type="text"
                    name="to"
                    value={testPhone}
                    onChange={(e) => setTestPhone(e.target.value)}
                    placeholder="Recipient phone with country code (e.g. 923001234567)"
                    className="flex-1 rounded-xl border border-zinc-200 px-3 py-2 text-sm focus:border-[#00a884] focus:outline-none"
                    required
                  />
                  <button
                    type="submit"
                    disabled={isPending}
                    className="rounded-xl bg-[#111b21] px-5 py-2 text-xs font-bold text-white hover:bg-black"
                  >
                    Send Test Message
                  </button>
                </form>

                {testResult && (
                  <div className="mt-3 rounded-xl bg-zinc-100 p-3 text-xs text-zinc-800">
                    {testResult}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB 6: REPORTS VIEW */}
          {/* ============================================================== */}
          {activeTab === "reports" && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="rounded-2xl border border-black/5 bg-white p-5 shadow-xs">
                  <p className="text-xs font-bold uppercase tracking-wider text-[#667781]">
                    Total Gross Sales
                  </p>
                  <p className="mt-2 text-3xl font-extrabold text-[#00a884]">
                    {formatMoney(stats.revenueMinor, session.currency)}
                  </p>
                  <p className="mt-1 text-xs text-[#667781]">Excluding cancelled orders</p>
                </div>

                <div className="rounded-2xl border border-black/5 bg-white p-5 shadow-xs">
                  <p className="text-xs font-bold uppercase tracking-wider text-[#667781]">
                    Average Order Value (AOV)
                  </p>
                  <p className="mt-2 text-3xl font-extrabold text-[#111b21]">
                    {stats.totalOrders > 0
                      ? formatMoney(
                          Math.round(stats.revenueMinor / stats.totalOrders),
                          session.currency
                        )
                      : formatMoney(0, session.currency)}
                  </p>
                  <p className="mt-1 text-xs text-[#667781]">Per placed order</p>
                </div>

                <div className="rounded-2xl border border-black/5 bg-white p-5 shadow-xs">
                  <p className="text-xs font-bold uppercase tracking-wider text-[#667781]">
                    Order Fulfillment Rate
                  </p>
                  <p className="mt-2 text-3xl font-extrabold text-[#111b21]">
                    {stats.totalOrders > 0
                      ? `${Math.round(
                          ((stats.byStatus.DELIVERED || 0) / stats.totalOrders) * 100
                        )}%`
                      : "0%"}
                  </p>
                  <p className="mt-1 text-xs text-[#667781]">
                    {stats.byStatus.DELIVERED || 0} delivered of {stats.totalOrders} total
                  </p>
                </div>
              </div>

              {/* Status Breakdown Bar */}
              <div className="rounded-2xl border border-black/5 bg-white p-6 shadow-xs">
                <h3 className="text-base font-bold text-[#111b21]">Order Distribution</h3>
                <div className="mt-4 space-y-3">
                  {ORDER_STATUSES.map((status) => {
                    const count = stats.byStatus[status] || 0;
                    const pct = stats.totalOrders > 0 ? (count / stats.totalOrders) * 100 : 0;
                    return (
                      <div key={status}>
                        <div className="flex justify-between text-xs font-semibold mb-1">
                          <span className="text-[#111b21]">{statusLabel(status)}</span>
                          <span className="text-zinc-500">
                            {count} orders ({pct.toFixed(0)}%)
                          </span>
                        </div>
                        <div className="h-2 w-full rounded-full bg-zinc-100 overflow-hidden">
                          <div
                            className="h-full bg-[#00a884] rounded-full"
                            style={{ width: `${pct}%` }}
                          ></div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB 7: SETTINGS VIEW */}
          {/* ============================================================== */}
          {activeTab === "settings" && (
            <div className="space-y-6 max-w-3xl">
              {/* Store Profile */}
              <div className="rounded-2xl border border-black/5 bg-white p-6 shadow-xs">
                <h3 className="text-base font-bold text-[#111b21]">Store Profile</h3>
                <p className="text-xs text-[#667781] mt-1">
                  Manage your organization name and preferred display currency.
                </p>

                <form onSubmit={handleOrgSettings} className="mt-5 space-y-4">
                  <div>
                    <label className="text-xs font-bold text-zinc-700">Business / Store Name</label>
                    <input
                      type="text"
                      name="name"
                      defaultValue={session.orgName}
                      required
                      className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm focus:border-[#00a884] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-bold text-zinc-700">Store Currency</label>
                    <input
                      type="text"
                      name="currency"
                      defaultValue={session.currency}
                      required
                      className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm focus:border-[#00a884] focus:outline-none"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isPending}
                    className="rounded-xl bg-[#00a884] px-5 py-2.5 text-xs font-bold text-white hover:bg-[#008f71]"
                  >
                    Save Store Settings
                  </button>
                </form>
              </div>

              {/* Requirement 8: Database & Storage Mode Information */}
              <div className="rounded-2xl border border-black/5 bg-white p-6 shadow-xs">
                <h3 className="text-base font-bold text-[#111b21]">
                  Database & Storage Architecture
                </h3>
                <div className="mt-3 space-y-3 text-xs text-zinc-700">
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-3 w-3 rounded-full ${
                        demoMode ? "bg-amber-500" : "bg-emerald-500"
                      }`}
                    ></span>
                    <span className="font-bold text-sm">
                      Current Mode: {demoMode ? "Local File-based Demo Store" : "PostgreSQL Database"}
                    </span>
                  </div>

                  {demoMode ? (
                    <div className="rounded-xl bg-amber-50 p-4 border border-amber-200 space-y-2">
                      <p className="font-semibold text-amber-900">
                        Notice: You are running on demo file storage.
                      </p>
                      <p className="text-amber-800">
                        Orders, products, and customers are saved to <code className="font-mono bg-white px-1 py-0.5 rounded">data/demo-store.json</code> so you don&apos;t need a live database server to run and test.
                      </p>
                      <p className="font-semibold text-amber-900 pt-1">
                        To connect to a real PostgreSQL database:
                      </p>
                      <ol className="list-decimal list-inside text-amber-800 space-y-1 font-mono text-[11px]">
                        <li>Create a .env.local file from .env.example</li>
                        <li>Set DATABASE_URL=&quot;postgresql://...&quot;</li>
                        <li>Set DEMO_MODE=&quot;false&quot;</li>
                        <li>Run: npx prisma migrate dev</li>
                      </ol>
                    </div>
                  ) : (
                    <div className="rounded-xl bg-emerald-50 p-4 border border-emerald-200">
                      <p className="font-semibold text-emerald-900">
                        Running against live PostgreSQL via Prisma.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* ============================================================== */}
      {/* MODAL: ADD / EDIT ORDER */}
      {/* ============================================================== */}
      {isAddOrderOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-black/5 pb-4">
              <h3 className="text-lg font-bold text-[#111b21]">
                {editingOrder ? "Edit Order" : "Create New Order"}
              </h3>
              <button
                onClick={() => setIsAddOrderOpen(false)}
                className="rounded-full p-2 text-zinc-400 hover:bg-zinc-100"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleOrderSubmit} className="mt-4 space-y-4">
              {/* Customer Picker */}
              <div>
                <label className="text-xs font-bold text-zinc-700">Select Customer *</label>
                <div className="mt-1 flex gap-2">
                  <select
                    value={orderCustomerSelect}
                    onChange={(e) => setOrderCustomerSelect(e.target.value)}
                    required
                    className="flex-1 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm focus:border-[#00a884] focus:outline-none"
                  >
                    <option value="">-- Choose Customer --</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.displayName} (+{c.waId})
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingCustomer(null);
                      setIsAddCustomerOpen(true);
                    }}
                    className="rounded-xl border border-zinc-200 px-3 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-50"
                  >
                    + New Customer
                  </button>
                </div>
              </div>

              {/* Items Section */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-bold text-zinc-700">Order Items *</label>
                  <button
                    type="button"
                    onClick={() =>
                      setOrderItems((prev) => [
                        ...prev,
                        { productId: "", name: "", unitPrice: 0, qty: 1 },
                      ])
                    }
                    className="text-xs font-semibold text-[#00a884] hover:underline"
                  >
                    + Add Item Row
                  </button>
                </div>

                <div className="space-y-2">
                  {orderItems.map((item, idx) => (
                    <div
                      key={idx}
                      className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50/50 p-2.5"
                    >
                      {/* Pick from Catalog */}
                      <select
                        value={item.productId}
                        onChange={(e) => {
                          const prodId = e.target.value;
                          const matched = products.find((p) => p.id === prodId);
                          setOrderItems((prev) =>
                            prev.map((it, i) =>
                              i === idx
                                ? {
                                    ...it,
                                    productId: prodId,
                                    name: matched ? matched.name : it.name,
                                    unitPrice: matched ? fromMinor(matched.priceMinor) : it.unitPrice,
                                  }
                                : it
                            )
                          );
                        }}
                        className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs text-zinc-700"
                      >
                        <option value="">Custom Item</option>
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({formatMoney(p.priceMinor, p.currency)})
                          </option>
                        ))}
                      </select>

                      {/* Item Name */}
                      <input
                        type="text"
                        placeholder="Item name"
                        value={item.name}
                        onChange={(e) => {
                          const val = e.target.value;
                          setOrderItems((prev) =>
                            prev.map((it, i) => (i === idx ? { ...it, name: val } : it))
                          );
                        }}
                        required
                        className="flex-1 min-w-[120px] rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs focus:outline-none"
                      />

                      {/* Unit Price */}
                      <div className="w-24">
                        <input
                          type="number"
                          step="0.01"
                          placeholder="Price"
                          value={item.unitPrice || ""}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0;
                            setOrderItems((prev) =>
                              prev.map((it, i) => (i === idx ? { ...it, unitPrice: val } : it))
                            );
                          }}
                          required
                          className="w-full rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs focus:outline-none text-right"
                        />
                      </div>

                      {/* Qty */}
                      <div className="w-16">
                        <input
                          type="number"
                          min="1"
                          placeholder="Qty"
                          value={item.qty}
                          onChange={(e) => {
                            const val = parseInt(e.target.value) || 1;
                            setOrderItems((prev) =>
                              prev.map((it, i) => (i === idx ? { ...it, qty: val } : it))
                            );
                          }}
                          required
                          className="w-full rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs focus:outline-none text-center"
                        />
                      </div>

                      {/* Subtotal */}
                      <span className="w-20 text-right text-xs font-bold text-zinc-900">
                        {formatMoney(Math.round(item.unitPrice * item.qty * 100), session.currency)}
                      </span>

                      {/* Remove Row */}
                      {orderItems.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setOrderItems((prev) => prev.filter((_, i) => i !== idx))}
                          className="text-zinc-400 hover:text-rose-600 px-1"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                {/* Total Summary */}
                <div className="mt-3 flex justify-end items-center gap-3 border-t border-black/5 pt-3">
                  <span className="text-sm font-semibold text-zinc-600">Calculated Total:</span>
                  <span className="text-xl font-extrabold text-[#00a884]">
                    {formatMoney(
                      Math.round(
                        orderItems.reduce((acc, it) => acc + it.unitPrice * it.qty, 0) * 100
                      ),
                      session.currency
                    )}
                  </span>
                </div>
              </div>

              {/* Order Notes */}
              <div>
                <label className="text-xs font-bold text-zinc-700">Special Instructions / Notes</label>
                <textarea
                  rows={2}
                  value={orderNotes}
                  onChange={(e) => setOrderNotes(e.target.value)}
                  placeholder="e.g. Delivery instructions, spice preferences, discount applied..."
                  className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-xs focus:border-[#00a884] focus:outline-none"
                />
              </div>

              {/* Submit Buttons */}
              <div className="flex justify-end gap-2 pt-3 border-t border-black/5">
                <button
                  type="button"
                  onClick={() => setIsAddOrderOpen(false)}
                  className="rounded-xl border border-zinc-200 px-4 py-2 text-xs font-semibold text-zinc-600 hover:bg-zinc-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="rounded-xl bg-[#00a884] px-5 py-2 text-xs font-bold text-white hover:bg-[#008f71]"
                >
                  {editingOrder ? "Save Changes" : "Create Order"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL: ADD / EDIT CUSTOMER */}
      {/* ============================================================== */}
      {isAddCustomerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-black/5 pb-4">
              <h3 className="text-lg font-bold text-[#111b21]">
                {editingCustomer ? "Edit Customer" : "Add New Customer"}
              </h3>
              <button
                onClick={() => setIsAddCustomerOpen(false)}
                className="rounded-full p-2 text-zinc-400 hover:bg-zinc-100"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCustomerSubmit} className="mt-4 space-y-4">
              {editingCustomer && <input type="hidden" name="id" value={editingCustomer.id} />}

              <div>
                <label className="text-xs font-bold text-zinc-700">Full Name *</label>
                <input
                  type="text"
                  name="displayName"
                  defaultValue={editingCustomer?.displayName || ""}
                  required
                  placeholder="e.g. Ayesha Khan"
                  className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm focus:border-[#00a884] focus:outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-zinc-700">WhatsApp Phone Number *</label>
                <input
                  type="text"
                  name="waId"
                  defaultValue={editingCustomer?.waId || ""}
                  required
                  placeholder="e.g. 923001234567"
                  className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm focus:border-[#00a884] focus:outline-none"
                />
                <span className="text-[11px] text-zinc-400">Include country code without + or spaces</span>
              </div>

              <div>
                <label className="text-xs font-bold text-zinc-700">Delivery Notes</label>
                <textarea
                  name="notes"
                  rows={2}
                  defaultValue={editingCustomer?.notes || ""}
                  placeholder="e.g. Flat 4B, prefers calls before delivery"
                  className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-xs focus:border-[#00a884] focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-black/5">
                <button
                  type="button"
                  onClick={() => setIsAddCustomerOpen(false)}
                  className="rounded-xl border border-zinc-200 px-4 py-2 text-xs font-semibold text-zinc-600 hover:bg-zinc-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="rounded-xl bg-[#00a884] px-5 py-2 text-xs font-bold text-white hover:bg-[#008f71]"
                >
                  {editingCustomer ? "Update Customer" : "Save Customer"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL: ADD / EDIT PRODUCT */}
      {/* ============================================================== */}
      {isAddProductOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-black/5 pb-4">
              <h3 className="text-lg font-bold text-[#111b21]">
                {editingProduct ? "Edit Product" : "Add Catalog Item"}
              </h3>
              <button
                onClick={() => setIsAddProductOpen(false)}
                className="rounded-full p-2 text-zinc-400 hover:bg-zinc-100"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleProductSubmit} className="mt-4 space-y-4">
              {editingProduct && <input type="hidden" name="id" value={editingProduct.id} />}

              <div>
                <label className="text-xs font-bold text-zinc-700">Product Name *</label>
                <input
                  type="text"
                  name="name"
                  defaultValue={editingProduct?.name || ""}
                  required
                  placeholder="e.g. Chicken Biryani"
                  className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm focus:border-[#00a884] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-zinc-700">SKU Code</label>
                  <input
                    type="text"
                    name="sku"
                    defaultValue={editingProduct?.sku || ""}
                    placeholder="e.g. BIRYANI"
                    className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm focus:border-[#00a884] focus:outline-none font-mono"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-zinc-700">Price ({session.currency}) *</label>
                  <input
                    type="number"
                    step="0.01"
                    name="price"
                    defaultValue={editingProduct ? fromMinor(editingProduct.priceMinor) : ""}
                    required
                    placeholder="850.00"
                    className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm focus:border-[#00a884] focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-zinc-700">Description</label>
                <textarea
                  name="description"
                  rows={2}
                  defaultValue={editingProduct?.description || ""}
                  placeholder="e.g. Serves 2-3 people, includes raita"
                  className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-xs focus:border-[#00a884] focus:outline-none"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="isActive"
                  id="isActive"
                  defaultChecked={editingProduct ? editingProduct.isActive : true}
                  className="rounded text-[#00a884] focus:ring-0"
                />
                <label htmlFor="isActive" className="text-xs font-medium text-zinc-700">
                  Product is active for order placement
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-black/5">
                <button
                  type="button"
                  onClick={() => setIsAddProductOpen(false)}
                  className="rounded-xl border border-zinc-200 px-4 py-2 text-xs font-semibold text-zinc-600 hover:bg-zinc-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="rounded-xl bg-[#00a884] px-5 py-2 text-xs font-bold text-white hover:bg-[#008f71]"
                >
                  {editingProduct ? "Update Product" : "Save Product"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL: ORDER DETAILS DRAWER */}
      {/* ============================================================== */}
      {selectedOrderDetails && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-black/5 pb-4">
              <div>
                <h3 className="text-lg font-bold text-[#111b21]">
                  Order #{selectedOrderDetails.id.slice(0, 8)}
                </h3>
                <p className="text-xs text-[#8696a0]">
                  Created {formatDate(selectedOrderDetails.createdAt)}
                </p>
              </div>
              <button
                onClick={() => setSelectedOrderDetails(null)}
                className="rounded-full p-2 text-zinc-400 hover:bg-zinc-100"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 space-y-4">
              {/* Customer Box */}
              <div className="rounded-xl bg-zinc-50 p-3">
                <p className="text-xs font-semibold text-[#8696a0]">Customer</p>
                <p className="font-bold text-[#111b21]">{selectedOrderDetails.customer?.displayName}</p>
                <a
                  href={`https://wa.me/${selectedOrderDetails.customer?.waId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-semibold text-[#00a884] hover:underline"
                >
                  💬 +{selectedOrderDetails.customer?.waId}
                </a>
              </div>

              {/* Items List */}
              <div>
                <p className="text-xs font-bold text-zinc-700 mb-2">Ordered Items</p>
                <div className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 overflow-hidden">
                  {selectedOrderDetails.items?.map((it, idx) => (
                    <div key={idx} className="flex justify-between p-3 text-xs">
                      <div>
                        <span className="font-bold text-zinc-900">{it.qty}x</span>{" "}
                        <span>{it.nameSnapshot}</span>
                      </div>
                      <span className="font-bold text-zinc-900">
                        {formatMoney(it.unitPriceMinor * it.qty, selectedOrderDetails.currency)}
                      </span>
                    </div>
                  ))}
                  <div className="flex justify-between p-3 bg-zinc-50 text-sm font-extrabold text-[#00a884]">
                    <span>Total Amount</span>
                    <span>
                      {formatMoney(selectedOrderDetails.totalMinor, selectedOrderDetails.currency)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Notes */}
              {selectedOrderDetails.notes && (
                <div className="rounded-xl bg-amber-50/60 border border-amber-200 p-3 text-xs text-amber-900">
                  <span className="font-bold">Order Note:</span> {selectedOrderDetails.notes}
                </div>
              )}

              {/* Quick Status Action inside Details */}
              <div>
                <p className="text-xs font-bold text-zinc-700 mb-2">Order Lifecycle Progression</p>
                <div className="flex flex-wrap gap-2">
                  {ALLOWED_TRANSITIONS[selectedOrderDetails.status].map((nextSt) => (
                    <button
                      key={nextSt}
                      disabled={isPending}
                      onClick={() => {
                        handleTransition(selectedOrderDetails.id, nextSt);
                        setSelectedOrderDetails(null);
                      }}
                      className={`rounded-xl px-4 py-2 text-xs font-bold ${
                        nextSt === "CANCELLED"
                          ? "border border-rose-300 text-rose-700 hover:bg-rose-50"
                          : "bg-[#00a884] text-white hover:bg-[#008f71]"
                      }`}
                    >
                      {nextSt === "CANCELLED" ? "Cancel Order" : `Mark as ${statusLabel(nextSt)}`}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
