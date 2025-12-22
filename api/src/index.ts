import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { paymentRoutes } from "./routes/payments.js";
import { healthRoutes } from "./routes/health.js";

const app = new Hono();

// Middleware
app.use("*", logger());
app.use("*", cors());

// Routes
app.route("/", healthRoutes);
app.route("/api/payments", paymentRoutes);

// 404 handler
app.notFound((c) => c.json({ error: "Not found" }, 404));

// Error handler
app.onError((err, c) => {
  console.error("Error:", err);
  return c.json({ error: "Internal server error" }, 500);
});

const port = Number(process.env.PORT) || 3000;

console.log(`Furnel API running on port ${port}`);

serve({
  fetch: app.fetch,
  port,
});

export default app;
