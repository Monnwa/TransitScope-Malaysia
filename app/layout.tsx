import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "TransitScope Malaysia", description: "Public transport locations, stops and service times in Malaysia" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
