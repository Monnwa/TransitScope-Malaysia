import type { JourneyStop } from "@/lib/bus-journey";
import { adherenceLabel,ADHERENCE_EXPLANATION,ON_TIME_TOLERANCE_SECONDS,type StopAdherence } from "@/lib/timetable-adherence";
import { arrivalClock,boardDate,malaysiaDay } from "@/lib/departure-board";
import { PASSAGE_LIMITS } from "@/lib/gps-passage";
const clock=(value:string,basis:string)=>`${arrivalClock(value)}${malaysiaDay(value)!==malaysiaDay(basis)?` (${boardDate(value)})`:""}`;
export function StopTimetableAdherence({assessment,passed}:{assessment:StopAdherence|undefined;passed:boolean}){
  if(!assessment||!passed&&!assessment.lastValid)return null;
  const result=assessment.result??assessment.lastValid,historical=!assessment.result&&!!assessment.lastValid;
  return <span className={`bus-adherence adherence-${assessment.status.toLowerCase()} ${historical?"adherence-historical":""}`} aria-label="Timetable adherence" data-adherence={assessment.status} title={`${ADHERENCE_EXPLANATION} ${assessment.reason}`}>
    {result?<><span>{historical?"Last valid observations · ":""}GPS passage <time dateTime={result.inferredPassageTime}>{clock(result.inferredPassageTime,result.scheduledReferenceTime)}</time></span><strong>{adherenceLabel(result)} · Scheduled <time dateTime={result.scheduledReferenceTime}>{arrivalClock(result.scheduledReferenceTime)}</time></strong><small>GPS-INFERRED · Difference {result.differenceSeconds<0?"−":result.differenceSeconds>0?"+":""}{result.differenceMinutes} min · Departure reference{historical?" · Current status unknown":""}</small></>:<><strong>STATUS UNKNOWN</strong><small>{assessment.reason}</small></>}
  </span>;
}
export function AdherenceSummary({stops,summary}:{stops:JourneyStop[];summary:{passed:number;early:number;onTime:number;delayed:number;unknown:number}}){
  const historical=stops.filter(stop=>stop.adherence?.lastValid&&!stop.adherence.result).length;
  const tolerance=stops.find(stop=>stop.adherence?.result)?.adherence?.result?.toleranceSeconds??ON_TIME_TOLERANCE_SECONDS;
  if(!summary.passed&&!historical)return null;
  return <div className="bus-adherence-overview"><p className="bus-adherence-summary" aria-label="Timetable adherence summary">{summary.passed?`${summary.passed} passed · ${summary.early} early · ${summary.onTime} on time · ${summary.delayed} delayed · ${summary.unknown} unknown`:`Last valid adherence retained for ${historical} stops · current status unknown`}</p><details className="bus-adherence-help"><summary>About GPS timetable adherence</summary><p>{ADHERENCE_EXPLANATION}</p><p>Compared with official scheduled departure times. ON TIME includes ±{tolerance/60} min. GPS observations must bracket the stop within {PASSAGE_LIMITS.maxIntervalMs/1000} seconds; earlier stops without crossing history remain unknown.</p></details></div>;
}
