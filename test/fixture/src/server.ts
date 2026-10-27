import { OrderService } from "./service";

const service = new OrderService();

export function handlePost(body: string) {
  const order = service.place(JSON.parse(body));
  return new Response(JSON.stringify(order), { status: 201 });
}

Bun.serve({ port: 3000, fetch: async (req) => handlePost(await req.text()) });
