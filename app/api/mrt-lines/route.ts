import { NextResponse } from "next/server";
import { railNetwork } from "@/lib/simulation/network";

export async function GET() {
  const lines = railNetwork.lines.filter(line => line.mode === "MRT");
  return NextResponse.json({ ...railNetwork, lines, stations: railNetwork.stations.filter(station => station.modes?.includes("MRT")) },
    { headers: { "Cache-Control": "no-store" } });
}
