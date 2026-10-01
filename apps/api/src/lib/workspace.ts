import { todayIn } from "@shared/logic/time";
import { config } from "../config";
import {
  Workspace,
  WORKSPACE_ID,
  workspaceDefaults,
  type WorkspaceDoc,
} from "../models";

const CACHE_MS = 15_000;
let cache: { value: WorkspaceDoc; at: number } | null = null;

/** Creates the single workspace document with defaults if it does not exist yet. */
export async function ensureWorkspace(): Promise<WorkspaceDoc> {
  await Workspace.updateOne(
    { _id: WORKSPACE_ID },
    {
      $setOnInsert: {
        ...workspaceDefaults(config().timezone),
        setupCompletedAt: null,
      },
    },
    { upsert: true }
  );
  const doc = await Workspace.findById(WORKSPACE_ID).lean<WorkspaceDoc>();
  if (!doc) throw new Error("Workspace document could not be created");
  return doc;
}

export async function getWorkspace(): Promise<WorkspaceDoc> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const doc =
    (await Workspace.findById(WORKSPACE_ID).lean<WorkspaceDoc>()) ??
    (await ensureWorkspace());
  cache = { value: doc, at: Date.now() };
  return doc;
}

export function invalidateWorkspaceCache(): void {
  cache = null;
}

/** Today's business date in the workspace timezone. */
export async function workspaceToday(): Promise<string> {
  const workspace = await getWorkspace();
  return todayIn(workspace.timezone || config().timezone);
}

export async function workspaceTimezone(): Promise<string> {
  return (await getWorkspace()).timezone || config().timezone;
}
