import { NextRequest, NextResponse } from "next/server";
import { getRailNetwork } from "@/lib/rail-network";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(request: NextRequest) {
  const source = request.nextUrl.searchParams.get("source") === "ktmb" ? "ktmb" : "rapid-rail-kl";
  try { return NextResponse.json(await getRailNetwork(source), { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } }); }
  catch { return NextResponse.json({ lines: [], stations: [], available: false, source: `${source} railway data unavailable; retry to load stations and alignments.` }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
