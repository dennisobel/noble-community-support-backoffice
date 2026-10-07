import {
  CalendarDays,
  ClipboardList,
  Home,
  LogOut,
  MessagesSquare,
  NotebookPen,
  ShieldAlert,
  UserRound,
} from "lucide-react";
import { lazy, Suspense, type ComponentType } from "react";
import { Link, Route, Switch, useLocation } from "wouter";
import { useUnreadMessages } from "@/api/hooks";
import { Spinner } from "@/components/app/ui";
import { useAuth } from "@/lib/auth";
import NotFound from "@/pages/NotFound";

const PortalHome = lazy(() => import("./PortalHome"));
const PortalSchedule = lazy(() => import("./PortalSchedule"));
const PortalShiftPage = lazy(() => import("./PortalShiftPage"));
const PortalNotesPage = lazy(() => import("./PortalNotesPage"));
const PortalNoteEditor = lazy(() => import("./PortalNoteEditor"));
const PortalNotebook = lazy(() => import("@/features/notes/PortalNotebook"));
const PortalReportsPage = lazy(() => import("./PortalReportsPage"));
const PortalProfilePage = lazy(() => import("./PortalProfilePage"));
const PortalMessages = lazy(() => import("@/features/messages/PortalMessages"));

interface Tab {
  href: string;
  label: string;
  icon: ComponentType<{ size?: number }>;
  active: (path: string) => boolean;
}

const TABS: Tab[] = [
  {
    href: "/staff",
    label: "Today",
    icon: Home,
    active: path => path === "/staff" || path === "/staff/",
  },
  {
    href: "/staff/schedule",
    label: "Schedule",
    icon: CalendarDays,
    active: path =>
      path.startsWith("/staff/schedule") || path.startsWith("/staff/shifts"),
  },
  {
    href: "/staff/notes",
    label: "Notes",
    icon: ClipboardList,
    active: path => path.startsWith("/staff/notes"),
  },
  {
    href: "/staff/notebook",
    label: "Notebook",
    icon: NotebookPen,
    active: path => path.startsWith("/staff/notebook"),
  },
  {
    href: "/staff/reports",
    label: "Reports",
    icon: ShieldAlert,
    active: path => path.startsWith("/staff/reports"),
  },
  {
    href: "/staff/profile",
    label: "Profile",
    icon: UserRound,
    active: path => path.startsWith("/staff/profile"),
  },
];

function titleFor(path: string): string {
  if (path.startsWith("/staff/shifts")) return "Shift";
  if (path.startsWith("/staff/messages")) return "Messages";
  if (path.startsWith("/staff/notes/")) return "Progress note";
  const tab = TABS.find(item => item.active(path));
  return tab && tab.href !== "/staff" ? tab.label : "Noble";
}

/**
 * The worker's portal: a phone-shaped app with a bottom tab bar that becomes a
 * top bar on wider screens. Workers only ever see their own shifts and records.
 */
export default function StaffShell() {
  const [path] = useLocation();
  const { session, signOut } = useAuth();
  const unread = useUnreadMessages().data?.unread ?? 0;

  return (
    <div className="portal">
      <header className="portal-top">
        <h1>{titleFor(path)}</h1>
        {/* Six tabs already fill a phone, so Messages lives up here beside sign-out. */}
        <Link
          href="/staff/messages"
          className="portal-top-action relative no-underline"
          aria-label={unread ? `Messages (${unread} new)` : "Messages"}
          title="Messages"
        >
          <MessagesSquare size={16} />
          {unread > 0 && (
            <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-[#e18a65] px-1 text-[9px] font-bold text-white">
              {unread}
            </span>
          )}
        </Link>
        <button
          type="button"
          className="portal-top-action"
          onClick={() => void signOut()}
          aria-label={`Sign out of ${session?.user.name ?? "your account"}`}
          title="Sign out"
        >
          <LogOut size={16} />
        </button>
      </header>

      <nav className="portal-tabbar" aria-label="Portal sections">
        {TABS.map(tab => {
          const Icon = tab.icon;
          const active = tab.active(path);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={active ? "active" : undefined}
              aria-current={active ? "page" : undefined}
            >
              <Icon size={19} />
              {tab.label}
            </Link>
          );
        })}
      </nav>

      <main className="portal-body">
        <Suspense
          fallback={
            <div className="grid place-items-center py-16">
              <Spinner />
            </div>
          }
        >
          <Switch>
            <Route path="/staff" component={PortalHome} />
            <Route path="/staff/schedule/:section?" component={PortalSchedule} />
            <Route path="/staff/shifts/:id" component={PortalShiftPage} />
            <Route path="/staff/notes" component={PortalNotesPage} />
            <Route path="/staff/notes/new" component={PortalNoteEditor} />
            <Route path="/staff/notes/:id" component={PortalNoteEditor} />
            <Route path="/staff/notebook/:id?" component={PortalNotebook} />
            <Route
              path="/staff/reports/:section?"
              component={PortalReportsPage}
            />
            <Route path="/staff/profile" component={PortalProfilePage} />
            <Route path="/staff/messages/:id?" component={PortalMessages} />
            <Route component={NotFound} />
          </Switch>
        </Suspense>
      </main>
    </div>
  );
}
