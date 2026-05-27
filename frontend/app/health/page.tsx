import { PageHead } from "@/components/atoms";
import { SystemHealth } from "@/components/SystemHealth";

export default function HealthPage() {
  return (
    <>
      <PageHead
        num="06 · Health"
        title="System"
        em="status"
        meta={<>MATCHER · INDEXER · SETTLEMENT<br />PUBLIC API CHECKS</>}
      />
      <SystemHealth />
    </>
  );
}
