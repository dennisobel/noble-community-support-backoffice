import type { ClientSession } from "mongoose";
import { Counter } from "../models";

/** Atomically increments and returns the next value of a named counter (starts at 1). */
export async function nextSeq(
  key: string,
  session?: ClientSession
): Promise<number> {
  const doc = await Counter.findOneAndUpdate(
    { _id: key },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after", session, lean: true }
  );
  if (!doc) throw new Error(`Counter ${key} could not be incremented`);
  return doc.seq;
}

/** Raises a counter so the next value is greater than `value` (used by the demo seed). */
export async function ensureCounterAtLeast(
  key: string,
  value: number
): Promise<void> {
  await Counter.updateOne(
    { _id: key },
    { $max: { seq: value } },
    { upsert: true }
  );
}

export const RECORD_BASE = 1000;
export const SHIFT_BASE = 2400;

export const nextIds = {
  serviceRecord: async (session?: ClientSession) =>
    `SR-${RECORD_BASE + (await nextSeq("serviceRecord", session))}`,
  shift: async (session?: ClientSession) =>
    `SH-${SHIFT_BASE + (await nextSeq("shift", session))}`,
  voiceNote: async (session?: ClientSession) =>
    `VN-${String(await nextSeq("voiceNote", session)).padStart(3, "0")}`,
  invoice: async (prefix: string, year: string, session?: ClientSession) =>
    `${prefix}-${year}-${String(await nextSeq(`invoice:${year}`, session)).padStart(3, "0")}`,
  clientNumber: (session?: ClientSession) => nextSeq("participant", session),
  payRun: async (session?: ClientSession) =>
    `PR-${String(await nextSeq("payRun", session)).padStart(4, "0")}`,
  feedback: async (session?: ClientSession) =>
    `FB-${String(await nextSeq("feedback", session)).padStart(4, "0")}`,
};
