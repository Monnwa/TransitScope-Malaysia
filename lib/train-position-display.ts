import type { EstimatedTrainPosition } from "@/lib/train-positions";
export type TrainMapFilters={query:string;modes:string[];statuses:string[];dataModes:string[]};
export function filterEstimatedTrains(trains:EstimatedTrainPosition[],filters:TrainMapFilters,hidden:string[],availableLines:string[]){
  const q=filters.query.trim().toLowerCase();return trains.filter(train=>availableLines.includes(train.lineId)&&!hidden.includes(train.lineId)&&(!filters.modes.length||filters.modes.includes(train.mode))&&(!filters.statuses.length||filters.statuses.includes("In service"))&&(!filters.dataModes.length||filters.dataModes.includes("ESTIMATED"))&&(!q||[train.lineName,train.destination,train.previousStation?.name,train.nextStation?.name,train.nearStation?.name].some(value=>value?.toLowerCase().includes(q))));
}
/** Group icons use an original member coordinate; train coordinates never change. */
export function groupEstimatedTrains(trains:EstimatedTrainPosition[],project:(train:EstimatedTrainPosition)=>{x:number;y:number},selectedId:string|null,radius=26){
  const groups:{anchor:EstimatedTrainPosition;members:EstimatedTrainPosition[];pixel:{x:number;y:number}}[]=[];
  for(const train of [...trains].sort((a,b)=>a.id===selectedId?-1:b.id===selectedId?1:a.id.localeCompare(b.id))){const pixel=project(train),group=groups.find(group=>Math.hypot(pixel.x-group.pixel.x,pixel.y-group.pixel.y)<radius);if(group)group.members.push(train);else groups.push({anchor:train,members:[train],pixel});}return groups;
}
