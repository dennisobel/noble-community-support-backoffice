import { createApp } from "./app";
import { config, usingDevJwtSecret } from "./config";
import { seedDemo } from "./db/seed";
import { connectDatabase, disconnectDatabase, ensureModels } from "./lib/db";
import { startJobWorker } from "./lib/jobs";
import { logger } from "./lib/logger";
import { storage } from "./lib/storage";
import { ensureWorkspace } from "./lib/workspace";
import { startMaintenance } from "./maintenance";
import { ensureTemplateSlots } from "./modules/documents/service";
/* Registers the background-job handlers (transcription, drafts, expiry alerts). */
import "./modules/portal/expiry";
import "./models";

async function main(): Promise<void> {
  const cfg = config();
  const log = logger();
  if (usingDevJwtSecret(cfg))
    log.warn(
      "JWT_ACCESS_SECRET is not set; using an insecure development secret."
    );
  if (!cfg.mail.enabled)
    log.warn(
      "SMTP is not configured; password reset and invoice emails will not be delivered."
    );

  await storage.init();
  await connectDatabase(cfg.mongoUri);
  await ensureModels();
  await ensureWorkspace();
  await ensureTemplateSlots();
  if (cfg.demo.seed) {
    const result = await seedDemo({ onlyIfEmpty: true });
    if (result.seeded)
      log.info(
        {
          email: result.email,
          password: result.generatedPassword
            ? "(generated, see below)"
            : "(from DEMO_ADMIN_PASSWORD)",
        },
        "Demo data loaded"
      );
    if (result.generatedPassword)
      log.info(`Demo Admin password: ${result.generatedPassword}`);
  }

  const app = createApp();
  const server = app.listen(cfg.port, () =>
    log.info(
      { port: cfg.port, env: cfg.env },
      `Noble API listening on http://localhost:${cfg.port}`
    )
  );
  const worker = cfg.jobsEnabled ? startJobWorker() : null;
  const maintenance = startMaintenance();

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info({ signal }, "Shutting down");
    const force = setTimeout(() => process.exit(1), 15_000);
    force.unref();
    maintenance.stop();
    await worker?.stop();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await disconnectDatabase();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch(error => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
