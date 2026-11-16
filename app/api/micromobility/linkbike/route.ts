import { NextResponse } from "next/server";
import { simulationTime } from "@/lib/simulation/clock";
import { linkBikeSnapshot } from "@/lib/simulation/scenarios";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(linkBikeSnapshot(simulationTime()), { headers: { "Cache-Control": "no-store" } });
}
