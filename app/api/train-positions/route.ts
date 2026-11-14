import { NextResponse } from "next/server";
import { SIMULATED, simulationTime, timestamp } from "@/lib/simulation/clock";
import { railNetwork } from "@/lib/simulation/network";
import { trainPositions } from "@/lib/simulation/vehicles";

export const dynamic = "force-dynamic";

export async function GET() {
  const now = simulationTime();
  return NextResponse.json({
    dataMode: SIMULATED, asOf: timestamp(now), lines: railNetwork.lines, positions: trainPositions(now),
  }, { headers: { "Cache-Control": "no-store" } });
}
