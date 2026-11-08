import { NextRequest, NextResponse } from "next/server";
import { demoAlerts, demoRecords, type TransitApiResponse } from "@/lib/transit-data";
import { getOfficialTransit, getStaticTransit } from "@/lib/official-transit";
import { transitResponse } from "@/lib/transit-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(request: NextRequest) {
  const demo = request.nextUrl.searchParams.get("mode") === "demo";
  if (demo) return NextResponse.json<TransitApiResponse>({ records: demoRecords, alerts: demoAlerts, feeds: [], fetchedAt: new Date().toISOString(), demo: true }, { headers: { "Cache-Control": "no-store" } });
  if (request.nextUrl.searchParams.get("includeStatic") === "1") {
    return NextResponse.json<TransitApiResponse>({ records: await getStaticTransit(), alerts: [], feeds: [], fetchedAt: new Date().toISOString(), demo: false }, { headers: { "Cache-Control": "public, max-age=30, s-maxage=30, stale-while-revalidate=60" } });
  }
  const { records, feeds, busJourneys } = await getOfficialTransit();
  return transitResponse({ records, alerts: [], feeds, busJourneys, fetchedAt: new Date().toISOString(), demo: false },request.headers.get("accept-encoding"));
}
