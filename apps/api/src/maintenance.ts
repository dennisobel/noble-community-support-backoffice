import { recoverStaleJobs } from "./lib/jobs";
import { logger } from "./lib/logger";
import { storage } from "./lib/storage";
import { purgeDeletedDocuments } from "./modules/documents/service";
import { enqueueExpirySweep } from "./modules/portal/expiry";
import { enqueueXeroPoll } from "./modules/xero/service";

const SIX_HOURS = 6 * 60 * 60_000;
const ONE_DAY = 24 * 60 * 60_000;

/** Periodic housekeeping: stale upload temp files, soft-deleted documents older than 30 days, stuck jobs. */
export async function runMaintenance(): Promise<void> {
  try {
    const [tempRemoved, documentsPurged, jobsRecovered] = await Promise.all([
      storage.sweepTemp(60 * 60_000),
      purgeDeletedDocuments(30),
      recoverStaleJobs(),
    ]);
    if (tempRemoved || documentsPurged || jobsRecovered)
      logger().info(
        { tempRemoved, documentsPurged, jobsRecovered },
        "Maintenance completed"
      );
  } catch (error) {
    logger().error({ err: error }, "Maintenance failed");
  }
}

/**
 * Daily job: queues the document-expiry sweep. The sweep itself runs as a background job
 * (and therefore survives restarts); this timer only needs to kick it off once a day.
 */
export async function runExpiryTick(): Promise<void> {
  try {
    await enqueueExpirySweep();
  } catch (error) {
    logger().error({ err: error }, "Expiry tick failed");
  }
}

/** Every 15 minutes: queues the Xero payment check. The check itself runs as a background job. */
export async function runXeroTick(): Promise<void> {
  try {
    await enqueueXeroPoll();
  } catch (error) {
    logger().error({ err: error }, "Xero tick failed");
  }
}

export function startMaintenance(): { stop: () => void } {
  const first = setTimeout(() => void runMaintenance(), 30_000);
  const firstXero = setTimeout(() => void runXeroTick(), 60_000);
  const xeroInterval = setInterval(() => void runXeroTick(), 15 * 60_000);
  firstXero.unref();
  xeroInterval.unref();
  // The cron fires the first time five minutes after boot (so expiry emails can go out
  // on the very first morning), then once every 24 hours.
  const firstExpiry = setTimeout(() => void runExpiryTick(), 5 * 60_000);
  const interval = setInterval(() => void runMaintenance(), SIX_HOURS);
  const expiryInterval = setInterval(() => void runExpiryTick(), ONE_DAY);
  first.unref();
  firstExpiry.unref();
  interval.unref();
  expiryInterval.unref();
  return {
    stop: () => {
      clearTimeout(first);
      clearTimeout(firstExpiry);
      clearTimeout(firstXero);
      clearInterval(xeroInterval);
      clearInterval(interval);
      clearInterval(expiryInterval);
    },
  };
}
