import { Router } from "express";
import { db } from "@workspace/db";
import { clientsTable, botHitsTable } from "@workspace/db/schema";
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
        tracking_method: clientsTable.tracking_method,
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
  const { name, domain, tracking_method } = req.body as {
    name: string;
    domain: string;
    tracking_method?: string;
  };
  const api_key =
    Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15);
  try {
    const [client] = await db
      .insert(clientsTable)
      .values({ name, domain, api_key, tracking_method: tracking_method || "cloudflare" })
      .returning();
    res.json(client);
  } catch (err) {
    req.log.error({ err }, "Failed to create client");
    res.status(500).json({ error: "Server error" });
  }
});

router.put("/clients/:id", auth, async (req, res) => {
  const id = parseInt(req.params.id);
  const { name, domain } = req.body as { name: string; domain: string };
  if (!name || !domain) { res.status(400).json({ error: "name and domain required" }); return; }
  try {
    const [updated] = await db
      .update(clientsTable)
      .set({ name: name.trim(), domain: domain.trim() })
      .where(eq(clientsTable.id, id))
      .returning();
    if (!updated) { res.status(404).json({ error: "Not found" }); return; }
    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to update client");
    res.status(500).json({ error: "Server error" });
  }
});

router.delete("/clients/:id", auth, async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    await db.delete(botHitsTable).where(eq(botHitsTable.client_id, id));
    await db.delete(clientsTable).where(eq(clientsTable.id, id));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete client");
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/clients/:clientId/php-script", auth, async (req, res) => {
  try {
    const [client] = await db
      .select()
      .from(clientsTable)
      .where(eq(clientsTable.id, parseInt(req.params.clientId)))
      .limit(1);

    if (!client) {
      res.status(404).json({ error: "Client not found" });
      return;
    }

    const domains = process.env.REPLIT_DOMAINS ?? "";
    const primaryDomain = domains.split(",")[0]?.trim() ?? "";
    const replitUrl = primaryDomain ? `https://${primaryDomain}` : "https://YOUR-APP-URL";

    const phpScript = `<?php
// AI Bot Tracker — Befound Search
// Client: ${client.name} (${client.domain})
// Auto-generated — do not edit API key

define('TRACKER_API', '${replitUrl}/api/hit');
define('CLIENT_API_KEY', '${client.api_key}');

$AI_BOTS = [
  'GPTBot'             => 'GPTBot',
  'ChatGPT-User'       => 'ChatGPT-User',
  'ClaudeBot'          => 'ClaudeBot',
  'Anthropic'          => 'anthropic-ai',
  'Google-Extended'    => 'Google-Extended',
  'PerplexityBot'      => 'PerplexityBot',
  'Bytespider'         => 'Bytespider',
  'CCBot'              => 'CCBot',
  'Meta-ExternalAgent' => 'Meta-ExternalAgent',
  'Cohere'             => 'cohere-ai',
  'YouBot'             => 'YouBot',
  'Diffbot'            => 'Diffbot',
  'Applebot-Extended'  => 'Applebot-Extended',
];

$userAgent = ${'$_SERVER'}['HTTP_USER_AGENT'] ?? '';
$matchedBot = null;

foreach ($AI_BOTS as $name => $pattern) {
  if (stripos($userAgent, $pattern) !== false) {
    $matchedBot = $name;
    break;
  }
}

if ($matchedBot) {
  $url      = ${'$_SERVER'}['REQUEST_URI'] ?? '/';
  $referrer = ${'$_SERVER'}['HTTP_REFERER'] ?? null;
  $country  = ${'$_SERVER'}['HTTP_CF_IPCOUNTRY'] ?? null;

  $payload = json_encode([
    'api_key'     => CLIENT_API_KEY,
    'url'         => $url,
    'bot_name'    => $matchedBot,
    'user_agent'  => $userAgent,
    'status_code' => http_response_code(),
    'country'     => $country,
    'referrer'    => $referrer
  ]);

  $context = stream_context_create([
    'http' => [
      'method'  => 'POST',
      'header'  => "Content-Type: application/json\\r\\nContent-Length: " . strlen($payload),
      'content' => $payload,
      'timeout' => 2
    ]
  ]);

  @file_get_contents(TRACKER_API, false, $context);
}
`;

    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="bot-tracker.php"`);
    res.send(phpScript);
  } catch (err) {
    req.log.error({ err }, "Failed to generate PHP script");
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
