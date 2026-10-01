import fs from "node:fs/promises";
import type { Express } from "express";
import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../src/app";
import { config } from "../src/config";
import {
  connectDatabase,
  disconnectDatabase,
  ensureModels,
} from "../src/lib/db";
import { storage } from "../src/lib/storage";
import {
  ensureWorkspace,
  invalidateWorkspaceCache,
} from "../src/lib/workspace";
import { ensureTemplateSlots } from "../src/modules/documents/service";
import "../src/models";

export const API = "/api/v1";

export async function startTestApp(): Promise<Express> {
  await connectDatabase(config().mongoUri);
  await ensureModels();
  await ensureWorkspace();
  await ensureTemplateSlots();
  await storage.init();
  invalidateWorkspaceCache();
  return createApp();
}

export async function stopTestApp(): Promise<void> {
  if (mongoose.connection.readyState === 1)
    await mongoose.connection.dropDatabase();
  await disconnectDatabase();
  await fs.rm(config().uploads.dir, { recursive: true, force: true });
}

export const ADMIN = {
  name: "Maya Thompson",
  email: "maya@noble.test",
  password: "correct horse battery",
};

/** Signs up the first Admin and returns a cookie-carrying agent. */
export async function signedInAgent(app: Express) {
  const agent = request.agent(app);
  const response = await agent.post(`${API}/auth/signup`).send(ADMIN);
  if (response.status !== 201)
    throw new Error(
      `Signup failed: ${response.status} ${JSON.stringify(response.body)}`
    );
  return agent;
}

export function cookieNames(response: request.Response): string[] {
  const header = response.headers["set-cookie"] as unknown as
    | string[]
    | undefined;
  return (header ?? []).map(cookie => cookie.split("=")[0]);
}
