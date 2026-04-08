import { Router } from "express";
import { db } from "@workspace/db";
import { botHitsTable, clientsTable } from "@workspace/db/schema";
import { eq, desc, sql, count } from "drizzle-orm";
import { auth } from "./auth";

const router = Router();

// ── In-memory title cache ──────────────────────────────────────────────────
const titleCache = new Map<string, { title: string | null; ts: number }>();

router.get("/page-title", auth, async (req, res) => {
  const url = req.query.url as string;
  if (!url) { res.json({ title: null }); return; }

  const cached = titleCache.get(url);
  if (cached && Date.now() - cached.ts < 3_600_000) {
    res.json({ title: cached.title });
    return;
  }

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(6000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; BotTracker/1.0)" },
    });
    const html = await response.text();
    const match = html.match(/<title[^>]*>([^<]{1,200})<\/title>/i);
    const title = match ? match[1].trim().replace(/\s+/g, " ") : null;
    titleCache.set(url, { title, ts: Date.now() });
    res.json({ title });
  } catch {
    titleCache.set(url, { title: null, ts: Date.now() });
    res.json({ title: null });
  }
});

// ── POST /api/hit ──────────────────────────────────────────────────────────
router.post("/hit", async (req, res) => {
  const { api_key, url, bot_name, user_agent, status_code, country, referrer } =
    req.body as {
      api_key: string; url: string; bot_name: string; user_agent: string;
      status_code: number; country: string; referrer: string;
    };
  try {
    const [client] = await db
      .select({ id: clientsTable.id })
      .from(clientsTable)
      .where(eq(clientsTable.api_key, api_key))
      .limit(1);

    if (!client) { res.status(401).json({ error: "Invalid API key" }); return; }

    await db.insert(botHitsTable).values({ client_id: client.id, url, bot_name, user_agent, status_code, country, referrer });
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to record hit");
    res.status(500).json({ error: "Server error" });
  }
});

// ── GET /api/stats/:clientId ───────────────────────────────────────────────
router.get("/stats/:clientId", auth, async (req, res) => {
  const clientId = parseInt(req.params.clientId);
  const days = parseInt((req.query.days as string) || "7");
  const now = new Date();
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const prevSince = new Date(now.getTime() - 2 * days * 24 * 60 * 60 * 1000);

  try {
    const [totalResult] = await db
      .select({ total: count() }).from(botHitsTable)
      .where(sql`${botHitsTable.client_id} = ${clientId} AND ${botHitsTable.timestamp} > ${since}`);

    const [prevTotalResult] = await db
      .select({ total: count() }).from(botHitsTable)
      .where(sql`${botHitsTable.client_id} = ${clientId} AND ${botHitsTable.timestamp} > ${prevSince} AND ${botHitsTable.timestamp} <= ${since}`);

    const byBotRaw = await db
      .select({ bot_name: botHitsTable.bot_name, hits: count(), last_active: sql<string>`MAX(${botHitsTable.timestamp})` })
      .from(botHitsTable)
      .where(sql`${botHitsTable.client_id} = ${clientId} AND ${botHitsTable.timestamp} > ${since}`)
      .groupBy(botHitsTable.bot_name).orderBy(desc(count()));

    const byBotPrev = await db
      .select({ bot_name: botHitsTable.bot_name, hits: count() }).from(botHitsTable)
      .where(sql`${botHitsTable.client_id} = ${clientId} AND ${botHitsTable.timestamp} > ${prevSince} AND ${botHitsTable.timestamp} <= ${since}`)
      .groupBy(botHitsTable.bot_name);

    const prevBotMap: Record<string, number> = {};
    byBotPrev.forEach((b) => { prevBotMap[b.bot_name] = Number(b.hits); });

    const byBot = byBotRaw.map((b) => ({
      bot_name: b.bot_name, hits: Number(b.hits), last_active: b.last_active,
      previous_hits: prevBotMap[b.bot_name] || 0,
    }));

    const topPagesRaw = await db
      .select({ url: botHitsTable.url, hits: count() }).from(botHitsTable)
      .where(sql`${botHitsTable.client_id} = ${clientId} AND ${botHitsTable.timestamp} > ${since}`)
      .groupBy(botHitsTable.url).orderBy(desc(count())).limit(20);

    const topUrls = topPagesRaw.map((p) => p.url);

    const pageBotsRaw = topUrls.length > 0
      ? await db.select({ url: botHitsTable.url, bot_name: botHitsTable.bot_name, hits: count() })
          .from(botHitsTable)
          .where(sql`${botHitsTable.client_id} = ${clientId} AND ${botHitsTable.timestamp} > ${since} AND ${botHitsTable.url} IN (${sql.join(topUrls.map((u) => sql`${u}`), sql`, `)})`)
          .groupBy(botHitsTable.url, botHitsTable.bot_name).orderBy(desc(count()))
      : [];

    const pageBotsMap: Record<string, Array<{ bot_name: string; hits: number }>> = {};
    pageBotsRaw.forEach((r) => {
      if (!pageBotsMap[r.url]) pageBotsMap[r.url] = [];
      pageBotsMap[r.url].push({ bot_name: r.bot_name, hits: Number(r.hits) });
    });

    const topPagesPrev = await db
      .select({ url: botHitsTable.url, hits: count() }).from(botHitsTable)
      .where(sql`${botHitsTable.client_id} = ${clientId} AND ${botHitsTable.timestamp} > ${prevSince} AND ${botHitsTable.timestamp} <= ${since}`)
      .groupBy(botHitsTable.url);

    const prevPageMap: Record<string, number> = {};
    topPagesPrev.forEach((p) => { prevPageMap[p.url] = Number(p.hits); });

    const topPages = topPagesRaw.map((p) => ({
      url: p.url, hits: Number(p.hits), previous_hits: prevPageMap[p.url] || 0,
      bots: pageBotsMap[p.url] || [],
    }));

    const overTime = await db
      .select({ date: sql<string>`DATE(${botHitsTable.timestamp})`, hits: count() })
      .from(botHitsTable)
      .where(sql`${botHitsTable.client_id} = ${clientId} AND ${botHitsTable.timestamp} > ${since}`)
      .groupBy(sql`DATE(${botHitsTable.timestamp})`).orderBy(sql`DATE(${botHitsTable.timestamp})`);

    res.json({
      total: Number(totalResult?.total ?? 0),
      previousTotal: Number(prevTotalResult?.total ?? 0),
      byBot, topPages, overTime,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get stats");
    res.status(500).json({ error: "Server error" });
  }
});

// ── GET /api/cadence/:clientId ─────────────────────────────────────────────
router.get("/cadence/:clientId", auth, async (req, res) => {
  const clientId = parseInt(req.params.clientId);
  const days = parseInt((req.query.days as string) || "7");
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  try {
    const allHits = await db
      .select({ bot_name: botHitsTable.bot_name, timestamp: botHitsTable.timestamp, url: botHitsTable.url })
      .from(botHitsTable)
      .where(sql`${botHitsTable.client_id} = ${clientId} AND ${botHitsTable.timestamp} > ${since}`)
      .orderBy(botHitsTable.bot_name, botHitsTable.timestamp);

    const botGroups: Record<string, { timestamps: Date[]; urls: string[] }> = {};
    allHits.forEach((h) => {
      if (!botGroups[h.bot_name]) botGroups[h.bot_name] = { timestamps: [], urls: [] };
      botGroups[h.bot_name].timestamps.push(new Date(h.timestamp as string));
      botGroups[h.bot_name].urls.push(h.url);
    });

    const cadence = Object.entries(botGroups).map(([bot_name, { timestamps, urls }]) => {
      timestamps.sort((a, b) => a.getTime() - b.getTime());

      const intervals: number[] = [];
      for (let i = 1; i < timestamps.length; i++) {
        intervals.push((timestamps[i].getTime() - timestamps[i - 1].getTime()) / 3_600_000);
      }
      const avgIntervalHours = intervals.length > 0
        ? intervals.reduce((a, b) => a + b, 0) / intervals.length : null;

      const visitsPerDay = timestamps.length / days;

      const hourCounts = new Array(24).fill(0);
      timestamps.forEach((ts) => { hourCounts[ts.getHours()]++; });
      const peakHour = hourCounts.indexOf(Math.max(...hourCounts));

      const pageCounts: Record<string, number> = {};
      urls.forEach((url) => { pageCounts[url] = (pageCounts[url] || 0) + 1; });
      const topPages = Object.entries(pageCounts)
        .sort((a, b) => b[1] - a[1]).slice(0, 5)
        .map(([url, hits]) => ({ url, hits }));

      return {
        bot_name, total_hits: timestamps.length,
        first_seen: timestamps[0].toISOString(),
        last_seen: timestamps[timestamps.length - 1].toISOString(),
        avg_interval_hours: avgIntervalHours,
        visits_per_day: visitsPerDay,
        peak_hour: peakHour,
        hourly_pattern: hourCounts,
        top_pages: topPages,
      };
    }).sort((a, b) => b.total_hits - a.total_hits);

    res.json({ cadence, days });
  } catch (err) {
    req.log.error({ err }, "Failed to get cadence");
    res.status(500).json({ error: "Server error" });
  }
});

// ── GET /api/page-detail/:clientId ────────────────────────────────────────
router.get("/page-detail/:clientId", auth, async (req, res) => {
  const clientId = parseInt(req.params.clientId);
  const days = parseInt((req.query.days as string) || "7");
  const url = req.query.url as string;
  if (!url) { res.status(400).json({ error: "url required" }); return; }
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  try {
    const pageHits = await db
      .select({ bot_name: botHitsTable.bot_name, timestamp: botHitsTable.timestamp })
      .from(botHitsTable)
      .where(sql`${botHitsTable.client_id} = ${clientId} AND ${botHitsTable.url} = ${url} AND ${botHitsTable.timestamp} > ${since}`)
      .orderBy(botHitsTable.timestamp);

    const botGroups: Record<string, Date[]> = {};
    pageHits.forEach((h) => {
      if (!botGroups[h.bot_name]) botGroups[h.bot_name] = [];
      botGroups[h.bot_name].push(new Date(h.timestamp as string));
    });

    const byBot = Object.entries(botGroups).map(([bot_name, timestamps]) => {
      timestamps.sort((a, b) => a.getTime() - b.getTime());
      const intervals: number[] = [];
      for (let i = 1; i < timestamps.length; i++) {
        intervals.push((timestamps[i].getTime() - timestamps[i - 1].getTime()) / 3_600_000);
      }
      const avgIntervalHours = intervals.length > 0
        ? intervals.reduce((a, b) => a + b, 0) / intervals.length : null;
      return {
        bot_name, hits: timestamps.length,
        first_seen: timestamps[0].toISOString(),
        last_seen: timestamps[timestamps.length - 1].toISOString(),
        avg_interval_hours: avgIntervalHours,
      };
    }).sort((a, b) => b.hits - a.hits);

    const dayMap: Record<string, number> = {};
    pageHits.forEach((h) => {
      const date = new Date(h.timestamp as string).toISOString().split("T")[0];
      dayMap[date] = (dayMap[date] || 0) + 1;
    });
    const overTime = Object.entries(dayMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, hits]) => ({ date, hits }));

    const hourlyPattern = new Array(24).fill(0);
    pageHits.forEach((h) => { hourlyPattern[new Date(h.timestamp as string).getHours()]++; });

    res.json({ url, total_hits: pageHits.length, byBot, overTime, hourlyPattern });
  } catch (err) {
    req.log.error({ err }, "Failed to get page detail");
    res.status(500).json({ error: "Server error" });
  }
});

// ── GET /api/export/:clientId ─────────────────────────────────────────────
router.get("/export/:clientId", auth, async (req, res) => {
  const clientId = parseInt(req.params.clientId);
  const days = parseInt((req.query.days as string) || "7");
  const type = (req.query.type as string) || "hits";
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const csvRow = (values: (string | number | null | undefined)[]) =>
    values.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",");

  try {
    if (type === "hits") {
      const hits = await db
        .select()
        .from(botHitsTable)
        .where(sql`${botHitsTable.client_id} = ${clientId} AND ${botHitsTable.timestamp} > ${since}`)
        .orderBy(desc(botHitsTable.timestamp));

      const header = csvRow(["Timestamp", "URL", "Bot Name", "User Agent", "Status Code", "Country", "Referrer"]);
      const rows = hits.map((h) => csvRow([h.timestamp, h.url, h.bot_name, h.user_agent, h.status_code, h.country, h.referrer]));
      const csv = "\uFEFF" + [header, ...rows].join("\n");

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="bot-hits-${days}d.csv"`);
      res.send(csv);
      return;
    }

    if (type === "pages") {
      const topPages = await db
        .select({ url: botHitsTable.url, hits: count() })
        .from(botHitsTable)
        .where(sql`${botHitsTable.client_id} = ${clientId} AND ${botHitsTable.timestamp} > ${since}`)
        .groupBy(botHitsTable.url)
        .orderBy(desc(count()));

      const prevSince = new Date(Date.now() - 2 * days * 24 * 60 * 60 * 1000);
      const prevPages = await db
        .select({ url: botHitsTable.url, hits: count() })
        .from(botHitsTable)
        .where(sql`${botHitsTable.client_id} = ${clientId} AND ${botHitsTable.timestamp} > ${prevSince} AND ${botHitsTable.timestamp} <= ${since}`)
        .groupBy(botHitsTable.url);

      const prevMap: Record<string, number> = {};
      prevPages.forEach((p) => { prevMap[p.url] = Number(p.hits); });

      const header = csvRow(["Rank", "URL", "Hits", "Previous Hits", "Change %"]);
      const rows = topPages.map((p, i) => {
        const curr = Number(p.hits);
        const prev = prevMap[p.url] || 0;
        const change = prev > 0 ? (((curr - prev) / prev) * 100).toFixed(1) : "New";
        return csvRow([i + 1, p.url, curr, prev, change]);
      });
      const csv = "\uFEFF" + [header, ...rows].join("\n");

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="pages-${days}d.csv"`);
      res.send(csv);
      return;
    }

    if (type === "cadence") {
      const allHits = await db
        .select({ bot_name: botHitsTable.bot_name, timestamp: botHitsTable.timestamp, url: botHitsTable.url })
        .from(botHitsTable)
        .where(sql`${botHitsTable.client_id} = ${clientId} AND ${botHitsTable.timestamp} > ${since}`)
        .orderBy(botHitsTable.bot_name, botHitsTable.timestamp);

      const botGroups: Record<string, { timestamps: Date[]; urls: string[] }> = {};
      allHits.forEach((h) => {
        if (!botGroups[h.bot_name]) botGroups[h.bot_name] = { timestamps: [], urls: [] };
        botGroups[h.bot_name].timestamps.push(new Date(h.timestamp as string));
        botGroups[h.bot_name].urls.push(h.url);
      });

      const header = csvRow(["Bot", "Total Hits", "Visits/Day", "Avg Interval (hours)", "Peak Hour", "First Seen", "Last Seen", "Top Page"]);
      const rows = Object.entries(botGroups).map(([bot_name, { timestamps, urls }]) => {
        timestamps.sort((a, b) => a.getTime() - b.getTime());
        const intervals: number[] = [];
        for (let i = 1; i < timestamps.length; i++) intervals.push((timestamps[i].getTime() - timestamps[i - 1].getTime()) / 3600000);
        const avgInterval = intervals.length > 0 ? (intervals.reduce((a, b) => a + b, 0) / intervals.length).toFixed(1) : "N/A";
        const vpd = (timestamps.length / days).toFixed(1);
        const hourCounts = new Array(24).fill(0);
        timestamps.forEach((ts) => { hourCounts[ts.getHours()]++; });
        const peakHour = hourCounts.indexOf(Math.max(...hourCounts));
        const pageCounts: Record<string, number> = {};
        urls.forEach((u) => { pageCounts[u] = (pageCounts[u] || 0) + 1; });
        const topPage = Object.entries(pageCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
        return csvRow([bot_name, timestamps.length, vpd, avgInterval, `${peakHour}:00`, timestamps[0].toISOString(), timestamps[timestamps.length - 1].toISOString(), topPage]);
      }).sort();

      const csv = "\uFEFF" + [header, ...rows].join("\n");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="bot-cadence-${days}d.csv"`);
      res.send(csv);
      return;
    }

    res.status(400).json({ error: "Unknown type" });
  } catch (err) {
    req.log.error({ err }, "Export failed");
    res.status(500).json({ error: "Server error" });
  }
});

// ── POST /api/seed/:clientId (admin only, add realistic demo hits) ─────────
router.post("/seed/:clientId", auth, async (req, res) => {
  const clientId = parseInt(req.params.clientId);
  const days = 30;

  const bots = [
    { name: "GPTBot",             intervalH: 4,   pages: ["/", "/services", "/blog/best-salons-2025", "/about", "/pricing"] },
    { name: "ClaudeBot",          intervalH: 8,   pages: ["/", "/about", "/services", "/team", "/contact"] },
    { name: "PerplexityBot",      intervalH: 12,  pages: ["/services", "/contact", "/", "/about", "/faq"] },
    { name: "Google-Extended",    intervalH: 24,  pages: ["/", "/about", "/services", "/blog/best-salons-2025"] },
    { name: "Bytespider",         intervalH: 36,  pages: ["/services", "/contact", "/about", "/"] },
    { name: "Meta-ExternalAgent", intervalH: 48,  pages: ["/", "/about", "/services"] },
  ];

  const now = Date.now();
  const rows: { client_id: number; url: string; bot_name: string; user_agent: string; status_code: number; timestamp: Date }[] = [];

  for (const bot of bots) {
    let t = now - days * 24 * 3600 * 1000;
    while (t < now) {
      const jitter = (Math.random() - 0.5) * bot.intervalH * 0.4 * 3600 * 1000;
      t += bot.intervalH * 3600 * 1000 + jitter;
      if (t >= now) break;
      const url = bot.pages[Math.floor(Math.random() * bot.pages.length)];
      rows.push({ client_id: clientId, url, bot_name: bot.name, user_agent: `${bot.name}/1.0`, status_code: 200, timestamp: new Date(t) });
    }
  }

  try {
    await db.insert(botHitsTable).values(rows);
    res.json({ inserted: rows.length });
  } catch (err) {
    req.log.error({ err }, "Seed failed");
    res.status(500).json({ error: "Server error" });
  }
});

// ── GET /api/hits/:clientId ────────────────────────────────────────────────
router.get("/hits/:clientId", auth, async (req, res) => {
  const clientId = parseInt(req.params.clientId);
  const days = parseInt((req.query.days as string) || "7");
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  try {
    const hits = await db
      .select().from(botHitsTable)
      .where(sql`${botHitsTable.client_id} = ${clientId} AND ${botHitsTable.timestamp} > ${since}`)
      .orderBy(desc(botHitsTable.timestamp)).limit(200);
    res.json(hits);
  } catch (err) {
    req.log.error({ err }, "Failed to get hits");
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
