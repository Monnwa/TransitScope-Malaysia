import { handleEvidenceReplay } from "@/lib/preview-evidence-replay-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = (request: Request) => handleEvidenceReplay(request);
export const GET = POST;
export const PATCH = POST;
export const DELETE = POST;
export const HEAD = POST;
export const OPTIONS = POST;
