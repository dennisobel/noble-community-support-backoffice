import type { NextFunction, Request, Response } from "express";
import type { AccessModule } from "@shared/enums";
import { errors } from "../lib/errors";

/**
 * Who may call what in the back office. Admins may call everything. Everyone else is denied
 * unless a rule below grants the request, so a route nobody listed (users, the audit log,
 * Xero, editing the workspace) stays Admin-only by default.
 */
export interface AccessRule {
  prefix: string;
  /** Only the path itself (a list endpoint), not everything beneath it. */
  exact?: boolean;
  /** Modules that may use every method here. */
  full?: AccessModule[];
  /** Modules that may only read here: the lookups they need in order to work. */
  read?: AccessModule[];
  /** Any approved office user may. */
  open?: "read" | "all";
}

export const ACCESS_RULES: AccessRule[] = [
  // Everyone signed in to the back office ("My day" is each person's own roster; Notes has its own router)
  { prefix: "/me", open: "all" },
  { prefix: "/notifications", open: "all" },
  { prefix: "/search", open: "all" },
  { prefix: "/settings/preferences", open: "all" },
  { prefix: "/settings/workspace", open: "read" },
  // One module each
  { prefix: "/dashboard", full: ["dashboard"] },
  { prefix: "/roster", full: ["roster"] },
  { prefix: "/tracking", full: ["live"] },
  { prefix: "/invoices", full: ["invoices"] },
  { prefix: "/integrations/xero/invoices", full: ["invoices"] },
  { prefix: "/reports", full: ["reports"] },
  { prefix: "/incidents", full: ["worker-reports"] },
  { prefix: "/abc-reports", full: ["worker-reports"] },
  { prefix: "/logbook", full: ["worker-reports"] },
  { prefix: "/budgets", full: ["clients"] },
  // Core data: owned by one module, readable by the modules that need the names
  {
    prefix: "/participants",
    full: ["clients"],
    read: ["roster", "invoices", "voice", "files"],
  },
  { prefix: "/service-records", full: ["clients"], read: ["invoices", "voice"] },
  {
    prefix: "/services",
    full: ["services"],
    read: ["roster", "clients", "voice"],
  },
  { prefix: "/voice-notes", full: ["voice"], read: ["clients"] },
  // A client's own documents live in their profile, so Clients can use the library too
  { prefix: "/documents", full: ["files", "clients"] },
  // E-signatures are document work, so they follow the same access as the library
  { prefix: "/signatures", full: ["files", "clients"] },
  // Team: the list is a lookup for rostering; everything beneath it (compliance, invites) is the Staff module
  {
    prefix: "/staff",
    exact: true,
    read: ["roster", "clients", "live", "files"],
  },
  { prefix: "/staff", full: ["staff"] },
  // Pay: classification names are a lookup for the Staff page; rates and everything else are payroll's
  { prefix: "/payroll/classifications", exact: true, read: ["staff"] },
  { prefix: "/payroll", full: ["payroll"] },
  // The register brings its own lists of people to choose from, so it needs no other module
  { prefix: "/feedback", full: ["feedback"] },
];

const matches = (rule: AccessRule, path: string) =>
  path === rule.prefix ||
  (!rule.exact && path.startsWith(`${rule.prefix}/`));

export function canCall(
  user: { role: string; modules: readonly AccessModule[] },
  method: string,
  path: string
): boolean {
  if (user.role === "admin") return true;
  const trimmed = path.length > 1 ? path.replace(/\/+$/, "") : path;
  const read = method === "GET" || method === "HEAD";
  const has = (wanted?: AccessModule[]) =>
    Boolean(wanted?.some(module => user.modules.includes(module)));
  return ACCESS_RULES.some(
    rule =>
      matches(rule, trimmed) &&
      (rule.open === "all" ||
        (rule.open === "read" && read) ||
        has(rule.full) ||
        (read && has(rule.read)))
  );
}

/** Runs after `authenticate` and `requireOffice` on every back-office route. */
export function enforceModuleAccess(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const user = req.auth?.user;
  if (!user) throw errors.unauthenticated();
  if (!canCall(user, req.method, req.path))
    throw errors.forbidden(
      "Your account does not have access to this part of the workspace."
    );
  next();
}
