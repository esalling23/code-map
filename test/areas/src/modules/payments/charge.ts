import { audit } from "../audit/audit";

export function charge(amount: number) {
  audit(`charged ${amount}`);
  return amount;
}
