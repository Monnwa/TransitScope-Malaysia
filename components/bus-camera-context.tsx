"use client";

import React, { createContext, useContext, useCallback, useLayoutEffect, useMemo, useReducer, useRef, type Dispatch, type ReactNode } from "react";
import { cameraReducer, initialCameraState, ProgrammaticCameraGuard, type CameraAction, type CameraState } from "@/lib/map-camera";

type CameraContext = { state: CameraState; dispatch: Dispatch<CameraAction>; guard: ProgrammaticCameraGuard; intentRevision: { revision: number; action: CameraAction | null } };
const BusCameraContext = createContext<CameraContext | null>(null);

/** The sole camera-state owner. Dashboard selection is an input, never a follow command. */
export function BusCameraProvider({ selectedVehicleId, selectedRecordId = selectedVehicleId, children }: { selectedVehicleId: string | null; selectedRecordId?: string | null; children: ReactNode }) {
  const [state, reduce] = useReducer(cameraReducer, initialCameraState);
  const guard = useRef(new ProgrammaticCameraGuard()).current;
  // Synchronously supersede deferred work even when React batches a dispatch.
  // The reducer remains the only state machine; this token only invalidates work.
  const intentRevision = useRef({ revision: 0, action: null as CameraAction | null }).current;
  const dispatch = useCallback<Dispatch<CameraAction>>(action => { intentRevision.revision++; intentRevision.action = action; reduce(action); }, [intentRevision]);
  useLayoutEffect(() => { dispatch({ type: "SELECT", id: selectedVehicleId, recordId: selectedRecordId }); }, [dispatch, selectedVehicleId, selectedRecordId]);
  const value = useMemo(() => ({ state, dispatch, guard, intentRevision }), [state, dispatch, guard, intentRevision]);
  return <BusCameraContext.Provider value={value}>{children}</BusCameraContext.Provider>;
}
export const useOptionalBusCamera = () => useContext(BusCameraContext);
export function useBusCamera() {
  const context = useOptionalBusCamera();
  if (!context) throw new Error("Bus camera controls require BusCameraProvider");
  return context;
}
