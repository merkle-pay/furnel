import * as jose from "jose";

export const verifyJwt = async (token) => {
  try {
    const secret = new TextEncoder().encode(process.env.JWT_SECRET);
    const { payload } = await jose.jwtVerify(token, secret);
    return payload;
  } catch (error) {
    console.log("JWT verification failed:", error.message);
    return null;
  }
};
