import { NextRequest, NextResponse } from "next/server";
import { simulationTime } from "@/lib/simulation/clock";
import { busJourney } from "@/lib/simulation/vehicles";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const id = params.get("vehicle");
  if (!id) return NextResponse.json({ error: "Provide a simulated bus identifier." }, { status: 400, headers });
  const start = params.get("start");
  const journey = busJourney(id, simulationTime(), params.get("departureVehicle") ?? undefined, start === null ? undefined : Number(start));
  return journey ? NextResponse.json(journey, { headers })
    : NextResponse.json({ error: "Simulated bus not found." }, { status: 404, headers });
}
