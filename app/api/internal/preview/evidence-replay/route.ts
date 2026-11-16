// The recorded-feed replay and its database integration are retained in lib for historical tests.
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ error: "Evidence replay is disabled in simulation mode." }, { status: 404, headers: { "Cache-Control": "no-store" } });
}

export const POST = GET;
export const PATCH = GET;
export const DELETE = GET;
export const HEAD = GET;
export const OPTIONS = GET;
