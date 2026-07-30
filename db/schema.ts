import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const watchedAccounts = sqliteTable("watched_accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  address: text("address").notNull(),
  chainId: integer("chain_id").notNull(),
  chainName: text("chain_name").notNull(),
  symbol: text("symbol").notNull().default("ETH"),
  rpcUrl: text("rpc_url").notNull(),
  threshold: text("threshold").notNull().default("0.05"),
  balance: text("balance"),
  status: text("status").notNull().default("pending"),
  lastCheckedAt: text("last_checked_at"),
  lastAlertAt: text("last_alert_at"),
  alertActive: integer("alert_active").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const appSettings = sqliteTable("app_settings", {
  id: integer("id").primaryKey(),
  telegramBotToken: text("telegram_bot_token").notNull().default(""),
  telegramChatId: text("telegram_chat_id").notNull().default(""),
  checkIntervalMinutes: integer("check_interval_minutes").notNull().default(5),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
