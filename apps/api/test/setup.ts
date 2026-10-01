import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { loadConfig, setConfig } from "../src/config";

// Each test file gets its own database and upload directory so files can run in parallel.
const base =
  process.env.MONGO_TEST_URI ??
  "mongodb://127.0.0.1:27017/?directConnection=true";
const dbName = `noble_test_${randomUUID().slice(0, 8)}`;
const uri = new URL(base.replace(/^mongodb:\/\//, "http://"));
uri.pathname = `/${dbName}`;

process.env.NODE_ENV = "test";
process.env.MONGO_URI = uri.toString().replace(/^http:\/\//, "mongodb://");
process.env.UPLOADS_DIR = path.join(os.tmpdir(), "noble-test-uploads", dbName);
process.env.RATE_LIMIT_ENABLED = "false";
process.env.JOBS_ENABLED = "false";
process.env.JWT_ACCESS_SECRET =
  "test-secret-test-secret-test-secret-0123456789";
process.env.APP_URL = "http://localhost:3000";
process.env.LOG_LEVEL = "silent";

setConfig(loadConfig(process.env));
