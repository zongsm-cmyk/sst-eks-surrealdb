import { Hono } from "hono";
import { handle } from "hono/aws-lambda";
import { Surreal } from "surrealdb";

const app = new Hono();
let db: Surreal | null = null;

// Lazy-connect database connection to handle serverless cold starts cleanly
async function getDB(): Promise<Surreal> {
  if (db) return db;
  db = new Surreal();
  const url = process.env.SURREALDB_URL || "ws://localhost:8000/rpc";
  await db.connect(url);
  await db.signin({
    user: process.env.SURREALDB_USER || "root",
    pass: process.env.SURREALDB_PASS || "root",
  });
  await db.use(process.env.SURREALDB_NS || "test", process.env.SURREALDB_DB || "test");
  return db;
}

// Health check endpoint
app.get("/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Example endpoint to create a user record in SurrealDB
app.post("/users", async (c) => {
  try {
    const client = await getDB();
    const body = await c.req.json();
    const user = await client.create("user", body);
    return c.json({ success: true, data: user });
  } catch (error: any) {
    return c.json({ error: error.message || "Failed to create user" }, 500);
  }
});

// Example endpoint to query all users
app.get("/users", async (c) => {
  try {
    const client = await getDB();
    const users = await client.select("user");
    return c.json({ success: true, data: users });
  } catch (error: any) {
    return c.json({ error: error.message || "Failed to fetch users" }, 500);
  }
});

export const handler = handle(app);
export default app;
