/** A customer order as stored in the database. */
export interface Order {
  id: string;
  items: LineItem[];
  total: number;
}

export interface LineItem {
  sku: string;
  qty: number;
  price: number;
}

export type OrderRequest = { items: LineItem[] };
