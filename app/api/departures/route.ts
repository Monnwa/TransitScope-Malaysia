import { NextRequest, NextResponse } from "next/server";
import { SIMULATED, simulationTime, timestamp } from "@/lib/simulation/clock";
import { stationServices } from "@/lib/simulation/network";
import { stationArrivals } from "@/lib/simulation/vehicles";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const refs = [...new Set(request.nextUrl.searchParams.getAll("stop"))];
  if (!refs.length || refs.length > 20 || refs.some(ref => !stationServices.has(ref))) {
    return NextResponse.json({ error: "Provide 1–20 simulated stop references." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const now = simulationTime();
  return NextResponse.json({ dataMode: SIMULATED, status: SIMULATED, arrivals: stationArrivals(refs, now), retrievedAt: timestamp(now) }, { headers: { "Cache-Control": "no-store" } });
}
