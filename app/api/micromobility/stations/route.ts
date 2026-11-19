import { NextResponse } from "next/server";
import { z } from "zod";
import { MICROMOBILITY_OPERATORS } from "@/lib/micromobility";
import { micromobilitySnapshot } from "@/lib/micromobility-data";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const querySchema = z.object({
  operator: z.enum(MICROMOBILITY_OPERATORS).optional(),
  state: z.enum(["Kuala Lumpur", "Selangor", "Putrajaya", "Penang"]).optional(),
  area: z.string().trim().min(1).max(80).regex(/^[\p{L}\p{N} @.'-]+$/u).optional(),
}).strict();

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some(key => params.getAll(key).length !== 1)) {
    return NextResponse.json({ error: "Duplicate query parameters are not supported." }, { status: 400, headers });
  }
  const query = querySchema.safeParse(Object.fromEntries(params));
  if (!query.success) return NextResponse.json({ error: "Invalid operator, state or area filter." }, { status: 400, headers });
  try {
    const data = micromobilitySnapshot();
    data.stations = data.stations.filter(s => (!query.data.operator || s.operator === query.data.operator) &&
      (!query.data.state || s.state === query.data.state) && (!query.data.area || s.area.toLowerCase() === query.data.area.toLowerCase()));
    data.operators = data.operators.filter(operator => !query.data.operator || operator === query.data.operator);
    data.metadata.syntheticLocationsIncluded = data.stations.some(s => s.dataOrigin === "SYNTHETIC");
    return NextResponse.json(data, { headers });
  } catch {
    return NextResponse.json({ status: "UNAVAILABLE", error: "Micromobility demonstration data could not be validated." }, { status: 503, headers });
  }
}
