import { NextResponse } from "next/server";
import { SIMULATED, simulationTime, timestamp } from "@/lib/simulation/clock";
import { simulationAlerts } from "@/lib/simulation/scenarios";

export const dynamic = "force-dynamic";

export async function GET() {
  const now = simulationTime();
  return NextResponse.json({ dataMode: SIMULATED, alerts: simulationAlerts(now), retrievedAt: timestamp(now) }, { headers: { "Cache-Control": "no-store" } });
}
