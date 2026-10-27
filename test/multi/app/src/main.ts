import { audit, Ledger } from "@acme/lib";

export function checkout(total: number) {
  const ledger = new Ledger();
  ledger.record(total);
  audit("checkout");
  return finish();
}

function finish() {
  return "done";
}

export function refund() {
  const finish = () => "refunded";
  return finish();
}
