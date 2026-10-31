import { NextRequest, NextResponse } from "next/server";
import { demoAlerts, demoRecords, type TransitApiResponse } from "@/lib/transit-data";
import { getOfficialTransit, getStaticTransit } from "@/lib/official-transit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const demo = request.nextUrl.searchParams.get("mode") === "demo";
  if (demo) return NextResponse.json<TransitApiResponse>({ records: demoRecords, alerts: demoAlerts, feeds: [], fetchedAt: new Date().toISOString(), demo: true }, { headers: { "Cache-Control": "no-store" } });
  const [{ records, feeds }, stops] = await Promise.all([getOfficialTransit(), getStaticTransit()]);
  return NextResponse.json<TransitApiResponse>({ records: [...records, ...stops], alerts: [], feeds, fetchedAt: new Date().toISOString(), demo: false }, { headers: { "Cache-Control": "public, max-age=30, s-maxage=30, stale-while-revalidate=60" } });
}
