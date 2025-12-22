import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import cors from "cors";
import helmet from "helmet";
import { jwtMiddleware } from "./middleware.js";

const app = express();
const PORT = 8008;

const allowedOrigins = process.env.VISITING_SITE
  ? ["http://localhost:3000", process.env.VISITING_SITE]
  : ["http://localhost:3000"];

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);

app.use(express.json());

// Health check (no auth needed)
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Serve Temporal UI from root (/) with no CSP restrictions
app.use(
  "/",
  helmet({
    contentSecurityPolicy: false,
  }),
  jwtMiddleware,
  createProxyMiddleware({
    target: "http://temporal-ui:8080",
    changeOrigin: true,
    onProxyReq: (proxyReq, req, res) => {
      console.log(
        `Proxying UI ${req.method} ${req.originalUrl} to Temporal UI`
      );
    },
  })
);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Temporal Auth Proxy running on port ${PORT}`);
  console.log(`Temporal UI: http://localhost:${PORT}/`);
  console.log(`Health Check: http://localhost:${PORT}/api/health`);
});
