import { NextResponse } from "next/server";
import { simulationSnapshot } from "@/lib/simulation";

export const dynamic = "force-dynamic";

export async function GET(_request: Request) {
  return NextResponse.json(simulationSnapshot(), { headers: { "Cache-Control": "no-store" } });
}
