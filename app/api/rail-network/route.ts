import { NextRequest, NextResponse } from "next/server";
import { railNetwork, railNetworkFor } from "@/lib/simulation/network";

export async function GET(request: NextRequest) {
  const sources = request.nextUrl.searchParams.getAll("source");
  const [source] = sources;
  const headers = { "Cache-Control": "no-store" };
  if (sources.length === 0) return NextResponse.json(railNetwork, { headers });
  if (sources.length === 1 && (source === "rapid-rail-kl" || source === "ktmb")) {
    return NextResponse.json(railNetworkFor(source), { headers });
  }
  return NextResponse.json({ error: "Provide one simulated rail source: rapid-rail-kl or ktmb." }, { status: 400, headers });
}
