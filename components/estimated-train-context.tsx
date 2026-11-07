"use client";
import { createContext,useCallback,useContext,useEffect,useMemo,useRef,useState,type ReactNode } from "react";
import { positionsFromPayload,TRAIN_POSITION_LIMITS as L,type TrainPositionPayload } from "@/lib/train-positions";
function useTrainPositionState(enabled:boolean,selectedTransitId:string|null){
  const [visible,setVisible]=useState(false),[payload,setPayload]=useState<TrainPositionPayload|null>(null),[now,setNow]=useState(Date.now),[loading,setLoading]=useState(false),[error,setError]=useState(""),[refresh,setRefresh]=useState(0),[selectedId,setSelectedId]=useState<string|null>(null);
  const busy=useRef(false);
  useEffect(()=>{if(selectedTransitId)setSelectedId(null);},[selectedTransitId]);
  useEffect(()=>{if(!enabled||!visible){setSelectedId(null);setLoading(false);return;}
    let active=true,lastRequest=0,controller:AbortController|null=null;let timeout:ReturnType<typeof setTimeout>|null=null;
    const load=async()=>{if(busy.current)return;busy.current=true;lastRequest=Date.now();controller=new AbortController();timeout=setTimeout(()=>controller?.abort(),25000);setLoading(true);
      try{const response=await fetch("/api/train-positions",{cache:"no-store",signal:controller.signal});if(!response.ok)throw Error("Train estimates request failed");const next=await response.json() as TrainPositionPayload;if(next.dataMode!=="ESTIMATED"||!Array.isArray(next.runs)||!Array.isArray(next.geometries)||!Array.isArray(next.lines))throw Error("Incomplete train estimate response");if(active){setPayload(next);setError("");setNow(Date.now());}}
      catch{if(active)setError("Train position estimates could not be refreshed. Choose a station for departure times.");}
      finally{if(timeout)clearTimeout(timeout);if(active){busy.current=false;setLoading(false);}}
    };
    setNow(Date.now());void load();const timer=setInterval(()=>{setNow(Date.now());if(Date.now()-lastRequest>=L.pollMs)void load();},L.refreshMs);
    return()=>{active=false;busy.current=false;controller?.abort();if(timeout)clearTimeout(timeout);clearInterval(timer);};
  },[enabled,visible,refresh]);
  const positions=useMemo(()=>enabled&&visible?positionsFromPayload(payload,now):[],[enabled,visible,payload,now]);
  const reload=useCallback(()=>{if(!busy.current)setRefresh(value=>value+1);},[]);
  return {visible:enabled&&visible,setVisible,payload,positions,now,loading,error,reload,selectedId,setSelectedId};
}
const TrainPositionContext=createContext<ReturnType<typeof useTrainPositionState>|null>(null);
export function EstimatedTrainProvider({enabled,selectedTransitId,children}:{enabled:boolean;selectedTransitId:string|null;children:ReactNode}){const state=useTrainPositionState(enabled,selectedTransitId);return <TrainPositionContext.Provider value={state}>{children}</TrainPositionContext.Provider>;}
export function useEstimatedTrains(){const context=useContext(TrainPositionContext);if(!context)throw Error("Train estimates require their provider");return context;}
