import { NextResponse } from "next/server";
import { linkBikeEnabled } from "@/lib/linkbike-feature";
import { getLinkBike } from "@/lib/linkbike";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  if (!linkBikeEnabled()) return NextResponse.json({ error: "LinkBike experiment disabled." }, { status: 404, headers });
  const data = await getLinkBike();
  return NextResponse.json(data, { status: data.status === "UNAVAILABLE" ? 503 : 200, headers });
}
