import type { Metadata } from "next";
import { ShopChrome } from "./shop-chrome";

export const metadata: Metadata = {
  title: { default: "Loomline — everyday clothing", template: "%s · Loomline" },
  description: "Shirts, tees, dresses, denim, footwear and accessories from Loomline.",
};

export default function ShopLayout({ children }: { children: React.ReactNode }) {
  return <ShopChrome>{children}</ShopChrome>;
}
