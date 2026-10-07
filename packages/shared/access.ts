import {
  ACCESS_MODULES,
  type AccessModule,
  type OfficeRole,
  type UserRole,
  type UserStatus,
} from "./enums";

/** What the sidebar and the approval screen call each module. */
export const MODULE_LABELS: Record<AccessModule, string> = {
  dashboard: "Dashboard",
  roster: "Rostering",
  live: "Live jobs",
  clients: "Clients",
  files: "Organisation files",
  services: "Services",
  invoices: "Invoices",
  staff: "Staff",
  payroll: "Timesheets & pay",
  reports: "Reports",
  "worker-reports": "Worker reports",
  feedback: "Complaints & feedback",
  voice: "Voice",
};

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Admin",
  manager: "Manager",
  coordinator: "Coordinator",
  finance: "Finance",
  staff: "Support worker",
};

export const STATUS_LABELS: Record<UserStatus, string> = {
  pending: "Waiting for approval",
  active: "Active",
  disabled: "Disabled",
  rejected: "Declined",
};

/** Modules ticked when a role is chosen. It is only a starting point: the Admin can change every one. */
export const ROLE_DEFAULT_MODULES: Record<OfficeRole, readonly AccessModule[]> =
  {
    admin: ACCESS_MODULES,
    manager: ACCESS_MODULES,
    coordinator: [
      "dashboard",
      "roster",
      "live",
      "clients",
      "files",
      "services",
      "voice",
    ],
    finance: ["dashboard", "clients", "invoices", "payroll", "reports"],
  };

/**
 * What a signed-in user can open in the back office. Admins can open all of it, support
 * workers none of it (they have their own portal), and everyone else exactly what was ticked.
 */
export function effectiveModules(
  role: UserRole,
  modules: readonly string[] | undefined
): AccessModule[] {
  if (role === "admin") return [...ACCESS_MODULES];
  if (role === "staff") return [];
  return ACCESS_MODULES.filter(module => modules?.includes(module));
}
