import type { LineItem } from "./types";

export const lineTotal = (item: LineItem) => item.qty * item.price;

/** Sums line totals. */
export function orderTotal(items: LineItem[]): number {
  return items.reduce((sum, item) => sum + lineTotal(item), 0);
}
