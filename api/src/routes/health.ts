import { Hono } from "hono";

export const healthRoutes = new Hono();

healthRoutes.get("/health", (c) => {
  return c.json({
    status: "ok",
    service: "payment-api",
    timestamp: new Date().toISOString(),
  });
});
