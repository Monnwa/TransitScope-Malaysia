import { NextResponse } from "next/server";
import { getRailStaticFeed } from "@/lib/official-transit";
import { prepareTrainPositions,calculateTrainPositionModels } from "@/lib/train-positions";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=60;
export async function GET(){
  try{const feed=await getRailStaticFeed("rapid-rail-kl"),index=prepareTrainPositions(feed.timetable,feed.progressPaths,feed.tripShapeDistances);return NextResponse.json(calculateTrainPositionModels(index),{headers:{"Cache-Control":"public, s-maxage=15, stale-while-revalidate=15"}});}
  catch{return NextResponse.json({error:"Train position estimates are temporarily unavailable. Choose a station for departure times."},{status:503,headers:{"Cache-Control":"no-store"}});}
}
