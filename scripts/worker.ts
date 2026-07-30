import { closeDb, getSettings } from "../lib/database";
import { runMonitor } from "../lib/monitor";

let stopping = false;

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`Received ${signal}; stopping monitor worker.`);
  await closeDb();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

console.log("Watchtower monitor worker started.");

while (!stopping) {
  const startedAt = Date.now();
  let intervalMinutes = 5;
  try {
    const result = await runMonitor();
    const settings = await getSettings();
    intervalMinutes = settings?.check_interval_minutes || 5;
    console.log(
      JSON.stringify({
        event: "monitor_complete",
        at: new Date().toISOString(),
        ...result,
        nextCheckMinutes: intervalMinutes,
      })
    );
  } catch (error) {
    console.error("Monitor cycle failed; retrying shortly.", error);
    intervalMinutes = 1;
  }

  const targetDelay = Math.max(60_000, intervalMinutes * 60_000);
  const elapsed = Date.now() - startedAt;
  await wait(Math.max(1_000, targetDelay - elapsed));
}
