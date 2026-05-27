import { PageHead } from "@/components/atoms";
import { MyOrdersTable } from "@/components/MyOrdersTable";

export default function OrdersPage() {
  return (
    <>
      <PageHead
        num="03 · My Orders"
        title="Order"
        em="ledger"
        meta={<>YOUR ENCRYPTED SUBMISSIONS<br />UPDATED LIVE</>}
      />
      <MyOrdersTable />
    </>
  );
}
