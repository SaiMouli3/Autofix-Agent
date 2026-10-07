"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { api, qs } from "./api";

export interface ShopProduct {
  id: string;
  sku: string;
  name: string;
  category: string;
  price: number;
  rating: number;
  reviewCount: number;
  sold30: number;
  available: number;
  isNew: boolean;
}

export interface ShopHome {
  store: { name: string; currency: string; businessType: string };
  categories: { name: string; count: number }[];
  bestSellers: ShopProduct[];
  topRated: ShopProduct[];
  newArrivals: ShopProduct[];
  states: { name: string; region: string }[];
  freeShipping: number;
  shippingFee: number;
  productCount: number;
  reviewCount: number;
  customerCount: number;
}

export interface ShopReview {
  id: string;
  rating: number;
  title: string;
  body: string;
  author: string;
  createdAt: string;
  response: string;
  verified: boolean;
}

export interface ShopProductDetail {
  product: ShopProduct;
  description: string;
  reviews: ShopReview[];
  distribution: number[];
  related: ShopProduct[];
  lowStock: boolean;
  freeShipping: number;
  shippingFee: number;
}

export interface Catalog {
  items: ShopProduct[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PlacedOrder {
  number: string;
  createdAt: string;
  items: { productId: string; name: string; qty: number; unitPrice: number }[];
  subtotal: number;
  shippingFee: number;
  total: number;
  payment: "card" | "cod";
  estimatedDelivery: string;
  email: string;
}

export interface OrderInput {
  items: { productId: string; qty: number }[];
  customer: { name: string; email: string; phone: string; city: string; state: string };
  payment: "card" | "cod";
}

export const useShopHome = () => useQuery({ queryKey: ["shop", "home"], queryFn: () => api<ShopHome>("/shop") });

export const useCatalog = (p: { category?: string; q?: string; sort?: string; page?: number }) =>
  useQuery({
    queryKey: ["shop", "catalog", p],
    queryFn: () => api<Catalog>(`/shop/products${qs({ ...p, pageSize: 24 })}`),
    placeholderData: (prev) => prev,
  });

export const useShopProduct = (id: string) =>
  useQuery({ queryKey: ["shop", "product", id], queryFn: () => api<ShopProductDetail>(`/shop/products/${encodeURIComponent(id)}`) });

export const usePlaceOrder = () => useMutation({ mutationFn: (o: OrderInput) => api<PlacedOrder>("/shop/orders", { method: "POST", body: o }) });

// ---------------------------------------------------------------- cart

export interface CartLine {
  id: string;
  name: string;
  category: string;
  price: number;
  qty: number;
}

export const MAX_QTY = 10;

interface CartState {
  lines: CartLine[];
  add: (p: Pick<ShopProduct, "id" | "name" | "category" | "price">, qty?: number) => void;
  setQty: (id: string, qty: number) => void;
  remove: (id: string) => void;
  clear: () => void;
}

const storage = createJSONStorage(() => {
  try {
    window.localStorage.setItem("__ll", "1");
    window.localStorage.removeItem("__ll");
    return window.localStorage;
  } catch {
    const mem = new Map<string, string>();
    return { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: (k) => void mem.delete(k) };
  }
});

export const useCart = create<CartState>()(
  persist(
    (set) => ({
      lines: [],
      add: (p, qty = 1) =>
        set((s) => {
          const existing = s.lines.find((l) => l.id === p.id);
          if (existing) {
            return { lines: s.lines.map((l) => (l.id === p.id ? { ...l, qty: Math.min(MAX_QTY, l.qty + qty) } : l)) };
          }
          return { lines: [...s.lines, { id: p.id, name: p.name, category: p.category, price: p.price, qty: Math.min(MAX_QTY, qty) }] };
        }),
      setQty: (id, qty) => set((s) => ({ lines: s.lines.map((l) => (l.id === id ? { ...l, qty: Math.max(1, Math.min(MAX_QTY, qty)) } : l)) })),
      remove: (id) => set((s) => ({ lines: s.lines.filter((l) => l.id !== id) })),
      clear: () => set({ lines: [] }),
    }),
    { name: "loomline-cart", storage },
  ),
);

export function cartTotals(lines: CartLine[], freeShipping = 35, fee = 4.99) {
  const subtotal = Math.round(lines.reduce((s, l) => s + l.price * l.qty, 0) * 100) / 100;
  const shipping = subtotal === 0 || subtotal >= freeShipping ? 0 : fee;
  return { subtotal, shipping, total: Math.round((subtotal + shipping) * 100) / 100, count: lines.reduce((s, l) => s + l.qty, 0) };
}

/** The last placed order, kept only for the confirmation page. */
export const lastOrder = {
  save(o: PlacedOrder) {
    try {
      sessionStorage.setItem("loomline-last-order", JSON.stringify(o));
    } catch {
      /* private mode */
    }
  },
  load(): PlacedOrder | null {
    try {
      const raw = sessionStorage.getItem("loomline-last-order");
      return raw ? (JSON.parse(raw) as PlacedOrder) : null;
    } catch {
      return null;
    }
  },
};
