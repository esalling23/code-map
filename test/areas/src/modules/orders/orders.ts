import { charge } from "../payments/charge";

/** Order intake. */
export class Orders {
  place(amount: number) {
    return charge(amount);
  }
}
