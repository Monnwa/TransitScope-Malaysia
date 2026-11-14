import Dashboard from "@/components/dashboard";
import { simulationTime } from "@/lib/simulation/clock";

export const dynamic = "force-dynamic";

export default function Home() {
  return <Dashboard initialTime={simulationTime()}/>;
}
