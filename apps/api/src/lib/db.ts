import mongoose, { type ClientSession } from "mongoose";
import { logger } from "./logger";

mongoose.set("strictQuery", true);

export async function connectDatabase(
  uri: string,
  options: { dbName?: string } = {}
): Promise<typeof mongoose> {
  const connection = await mongoose.connect(uri, {
    dbName: options.dbName,
    serverSelectionTimeoutMS: 15_000,
    maxPoolSize: 20,
    autoIndex: true,
  });
  logger().info({ db: mongoose.connection.name }, "Connected to MongoDB");
  return connection;
}

/** Creates collections and indexes for every registered model. Collections must exist before use in transactions. */
export async function ensureModels(): Promise<void> {
  await Promise.all(Object.values(mongoose.models).map(model => model.init()));
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}

/** Runs `fn` in a multi-document transaction (retried on transient errors) and returns its result. */
export async function withTransaction<T>(
  fn: (session: ClientSession) => Promise<T>
): Promise<T> {
  let result!: T;
  await mongoose.connection.transaction(async session => {
    result = await fn(session);
  });
  return result;
}

export function isValidObjectId(value: string): boolean {
  return /^[a-f\d]{24}$/i.test(value);
}

export function oid(value: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(value);
}
