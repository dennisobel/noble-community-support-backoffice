import mongoose from "mongoose";

/**
 * Integration tests need a MongoDB replica set (transactions). By default they use the dev container:
 *   docker compose up -d mongo
 * Override with MONGO_TEST_URI. A bare `mongod --replSet rs0` is initiated automatically.
 */
export default async function globalSetup(): Promise<void> {
  const uri =
    process.env.MONGO_TEST_URI ??
    "mongodb://127.0.0.1:27017/?directConnection=true";
  const connection = mongoose.createConnection(uri, {
    serverSelectionTimeoutMS: 5000,
  });
  try {
    await connection.asPromise();
  } catch (error) {
    throw new Error(
      `Cannot reach MongoDB at ${uri}. Start it with "docker compose up -d mongo" or set MONGO_TEST_URI.\n${String(error)}`
    );
  }
  const admin = connection.db!.admin();
  try {
    await admin.command({ replSetGetStatus: 1 });
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code !== 94) throw error; // 94 = NotYetInitialized
    const host = new URL(uri.replace(/^mongodb:\/\//, "http://")).host;
    await admin.command({
      replSetInitiate: { _id: "rs0", members: [{ _id: 0, host }] },
    });
  }
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const hello = await admin.command({ hello: 1 });
    if (hello.isWritablePrimary) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  await connection.close();
}
