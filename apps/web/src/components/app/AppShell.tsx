import {
  AudioLines,
  BarChart3,
  Bell,
  CalendarDays,
  FolderOpen,
  HandHeart,
  LayoutDashboard,
  LogOut,
  Menu,
  Radio,
  Search,
  Settings,
  ShieldAlert,
  UserRound,
  Users,
  WalletCards,
  X,
  type LucideIcon,
} from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link, Route, Switch, useLocation } from "wouter";
import {
  useMarkNotificationsRead,
  useNotifications,
  useSearch,
} from "@/api/hooks";
import { useAuth } from "@/lib/auth";
import { prettyDate, timeAgo } from "@/lib/format";
import { Avatar, Btn, EmptyState, LoadingBlock, useDebounced } from "./ui";

// Each workspace area is its own chunk, loaded on first visit.
const ClientProfilePage = lazy(
  () => import("@/features/clients/ClientProfilePage")
);
const ClientsPage = lazy(() => import("@/features/clients/ClientsPage"));
const DashboardPage = lazy(() => import("@/features/dashboard/DashboardPage"));
const OrganisationFilesPage = lazy(
  () => import("@/features/documents/OrganisationFilesPage")
);
const InvoicePreviewPage = lazy(
  () => import("@/features/invoices/InvoicePreviewPage")
);
const InvoicesPage = lazy(() => import("@/features/invoices/InvoicesPage"));
const RecordEditorPage = lazy(
  () => import("@/features/records/RecordEditorPage")
);
const ReviewQueuePage = lazy(
  () => import("@/features/records/ReviewQueuePage")
);
const ReportsPage = lazy(() => import("@/features/reports/ReportsPage"));
const RosterPage = lazy(() => import("@/features/roster/RosterPage"));
const ServicesPage = lazy(() => import("@/features/services/ServicesPage"));
const SettingsPage = lazy(() => import("@/features/settings/SettingsPage"));
const StaffPage = lazy(() => import("@/features/staff/StaffPage"));
const LiveTrackingPage = lazy(
  () => import("@/features/tracking/LiveTrackingPage")
);
const WorkerReportsPage = lazy(
  () => import("@/features/reports/WorkerReportsPage")
);
const RecorderPage = lazy(() => import("@/features/voice/RecorderPage"));
const VoiceDetailPage = lazy(() => import("@/features/voice/VoiceDetailPage"));
const VoiceInboxPage = lazy(() => import("@/features/voice/VoiceInboxPage"));

interface NavItem {
  name: string;
  icon: LucideIcon;
  href: string;
  active: (path: string) => boolean;
}

const NAV: NavItem[] = [
  {
    name: "Dashboard",
    icon: LayoutDashboard,
    href: "/app",
    active: path => path === "/app" || path === "/app/",
  },
  {
    name: "Rostering",
    icon: CalendarDays,
    href: "/app/roster",
    active: path => path.startsWith("/app/roster"),
  },
  {
    name: "Live jobs",
    icon: Radio,
    href: "/app/live",
    active: path => path.startsWith("/app/live"),
  },
  {
    name: "Clients",
    icon: Users,
    href: "/app/clients",
    active: path =>
      ["/app/clients", "/app/records", "/app/review"].some(prefix =>
        path.startsWith(prefix)
      ),
  },
  {
    name: "Organisation files",
    icon: FolderOpen,
    href: "/app/files",
    active: path => path.startsWith("/app/files"),
  },
  {
    name: "Services",
    icon: HandHeart,
    href: "/app/services",
    active: path => path.startsWith("/app/services"),
  },
  {
    name: "Invoices",
    icon: WalletCards,
    href: "/app/invoices",
    active: path => path.startsWith("/app/invoices"),
  },
  {
    name: "Staff",
    icon: UserRound,
    href: "/app/staff",
    active: path => path.startsWith("/app/staff"),
  },
  {
    name: "Reports",
    icon: BarChart3,
    href: "/app/reports",
    active: path => path.startsWith("/app/reports"),
  },
  {
    name: "Worker reports",
    icon: ShieldAlert,
    href: "/app/worker-reports",
    active: path => path.startsWith("/app/worker-reports"),
  },
  {
    name: "Voice",
    icon: AudioLines,
    href: "/app/voice",
    active: path => path.startsWith("/app/voice"),
  },
  {
    name: "Settings",
    icon: Settings,
    href: "/app/settings",
    active: path => path.startsWith("/app/settings"),
  },
];

function pageTitle(path: string): string {
  if (/^\/app\/clients\/[^/]+/.test(path)) return "Client profile";
  if (path.startsWith("/app/records/new")) return "New service record";
  if (path.startsWith("/app/records/")) return "Service record";
  if (path.startsWith("/app/review")) return "Review queue";
  if (path.startsWith("/app/invoices/new")) return "Create invoice";
  if (/^\/app\/invoices\/[^/]+/.test(path)) return "Invoice preview";
  if (path.startsWith("/app/voice/record")) return "Recorder";
  if (path.startsWith("/app/voice/settings")) return "Voice settings";
  if (/^\/app\/voice\/[^/]+/.test(path)) return "Voice detail";
  return NAV.find(item => item.active(path))?.name ?? "Workspace";
}

function NavLinks({
  path,
  onNavigate,
}: {
  path: string;
  onNavigate?: () => void;
}) {
  return (
    <>
      {NAV.map(({ name, icon: Icon, href, active }) => (
        <Link
          key={name}
          href={href}
          onClick={onNavigate}
          className={`nav-link ${active(path) ? "active" : ""}`}
          title={name}
          aria-current={active(path) ? "page" : undefined}
        >
          <Icon size={17} />
          <span className="nav-label">{name}</span>
        </Link>
      ))}
    </>
  );
}

function HeaderSearch() {
  const [, navigate] = useLocation();
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const query = useDebounced(text.trim(), 250);
  const results = useSearch(query);
  const wrapper = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (wrapper.current && !wrapper.current.contains(event.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const go = (href: string) => {
    setOpen(false);
    setText("");
    navigate(href);
  };
  const data = results.data;
  const groups = data
    ? [
        {
          label: "Participants",
          items: data.participants.map(item => ({
            key: item.id,
            title: item.name,
            meta: `NDIS ${item.ndis}${item.status === "Archived" ? " · Archived" : ""}`,
            href: `/app/clients/${item.id}`,
          })),
        },
        {
          label: "Service records",
          items: data.records.map(item => ({
            key: item.id,
            title: `${item.id} · ${item.type}`,
            meta: `${item.clientName} · ${prettyDate(item.date)} · ${item.status}`,
            href: `/app/records/${item.id}`,
          })),
        },
        {
          label: "Invoices",
          items: data.invoices.map(item => ({
            key: item.id,
            title: item.id,
            meta: `${item.clientName} · ${item.status}`,
            href: `/app/invoices/${item.id}`,
          })),
        },
        {
          label: "Voice notes",
          items: data.voiceNotes.map(item => ({
            key: item.id,
            title: item.title,
            meta: `${item.id} · ${item.clientName}`,
            href: `/app/voice/${item.id}`,
          })),
        },
        {
          label: "Documents",
          items: data.documents.map(item => ({
            key: item.id,
            title: item.title,
            meta:
              item.scope === "participant"
                ? "Client document"
                : "Organisation file",
            href: item.participantId
              ? `/app/clients/${item.participantId}/documents`
              : "/app/files",
          })),
        },
      ].filter(group => group.items.length)
    : [];
  const first = groups[0]?.items[0];
  return (
    <div className="relative hidden sm:block" ref={wrapper}>
      <Search
        size={15}
        className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8a979d]"
      />
      <input
        value={text}
        onChange={event => {
          setText(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={event => {
          if (event.key === "Escape") setOpen(false);
          if (event.key === "Enter" && text.trim())
            go(
              first
                ? first.href
                : `/app/clients?q=${encodeURIComponent(text.trim())}`
            );
        }}
        className="input h-[35px] w-[245px] pl-9 text-xs"
        placeholder="Search anything…"
        aria-label="Search the workspace"
      />
      {open && query.length >= 2 && (
        <div className="absolute left-0 top-10 z-50 w-[360px] overflow-hidden rounded-lg border border-[#e2e8e5] bg-white shadow-[0_14px_40px_rgba(20,40,45,.14)]">
          {results.isFetching && !data && (
            <div className="p-4 text-xs text-[#7b8990]">Searching…</div>
          )}
          {data && !groups.length && (
            <div className="p-4 text-xs text-[#7b8990]">
              No matches for “{query}”.
            </div>
          )}
          {groups.map(group => (
            <div
              key={group.label}
              className="border-b border-[#eef1f0] last:border-0"
            >
              <div className="px-4 pb-1 pt-3 text-[9px] font-bold uppercase tracking-[.12em] text-[#8a979d]">
                {group.label}
              </div>
              {group.items.map(item => (
                <button
                  key={item.key}
                  className="block w-full px-4 py-2 text-left hover:bg-[#f5f9f7]"
                  onClick={() => go(item.href)}
                >
                  <span className="block truncate text-xs font-semibold text-[#344854]">
                    {item.title}
                  </span>
                  <span className="block truncate text-[10px] text-[#87949a]">
                    {item.meta}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NotificationBell() {
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const notifications = useNotifications();
  const markRead = useMarkNotificationsRead();
  const wrapper = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (wrapper.current && !wrapper.current.contains(event.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const unread = notifications.data?.unread ?? 0;
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && unread) markRead.mutate();
  };
  const tone = {
    danger: "bg-[#fcebe9] text-[#a84540]",
    warning: "bg-[#fff3d9] text-[#9a6419]",
    info: "bg-[#e8f2fa] text-[#276696]",
  };
  return (
    <div className="relative" ref={wrapper}>
      <button
        className="icon-btn relative"
        title="Notifications"
        aria-label={`Notifications${unread ? ` (${unread} new)` : ""}`}
        aria-expanded={open}
        onClick={toggle}
      >
        <Bell size={17} />
        {unread > 0 && (
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-[#e18a65]" />
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-50 w-[340px] max-w-[calc(100vw-24px)] overflow-hidden rounded-lg border border-[#e2e8e5] bg-white shadow-[0_14px_40px_rgba(20,40,45,.14)]">
          <div className="border-b border-[#eef1f0] px-4 py-3 text-xs font-bold text-[#344854]">
            Notifications
          </div>
          <div className="max-h-[380px] overflow-y-auto">
            {notifications.isPending && (
              <div className="p-4 text-xs text-[#7b8990]">Loading…</div>
            )}
            {notifications.data && !notifications.data.items.length && (
              <EmptyState
                title="You're all caught up"
                text="Nothing needs your attention right now."
              />
            )}
            {notifications.data?.items.map(item => (
              <button
                key={item.key}
                className="flex w-full gap-3 border-b border-[#f1f4f3] px-4 py-3 text-left last:border-0 hover:bg-[#f7faf9]"
                onClick={() => {
                  setOpen(false);
                  navigate(item.link);
                }}
              >
                <span
                  className={`mt-0.5 h-fit rounded px-1.5 py-0.5 text-[9px] font-bold ${tone[item.severity]}`}
                >
                  {item.severity === "danger"
                    ? "!"
                    : item.severity === "warning"
                      ? "•"
                      : "i"}
                </span>
                <span className="min-w-0">
                  <span className="block text-xs font-semibold text-[#344854]">
                    {item.title}
                  </span>
                  <span className="block text-[11px] leading-4 text-[#687982]">
                    {item.message}
                  </span>
                  <span className="mt-1 block text-[10px] text-[#9aa5a8]">
                    {timeAgo(item.at)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function AppShell() {
  const [path] = useLocation();
  const { session, signOut } = useAuth();
  const [mobileMenu, setMobileMenu] = useState(false);
  const name = session?.user.name ?? "";
  const title = pageTitle(path);

  useEffect(() => {
    document.title = `${title} · Noble Community Support`;
    window.scrollTo({ top: 0 });
  }, [title, path]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="mb-8 flex items-center gap-3 px-2">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-[#2d6f70] text-white">
            <HandHeart size={19} />
          </div>
          <div className="brand-text">
            <div className="text-[13px] font-bold tracking-[.04em]">NOBLE</div>
            <div className="text-[10px] text-[#a9bbc0]">COMMUNITY SUPPORT</div>
          </div>
        </div>
        <div className="nav-section mb-2 px-3 text-[9px] font-bold uppercase tracking-[.15em] text-[#82989f]">
          Workspace
        </div>
        <nav className="flex flex-col gap-1" aria-label="Workspace">
          <NavLinks path={path} />
        </nav>
        <div className="mt-auto border-t border-white/10 pt-4">
          <Link
            href="/app/settings/profile"
            className="flex items-center gap-2 rounded-lg bg-white/5 p-2.5"
          >
            <Avatar name={name} small />
            <div className="side-footer-text min-w-0">
              <div className="truncate text-[11px] font-semibold">{name}</div>
              <div className="text-[9px] text-[#a6b7ba]">Admin</div>
            </div>
          </Link>
          <p className="side-footer-text px-2 pt-3 text-[9px] text-[#82989f]">
            {session?.workspace.name ?? "Noble Community Support"}
          </p>
        </div>
      </aside>

      <div className="main-area">
        <header className="topbar">
          <div className="flex min-w-0 items-center gap-3">
            <button
              className="icon-btn md:hidden"
              aria-label="Open menu"
              onClick={() => setMobileMenu(true)}
            >
              <Menu size={18} />
            </button>
            <HeaderSearch />
            <div className="hidden text-xs text-[#8b989e] md:block">
              {session?.workspace.name ?? "Noble Community Support"}{" "}
              <span className="mx-1">/</span>
              <span className="text-[#415560]">{title}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <NotificationBell />
            <div className="mx-1 h-7 w-px bg-[#e6ebe9]" />
            <span className="hidden text-right sm:block">
              <span className="block text-xs font-semibold text-[#344854]">
                {name}
              </span>
              <span className="block text-[10px] text-[#87949b]">Admin</span>
            </span>
            <Avatar name={name} />
            <button
              className="icon-btn"
              title="Sign out"
              aria-label="Sign out"
              onClick={() => void signOut()}
            >
              <LogOut size={16} />
            </button>
          </div>
        </header>
        <main className="content">
          <Suspense fallback={<LoadingBlock />}>
            <Switch>
              <Route path="/app" component={DashboardPage} />
              <Route path="/app/roster" component={RosterPage} />
              <Route path="/app/clients" component={ClientsPage} />
              <Route
                path="/app/clients/:id/:tab?"
                component={ClientProfilePage}
              />
              <Route path="/app/review" component={ReviewQueuePage} />
              <Route path="/app/records/new" component={RecordEditorPage} />
              <Route path="/app/records/:id" component={RecordEditorPage} />
              <Route path="/app/files" component={OrganisationFilesPage} />
              <Route path="/app/services" component={ServicesPage} />
              <Route path="/app/invoices" component={InvoicesPage} />
              <Route path="/app/invoices/new" component={InvoicesPage} />
              <Route path="/app/invoices/:id" component={InvoicePreviewPage} />
              <Route path="/app/staff/:section?" component={StaffPage} />
              <Route path="/app/live" component={LiveTrackingPage} />
              <Route
                path="/app/worker-reports/:section?"
                component={WorkerReportsPage}
              />
              <Route path="/app/reports" component={ReportsPage} />
              <Route path="/app/voice" component={VoiceInboxPage} />
              <Route path="/app/voice/record" component={RecorderPage} />
              <Route path="/app/voice/settings" component={VoiceInboxPage} />
              <Route path="/app/voice/:id" component={VoiceDetailPage} />
              <Route path="/app/settings/:section?" component={SettingsPage} />
              <Route>
                <EmptyState
                  title="Page not found"
                  text="This part of the workspace does not exist."
                  action={
                    <Link href="/app">
                      <Btn>Go to the dashboard</Btn>
                    </Link>
                  }
                />
              </Route>
            </Switch>
          </Suspense>
        </main>
      </div>

      <nav className="mobile-nav" aria-label="Quick navigation">
        {NAV.filter(item =>
          ["Dashboard", "Rostering", "Clients", "Organisation files"].includes(
            item.name
          )
        ).map(({ name: label, icon: Icon, href, active }) => (
          <Link
            key={label}
            href={href}
            className={active(path) ? "active" : ""}
            aria-current={active(path) ? "page" : undefined}
          >
            <Icon />
            <span>{label === "Organisation files" ? "Files" : label}</span>
          </Link>
        ))}
      </nav>

      {mobileMenu && (
        <div className="modal-backdrop" onClick={() => setMobileMenu(false)}>
          <div
            className="modal !max-w-[350px] p-4"
            onClick={event => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <b className="text-sm">Navigation</b>
              <button
                className="icon-btn"
                aria-label="Close menu"
                onClick={() => setMobileMenu(false)}
              >
                <X size={16} />
              </button>
            </div>
            <nav className="flex flex-col gap-1 [&_.nav-link]:text-[#344854]">
              <NavLinks path={path} onNavigate={() => setMobileMenu(false)} />
            </nav>
          </div>
        </div>
      )}
    </div>
  );
}
