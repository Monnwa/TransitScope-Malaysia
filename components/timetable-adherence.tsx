import type { JourneyStop } from "@/lib/bus-journey";
import { ON_TIME_TOLERANCE_SECONDS,type StopAdherence } from "@/lib/timetable-adherence";
import { arrivalClock,boardDate,malaysiaDay } from "@/lib/departure-board";
import { timingLabel } from "./passenger-copy";
const clock=(value:string,basis:string)=>`${arrivalClock(value)}${malaysiaDay(value)!==malaysiaDay(basis)?` (${boardDate(value)})`:""}`;
export function StopTimetableAdherence({assessment,passed}:{assessment:StopAdherence|undefined;passed:boolean}){
  if(!assessment||!passed&&!assessment.lastValid)return null;
  const result=assessment.result??assessment.lastValid,historical=!assessment.result&&!!assessment.lastValid;
  return <span className={`bus-adherence adherence-${assessment.status.toLowerCase()} ${historical?"adherence-historical":""}`} aria-label="Timetable adherence" data-adherence={assessment.status}>
    {result?<><span>{historical?"Earlier update · ":""}Around <time dateTime={result.inferredPassageTime}>{clock(result.inferredPassageTime,result.scheduledReferenceTime)}</time></span><strong>{timingLabel(result)} · Scheduled <time dateTime={result.scheduledReferenceTime}>{arrivalClock(result.scheduledReferenceTime)}</time></strong>{historical&&<small>Current status unavailable</small>}</>:<strong>Status unavailable</strong>}
  </span>;
}
export function AdherenceSummary({stops,summary}:{stops:JourneyStop[];summary:{passed:number;early:number;onTime:number;delayed:number;unknown:number}}){
  const historical=stops.filter(stop=>stop.adherence?.lastValid&&!stop.adherence.result).length;
  const tolerance=stops.find(stop=>stop.adherence?.result)?.adherence?.result?.toleranceSeconds??ON_TIME_TOLERANCE_SECONDS;
  if(!summary.passed&&!historical)return null;
  return <div className="bus-adherence-overview"><p className="bus-adherence-summary" aria-label="Timetable adherence summary">{summary.passed?`${summary.passed} passed · ${summary.early} early · ${summary.onTime} on time · ${summary.delayed} late · ${summary.unknown} unavailable`:`Earlier timing available for ${historical} stops · Current status unavailable`}</p><details className="bus-adherence-help"><summary>About these times</summary><p>Arrival and timing information is based on available vehicle location updates and published schedules. Actual stop arrival and departure times may differ.</p><p>On time includes a difference of up to {tolerance/60} minutes from the scheduled time.</p></details></div>;
}
