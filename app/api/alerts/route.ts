import { NextResponse } from "next/server";
import { getOfficialAlerts } from "@/lib/official-alerts";
export const runtime = "nodejs"; export const dynamic = "force-dynamic"; export const maxDuration = 60;
export async function GET() { return NextResponse.json(await getOfficialAlerts(), { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } }); }
