import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { clientsTable } from "./clients";

export const botHitsTable = pgTable("bot_hits", {
  id: serial("id").primaryKey(),
  client_id: integer("client_id").notNull().references(() => clientsTable.id),
  url: text("url"),
  bot_name: text("bot_name"),
  user_agent: text("user_agent"),
  status_code: integer("status_code"),
  country: text("country"),
  referrer: text("referrer"),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
});

export const insertBotHitSchema = createInsertSchema(botHitsTable).omit({ id: true, timestamp: true });
export type InsertBotHit = z.infer<typeof insertBotHitSchema>;
export type BotHit = typeof botHitsTable.$inferSelect;
