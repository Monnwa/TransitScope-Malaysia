import { gzip } from "node:zlib";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import type { TransitApiResponse } from "@/lib/transit-data";

const compress=promisify(gzip);
/** Lossless HTTP compression keeps fleet-wide stop/evidence data within a bounded response. */
export async function transitResponse(payload:TransitApiResponse,acceptEncoding:string|null) {
  const json=JSON.stringify(payload),gzipAccepted=acceptEncoding?.split(",").some(value=>{
    const [encoding,...parameters]=value.trim().toLowerCase().split(";");
    return encoding==="gzip"&&!parameters.some(parameter=>/^\s*q\s*=\s*0(?:\.0*)?\s*$/.test(parameter));
  });
  const body=gzipAccepted?new Uint8Array(await compress(json,{level:6})):json;
  if((typeof body==="string"?Buffer.byteLength(body):body.byteLength)>4_000_000)return NextResponse.json({error:"Journey information is temporarily too large to refresh. Previously loaded information is retained."},{status:503,headers:{"Cache-Control":"no-store","Vary":"Accept-Encoding"}});
  return new NextResponse(body,{headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","Vary":"Accept-Encoding",...(gzipAccepted?{"Content-Encoding":"gzip"}:{})}});
}
