import { connection } from "next/server";
import Dashboard from "@/components/dashboard";
import { linkBikeEnabled } from "@/lib/linkbike-feature";

export default async function Home({ searchParams }: { searchParams: Promise<{ mode?: string | string[] }> }) {
  await connection();
  const { mode } = await searchParams;
  const initialDemo = (Array.isArray(mode) ? mode[0] : mode) === "demo";
  return <Dashboard enableLinkBike={linkBikeEnabled()} initialDemo={initialDemo} />;
}
