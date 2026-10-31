import { NextResponse } from "next/server";
import { getMrtAlignments } from "@/lib/mrt-lines";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const lines = await getMrtAlignments();
    return NextResponse.json({ lines, available: lines.length === 2, source: lines.length === 2 ? "Official GTFS Static; validated WGS84 geometry and station coverage" : "Some MRT railway alignments are unavailable. Stations remain visible; retry later." }, { headers: { "Cache-Control": lines.length === 2 ? "public, s-maxage=86400, stale-while-revalidate=86400" : "no-store" } });
  } catch {
    return NextResponse.json({ lines: [], available: false, source: "MRT alignment unavailable; no geometry was fabricated." }, { headers: { "Cache-Control": "no-store" } });
  }
}
