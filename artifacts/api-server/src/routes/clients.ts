import { Router } from "express";
import { db } from "@workspace/db";
import { clientsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { auth } from "./auth";

const router = Router();

router.get("/clients", auth, async (req, res) => {
  try {
    const clients = await db
      .select({
        id: clientsTable.id,
        name: clientsTable.name,
        domain: clientsTable.domain,
        api_key: clientsTable.api_key,
        created_at: clientsTable.created_at,
      })
      .from(clientsTable)
      .orderBy(clientsTable.created_at);
    res.json(clients);
  } catch (err) {
    req.log.error({ err }, "Failed to get clients");
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/clients", auth, async (req, res) => {
  const { name, domain } = req.body as { name: string; domain: string };
  const api_key =
    Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15);
  try {
    const [client] = await db
      .insert(clientsTable)
      .values({ name, domain, api_key })
      .returning();
    res.json(client);
  } catch (err) {
    req.log.error({ err }, "Failed to create client");
    res.status(500).json({ error: "Server error" });
  }
});

router.delete("/clients/:id", auth, async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    await db.delete(clientsTable).where(eq(clientsTable.id, id));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete client");
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
