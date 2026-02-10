// server/db.ts
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres"; // correct import for pg
import * as schema from "@shared/schema";

// Ensure DATABASE_URL is set
if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?"
  );
}

// Create a standard Postgres pool
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Initialize Drizzle ORM with the pool and your schema
export const db = drizzle(pool, { schema });

console.log("Database initialized with Drizzle ORM using standard Postgres.");
