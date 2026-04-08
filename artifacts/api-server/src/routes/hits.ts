import { Router } from "express";
import { db } from "@workspace/db";
import { botHitsTable, clientsTable } from "@workspace/db/schema";
import { eq, desc, gte, sql, count } from "drizzle-orm";
import { auth } from "./auth";

const router = Router();

router.post("/hit", async (req, res) => {
  const { api_key, url, bot_name, user_agent, status_code, country, referrer } =
    req.body as {
      api_key: string;
      url: string;
      bot_name: string;
      user_agent: string;
      status_code: number;
      country: string;
      referrer: string;
    };
  try {
    const [client] = await db
      .select({ id: clientsTable.id })
      .from(clientsTable)
      .where(eq(clientsTable.api_key, api_key))
      .limit(1);

    if (!client) {
      res.status(401).json({ error: "Invalid API key" });
      return;
    }

    await db.insert(botHitsTable).values({
      client_id: client.id,
      url,
      bot_name,
      user_agent,
      status_code,
      country,
      referrer,
    });

    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to record hit");
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/stats/:clientId", auth, async (req, res) => {
  const clientId = parseInt(req.params.clientId);
  const days = parseInt((req.query.days as string) || "30");
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  try {
    const [totalResult] = await db
      .select({ total: count() })
      .from(botHitsTable)
      .where(
        sql`${botHitsTable.client_id} = ${clientId} AND ${botHitsTable.timestamp} > ${since}`
      );

    const byBot = await db
      .select({
        bot_name: botHitsTable.bot_name,
        hits: count(),
      })
      .from(botHitsTable)
      .where(
        sql`${botHitsTable.client_id} = ${clientId} AND ${botHitsTable.timestamp} > ${since}`
      )
      .groupBy(botHitsTable.bot_name)
      .orderBy(desc(count()));

    const topPages = await db
      .select({
        url: botHitsTable.url,
        hits: count(),
      })
      .from(botHitsTable)
      .where(
        sql`${botHitsTable.client_id} = ${clientId} AND ${botHitsTable.timestamp} > ${since}`
      )
      .groupBy(botHitsTable.url)
      .orderBy(desc(count()))
      .limit(10);

    const overTime = await db
      .select({
        date: sql<string>`DATE(${botHitsTable.timestamp})`,
        hits: count(),
      })
      .from(botHitsTable)
      .where(
        sql`${botHitsTable.client_id} = ${clientId} AND ${botHitsTable.timestamp} > ${since}`
      )
      .groupBy(sql`DATE(${botHitsTable.timestamp})`)
      .orderBy(sql`DATE(${botHitsTable.timestamp})`);

    res.json({
      total: totalResult?.total ?? 0,
      byBot,
      topPages,
      overTime,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get stats");
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/hits/:clientId", auth, async (req, res) => {
  const clientId = parseInt(req.params.clientId);
  const days = parseInt((req.query.days as string) || "30");
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  try {
    const hits = await db
      .select()
      .from(botHitsTable)
      .where(
        sql`${botHitsTable.client_id} = ${clientId} AND ${botHitsTable.timestamp} > ${since}`
      )
      .orderBy(desc(botHitsTable.timestamp))
      .limit(200);

    res.json(hits);
  } catch (err) {
    req.log.error({ err }, "Failed to get hits");
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
