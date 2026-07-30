CREATE TABLE `app_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`telegram_bot_token` text DEFAULT '' NOT NULL,
	`telegram_chat_id` text DEFAULT '' NOT NULL,
	`check_interval_minutes` integer DEFAULT 5 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `watched_accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`address` text NOT NULL,
	`chain_id` integer NOT NULL,
	`chain_name` text NOT NULL,
	`symbol` text DEFAULT 'ETH' NOT NULL,
	`rpc_url` text NOT NULL,
	`threshold` text DEFAULT '0.05' NOT NULL,
	`balance` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`last_checked_at` text,
	`last_alert_at` text,
	`alert_active` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
