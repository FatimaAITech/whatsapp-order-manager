import { isDemoMode } from "@/lib/config";
import { demoStore } from "@/lib/data/demo-store";
import { prismaStore } from "@/lib/data/prisma-store";

export function getStore() {
  return isDemoMode() ? demoStore : prismaStore;
}

export type DataStore = ReturnType<typeof getStore>;
