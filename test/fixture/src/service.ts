import { orderTotal } from "./pricing";
import { OrderRepo } from "./repo";
import type { Order, OrderRequest } from "./types";

export class OrderService {
  constructor(private repo = new OrderRepo()) {}

  /** Validates the request, prices it and stores the order. */
  place(req: OrderRequest): Order {
    validate(req);
    const order: Order = { id: crypto.randomUUID(), items: req.items, total: orderTotal(req.items) };
    return this.repo.save(order);
  }
}

function validate(req: OrderRequest) {
  if (!req.items.length) throw new Error("empty order");
}
