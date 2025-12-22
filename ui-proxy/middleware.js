import { verifyJwt } from "./jwt.js";

export const jwtMiddleware = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized - Missing token" });
  }

  const token = authHeader.slice(7);
  const payload = await verifyJwt(token);

  if (!payload || !payload.email) {
    return res.status(401).json({ error: "Unauthorized - Invalid token" });
  }

  req.user = payload;
  console.log(`Authenticated: ${payload.email}`);
  next();
};
