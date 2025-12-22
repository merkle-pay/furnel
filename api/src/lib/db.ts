import { Pool } from "pg";

export const pool = new Pool({
  host: "furnel-db",
  user: "furnel",
  database: "furnel",
  password: process.env.POSTGRES_PASSWORD,
  port: 5432,
});

export async function query<T>(text: string, params?: unknown[]): Promise<T[]> {
  const result = await pool.query(text, params);
  return result.rows as T[];
}
