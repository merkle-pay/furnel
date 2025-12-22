import { Pool } from "pg";

export const pool = new Pool({
  host: process.env.DB_HOST || "postgres",
  user: process.env.DB_USER || "payment",
  database: process.env.DB_NAME || "payment_db",
  password: process.env.POSTGRES_PASSWORD,
  port: Number(process.env.DB_PORT) || 5432,
});

export async function query<T>(text: string, params?: unknown[]): Promise<T[]> {
  const result = await pool.query(text, params);
  return result.rows as T[];
}
