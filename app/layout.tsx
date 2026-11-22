import type { Metadata } from "next";
import "./globals.css";
import "./map-search.css";
import "./service-updates.css";
import "./dashboard-navigation.css";
import "./overview.css";
export const metadata: Metadata = {
  title: "TransitScope Malaysia",
  description: "Public transport locations, stops and service times in Malaysia",
  icons: { icon: { url: "/brand/transitscope-icon.svg", type: "image/svg+xml" } },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
