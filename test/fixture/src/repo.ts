import type { Order } from "./types";

export class OrderRepo {
  private rows = new Map<string, Order>();

  /** Saves an order and returns it. */
  save(order: Order): Order {
    this.rows.set(order.id, order);
    return order;
  }
}
