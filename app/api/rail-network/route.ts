import { NextRequest, NextResponse } from "next/server";
import { railNetwork, railNetworkFor } from "@/lib/simulation/network";

export async function GET(request: NextRequest) {
  const source = request.nextUrl.searchParams.get("source");
  const network = source === "rapid-rail-kl" || source === "ktmb" ? railNetworkFor(source) : railNetwork;
  return NextResponse.json(network, { headers: { "Cache-Control": "no-store" } });
}
