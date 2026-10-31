"use client";
import { useEffect,useState } from "react";
import type { AlertPayload } from "@/lib/official-alert-model";
export function useOfficialAlerts(enabled:boolean) {
  const [payload,setPayload]=useState<AlertPayload|null>(null),[error,setError]=useState("");
  useEffect(()=>{ if(!enabled)return; const controller=new AbortController(); let active=true;
    const load=async()=>{try{const response=await fetch("/api/alerts",{signal:controller.signal});if(!response.ok)throw Error();const data=await response.json();if(active){setPayload(data);setError("");}}catch{if(active)setError("Official announcement refresh unavailable; previously retrieved notices are retained.");}};
    void load();const timer=setInterval(load,5*60000);return()=>{active=false;controller.abort();clearInterval(timer);};
  },[enabled]); return {payload,error};
}
