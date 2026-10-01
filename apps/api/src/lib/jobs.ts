import { Job, type JobType } from "../models";
import { RetryableProviderError } from "./errors";
import { logger } from "./logger";

type Handler = (payload: Record<string, unknown>) => Promise<void>;
type FailureHandler = (
  payload: Record<string, unknown>,
  error: unknown
) => Promise<void>;

const handlers = new Map<JobType, Handler>();
const failureHandlers = new Map<JobType, FailureHandler>();
const sleepers = new Set<() => void>();

function wakeWorkers(): void {
  for (const wake of [...sleepers]) wake();
}

export function registerJob(
  type: JobType,
  handler: Handler,
  onFinalFailure?: FailureHandler
): void {
  handlers.set(type, handler);
  if (onFinalFailure) failureHandlers.set(type, onFinalFailure);
}

export async function enqueueJob(
  type: JobType,
  payload: Record<string, unknown>,
  maxAttempts = 3
): Promise<void> {
  await Job.create({
    type,
    payload,
    status: "queued",
    attempts: 0,
    maxAttempts,
    runAt: new Date(),
  });
  wakeWorkers();
}

const backoffMs = (attempt: number) =>
  Math.min(60_000, 2_000 * 2 ** (attempt - 1));

/** Claims and runs one due job. Returns false when nothing is due. */
export async function runNextJob(): Promise<boolean> {
  const now = new Date();
  const job = await Job.findOneAndUpdate(
    { status: "queued", runAt: { $lte: now } },
    { $set: { status: "running", lockedAt: now }, $inc: { attempts: 1 } },
    { sort: { runAt: 1 }, returnDocument: "after", lean: true }
  );
  if (!job) return false;
  const handler = handlers.get(job.type);
  try {
    if (!handler)
      throw new Error(`No handler registered for job type ${job.type}`);
    await handler(job.payload);
    await Job.updateOne(
      { _id: job._id },
      { $set: { status: "done", lockedAt: null, lastError: null } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const retry =
      error instanceof RetryableProviderError && job.attempts < job.maxAttempts;
    await Job.updateOne(
      { _id: job._id },
      retry
        ? {
            $set: {
              status: "queued",
              lockedAt: null,
              lastError: message,
              runAt: new Date(Date.now() + backoffMs(job.attempts)),
            },
          }
        : { $set: { status: "failed", lockedAt: null, lastError: message } }
    );
    logger().warn(
      {
        jobId: String(job._id),
        type: job.type,
        attempt: job.attempts,
        retry,
        err: error,
      },
      "Background job failed"
    );
    if (!retry) {
      await failureHandlers
        .get(job.type)?.(job.payload, error)
        .catch(failure =>
          logger().error({ err: failure }, "Job failure handler failed")
        );
    }
  }
  return true;
}

/** Runs every due job (used by tests). */
export async function drainJobs(limit = 100): Promise<number> {
  let processed = 0;
  while (processed < limit && (await runNextJob())) processed += 1;
  return processed;
}

/** Requeues jobs whose worker stopped mid-run (for example a container restart). */
export async function recoverStaleJobs(staleMs = 10 * 60_000): Promise<number> {
  const result = await Job.updateMany(
    { status: "running", lockedAt: { $lt: new Date(Date.now() - staleMs) } },
    { $set: { status: "queued", lockedAt: null } }
  );
  return result.modifiedCount;
}

/** In-process worker: polls every `pollMs` and is woken immediately when a job is enqueued. */
export function startJobWorker(
  options: { concurrency?: number; pollMs?: number } = {}
): { stop: () => Promise<void> } {
  const concurrency = options.concurrency ?? 2;
  const pollMs = options.pollMs ?? 1_000;
  let running = true;
  const sleep = () =>
    new Promise<void>(resolve => {
      const done = () => {
        clearTimeout(timer);
        sleepers.delete(done);
        resolve();
      };
      const timer = setTimeout(done, pollMs);
      sleepers.add(done);
    });
  const loop = async () => {
    while (running) {
      try {
        if (!(await runNextJob())) await sleep();
      } catch (error) {
        logger().error({ err: error }, "Job worker loop error");
        await sleep();
      }
    }
  };
  void recoverStaleJobs().catch(() => undefined);
  const loops = Array.from({ length: concurrency }, () => loop());
  return {
    stop: async () => {
      running = false;
      wakeWorkers();
      await Promise.race([
        Promise.all(loops),
        new Promise(resolve => setTimeout(resolve, 5_000)),
      ]);
    },
  };
}
