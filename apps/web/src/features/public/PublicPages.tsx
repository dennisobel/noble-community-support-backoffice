import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  Check,
  CircleUserRound,
  FileText,
  HandHeart,
  KeyRound,
  LockKeyhole,
  Mail,
  ShieldCheck,
  Users,
  WalletCards,
} from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { Link, Redirect, useLocation, useSearch } from "wouter";
import type { SessionDTO } from "@shared/dto";
import { MESSAGES } from "@shared/messages";
import { MIN_PASSWORD_LENGTH } from "@shared/schemas/auth";
import { api, errorMessage, type ApiError } from "@/api/client";
import { useBootstrap, useMeta } from "@/api/hooks";
import { homeFor, useAuth } from "@/lib/auth";

function Brand() {
  return (
    <Link
      href="/"
      className="flex items-center gap-2.5 text-left"
      aria-label="Noble Community Support home"
    >
      <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#1d4550] text-[#d4eee6]">
        <HandHeart size={21} />
      </span>
      <span>
        <b className="block text-[13px] font-bold tracking-[.12em] text-[#1f3945]">
          NOBLE
        </b>
        <small className="block text-[9px] font-semibold tracking-[.16em] text-[#71858b]">
          COMMUNITY SUPPORT
        </small>
      </span>
    </Link>
  );
}

/** Signs in with the seeded demo Admin when DEMO_ENABLED is on (development only). */
function useDemoSignIn() {
  const { signedIn } = useAuth();
  const [, navigate] = useLocation();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    setError("");
    try {
      signedIn(await api.post<SessionDTO>("/auth/demo"));
      navigate("/app");
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };
  return { start, error, busy };
}

function useEntry() {
  const { session } = useAuth();
  const bootstrap = useBootstrap();
  const meta = useMeta();
  const setupRequired = bootstrap.data?.setupRequired ?? false;
  return {
    signedIn: Boolean(session),
    setupRequired,
    demoEnabled: meta.data?.demoEnabled ?? false,
    setupCodeRequired: bootstrap.data?.setupCodeRequired ?? false,
  };
}

function PasswordInput({
  value,
  onChange,
  placeholder,
  autoComplete,
  show,
  onToggle,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  autoComplete: string;
  show: boolean;
  onToggle?: () => void;
  id?: string;
}) {
  return (
    <div className="public-input-wrap">
      <LockKeyhole size={15} />
      <input
        id={id}
        type={show ? "text" : "password"}
        required
        autoComplete={autoComplete}
        placeholder={placeholder}
        value={value}
        onChange={event => onChange(event.target.value)}
      />
      {onToggle && (
        <button
          type="button"
          className="public-show-password"
          onClick={onToggle}
        >
          {show ? "Hide" : "Show"}
        </button>
      )}
    </div>
  );
}

function AuthLayout({
  eyebrow,
  title,
  intro,
  children,
}: {
  eyebrow: string;
  title: string;
  intro: string;
  children: ReactNode;
}) {
  const { demoEnabled } = useEntry();
  const demo = useDemoSignIn();
  return (
    <main className="public-site public-auth min-h-screen">
      <section className="public-auth-art" aria-label="Noble Community Support">
        <div className="public-auth-art-photo" />
        <div className="public-auth-art-shade" />
        <div className="public-auth-art-content">
          <Brand />
          <div className="mt-auto max-w-md pb-4">
            <div className="public-eyebrow text-white/75">
              ONE WORKSPACE · OFFICE AND FIELD
            </div>
            <h1 className="public-auth-heading serif">
              A thoughtful way to keep support in view.
            </h1>
            <p className="mt-4 max-w-sm text-sm leading-6 text-white/80">
              Participant profiles, support notes, rosters and budgets in one
              workspace — and a portal where support workers pick up their
              shifts and write them up.
            </p>
            {demoEnabled && (
              <button
                type="button"
                className="public-ghost-button mt-7"
                onClick={() => void demo.start()}
                disabled={demo.busy}
              >
                Explore the demo workspace <ArrowRight size={15} />
              </button>
            )}
          </div>
          <div className="text-[10px] text-white/60">
            Noble Community Support · Single-tenant workspace
          </div>
        </div>
      </section>
      <section className="public-auth-panel">
        <div className="public-auth-top">
          <Brand />
          <Link href="/" className="public-back">
            <ArrowLeft size={14} />
            Back to home
          </Link>
        </div>
        <div className="public-auth-form-wrap">
          <div className="public-eyebrow">{eyebrow}</div>
          <h2 className="public-auth-title serif">{title}</h2>
          <p className="mt-2 text-sm leading-6 text-[#718087]">{intro}</p>
          {children}
          {demo.error && (
            <div className="public-form-notice mt-4">{demo.error}</div>
          )}
        </div>
      </section>
    </main>
  );
}

export function LoginPage() {
  const { signedIn, session } = useAuth();
  const { setupRequired } = useEntry();
  const [, navigate] = useLocation();
  const params = new URLSearchParams(useSearch());
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [notice, setNotice] = useState(
    params.get("expired")
      ? "Your session ended. Sign in again to continue."
      : params.get("reset")
        ? "Your password was changed. Sign in with the new password."
        : ""
  );
  const [busy, setBusy] = useState(false);
  const next = params.get("next");
  /** Workers and Admins have different homes, so the landing spot follows the role. */
  const landing = (role?: string) => {
    const home = homeFor(role);
    return next && next.startsWith(home) ? next : home;
  };

  if (session) return <Redirect to={landing(session.user.role)} />;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    try {
      const result = await api.post<SessionDTO>("/auth/login", {
        email,
        password,
      });
      signedIn(result);
      navigate(landing(result.user.role));
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      eyebrow="SIGN IN"
      title="Welcome back."
      intro="Sign in to your Noble Community Support workspace."
    >
      <form className="mt-6 space-y-4" onSubmit={submit}>
        <label className="public-label">
          Work email
          <div className="public-input-wrap">
            <Mail size={15} />
            <input
              type="email"
              required
              autoComplete="email"
              placeholder="name@organisation.org.au"
              value={email}
              onChange={event => setEmail(event.target.value)}
            />
          </div>
        </label>
        <label className="public-label">
          Password
          <PasswordInput
            value={password}
            onChange={setPassword}
            placeholder="Enter your password"
            autoComplete="current-password"
            show={show}
            onToggle={() => setShow(value => !value)}
          />
        </label>
        <div className="flex justify-end">
          <Link href="/forgot-password" className="public-inline-link">
            Forgot password?
          </Link>
        </div>
        {notice && (
          <div className="public-form-notice" role="status">
            {notice}
          </div>
        )}
        <button
          type="submit"
          className="public-primary-button w-full"
          disabled={busy}
        >
          {busy ? "Signing in…" : "Sign in"}
          <ArrowRight size={15} />
        </button>
      </form>
      {setupRequired ? (
        <div className="public-auth-switch">
          Need to set up the workspace?{" "}
          <Link href="/signup" className="public-inline-link">
            Create the Admin account
          </Link>
        </div>
      ) : (
        <div className="public-auth-switch">
          Office team and no login yet?{" "}
          <Link href="/signup" className="public-inline-link">
            Request access
          </Link>
          <br />
          Support worker?{" "}
          <Link href="/staff-signup" className="public-inline-link">
            Request portal access
          </Link>
        </div>
      )}
      <p className="mt-6 text-center text-[10px] leading-4 text-[#8b979a]">
        Sessions use secure, http-only cookies. Five failed attempts lock the
        account for 15 minutes.
      </p>
    </AuthLayout>
  );
}

/**
 * Everyone after the first Admin asks for access here. They choose their own password, but the
 * account cannot sign in until an Admin approves it and decides the role and modules it gets.
 */
function RequestAccessForm() {
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    confirm: "",
    message: "",
  });
  const [show, setShow] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState("");
  const set = (key: keyof typeof form) => (value: string) =>
    setForm(current => ({ ...current, [key]: value }));

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (form.password.length < MIN_PASSWORD_LENGTH)
      return setNotice(MESSAGES.password(MIN_PASSWORD_LENGTH));
    if (form.password !== form.confirm)
      return setNotice(MESSAGES.passwordMismatch);
    setBusy(true);
    setNotice("");
    try {
      const result = await api.post<{ message: string }>("/auth/register", {
        name: form.name,
        email: form.email,
        password: form.password,
        message: form.message.trim() || undefined,
      });
      setSent(result.message);
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  if (sent)
    return (
      <AuthLayout eyebrow="REQUEST SENT" title="You're on the list." intro={sent}>
        <Link href="/login" className="public-primary-button mt-6 w-full">
          Back to sign in <ArrowRight size={15} />
        </Link>
      </AuthLayout>
    );

  return (
    <AuthLayout
      eyebrow="REQUEST ACCESS"
      title="Ask for access."
      intro="Create your login. An Admin approves it and chooses what you can open."
    >
      <div className="public-prototype-note mt-5">
        <ShieldCheck size={16} />
        <span>
          <b>Nothing is open until you are approved</b>
          <small>
            You can sign in as soon as an Admin has approved the request.
            Support workers should use{" "}
            <Link href="/staff-signup" className="public-inline-link">
              worker sign-up
            </Link>{" "}
            instead.
          </small>
        </span>
      </div>
      <form className="mt-6 space-y-4" onSubmit={submit}>
        <label className="public-label">
          Full name
          <div className="public-input-wrap">
            <CircleUserRound size={15} />
            <input
              required
              autoComplete="name"
              placeholder="Your name"
              value={form.name}
              onChange={event => set("name")(event.target.value)}
            />
          </div>
        </label>
        <label className="public-label">
          Work email
          <div className="public-input-wrap">
            <Mail size={15} />
            <input
              type="email"
              required
              autoComplete="email"
              placeholder="name@organisation.org.au"
              value={form.email}
              onChange={event => set("email")(event.target.value)}
            />
          </div>
        </label>
        <label className="public-label">
          Password
          <PasswordInput
            value={form.password}
            onChange={set("password")}
            placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
            autoComplete="new-password"
            show={show}
            onToggle={() => setShow(value => !value)}
          />
        </label>
        <label className="public-label">
          Confirm password
          <PasswordInput
            value={form.confirm}
            onChange={set("confirm")}
            placeholder="Enter password again"
            autoComplete="new-password"
            show={show}
          />
        </label>
        <label className="public-label">
          What will you use Noble for? (optional)
          <textarea
            className="public-textarea"
            rows={2}
            maxLength={500}
            placeholder="Your role, and what you need to see or do."
            value={form.message}
            onChange={event => set("message")(event.target.value)}
          />
        </label>
        {notice && (
          <div className="public-form-notice" role="status">
            {notice}
          </div>
        )}
        <button
          type="submit"
          className="public-primary-button w-full"
          disabled={busy}
        >
          {busy ? "Sending…" : "Request access"}
          <ArrowRight size={15} />
        </button>
      </form>
      <div className="public-auth-switch">
        Already approved?{" "}
        <Link href="/login" className="public-inline-link">
          Sign in
        </Link>
      </div>
    </AuthLayout>
  );
}

export function SignupPage() {
  const { signedIn, session } = useAuth();
  const { setupRequired, setupCodeRequired } = useEntry();
  const bootstrap = useBootstrap();
  const [, navigate] = useLocation();
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    confirm: "",
    setupCode: "",
  });
  const [show, setShow] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (value: string) =>
    setForm(current => ({ ...current, [key]: value }));

  if (session) return <Redirect to="/app" />;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (form.password.length < MIN_PASSWORD_LENGTH)
      return setNotice(MESSAGES.password(MIN_PASSWORD_LENGTH));
    if (form.password !== form.confirm)
      return setNotice(MESSAGES.passwordMismatch);
    setBusy(true);
    setNotice("");
    try {
      signedIn(
        await api.post<SessionDTO>("/auth/signup", {
          name: form.name,
          email: form.email,
          password: form.password,
          setupCode: form.setupCode || undefined,
        })
      );
      navigate("/app/settings/workspace");
    } catch (error) {
      setNotice(errorMessage(error));
      void bootstrap.refetch();
    } finally {
      setBusy(false);
    }
  };

  // The workspace already has its Admin: everyone else asks for access instead.
  if (bootstrap.data && !setupRequired) return <RequestAccessForm />;

  return (
    <AuthLayout
      eyebrow="FIRST ADMIN ACCOUNT"
      title="Set up your workspace."
      intro="Create the single administrator account for this Noble workspace."
    >
      <div className="public-prototype-note mt-5">
        <ShieldCheck size={16} />
        <span>
          <b>One-time setup</b>
          <small>
            This creates the first Admin account. After that, everyone else
            asks for access from this page and you approve them in Settings.
          </small>
        </span>
      </div>
      <form className="mt-6 space-y-4" onSubmit={submit}>
        <label className="public-label">
          Full name
          <div className="public-input-wrap">
            <CircleUserRound size={15} />
            <input
              required
              autoComplete="name"
              placeholder="Your name"
              value={form.name}
              onChange={event => set("name")(event.target.value)}
            />
          </div>
        </label>
        <label className="public-label">
          Work email
          <div className="public-input-wrap">
            <Mail size={15} />
            <input
              type="email"
              required
              autoComplete="email"
              placeholder="name@organisation.org.au"
              value={form.email}
              onChange={event => set("email")(event.target.value)}
            />
          </div>
        </label>
        <label className="public-label">
          Password
          <PasswordInput
            value={form.password}
            onChange={set("password")}
            placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
            autoComplete="new-password"
            show={show}
            onToggle={() => setShow(value => !value)}
          />
        </label>
        <label className="public-label">
          Confirm password
          <PasswordInput
            value={form.confirm}
            onChange={set("confirm")}
            placeholder="Enter password again"
            autoComplete="new-password"
            show={show}
          />
        </label>
        {setupCodeRequired && (
          <label className="public-label">
            Setup code
            <div className="public-input-wrap">
              <KeyRound size={15} />
              <input
                required
                autoComplete="one-time-code"
                placeholder="Provided by whoever deployed Noble"
                value={form.setupCode}
                onChange={event => set("setupCode")(event.target.value)}
              />
            </div>
          </label>
        )}
        {notice && (
          <div className="public-form-notice" role="status">
            {notice}
          </div>
        )}
        <button
          type="submit"
          className="public-primary-button w-full"
          disabled={busy}
        >
          {busy ? "Creating account…" : "Create Admin account"}
          <ArrowRight size={15} />
        </button>
      </form>
      <div className="public-auth-switch">
        Already have an account?{" "}
        <Link href="/login" className="public-inline-link">
          Sign in
        </Link>
      </div>
    </AuthLayout>
  );
}

/**
 * Support workers ask for portal access here. Nothing is granted on the spot: the
 * request lands in the back office as an application, and an Admin approves it and
 * sends the invite that sets a password.
 */
export function StaffSignupPage() {
  const { session } = useAuth();
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    position: "",
    suburb: "",
    experience: "",
    message: "",
  });
  const [done, setDone] = useState<"Pending" | "Have account" | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (value: string) =>
    setForm(current => ({ ...current, [key]: value }));

  if (session) return <Redirect to={homeFor(session.user.role)} />;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    try {
      const result = await api.post<{
        status: "Pending" | "Have account";
        message: string;
      }>("/auth/staff-signup", form);
      setDone(result.status);
      setNotice(result.message);
    } catch (error) {
      setNotice(errorMessage(error));
      // A duplicate request is not a failure worth re-typing the form for.
      if ((error as ApiError)?.code === "STAFF_APPLICATION_EXISTS")
        setDone("Pending");
    } finally {
      setBusy(false);
    }
  };

  if (done)
    return (
      <AuthLayout
        eyebrow="REQUEST SENT"
        title={
          done === "Pending"
            ? "Thanks — that's with us."
            : "You already have access."
        }
        intro={notice}
      >
        <div className="mt-6 space-y-4">
          {done === "Pending" && (
            <ol className="space-y-3 text-[12px] leading-5 text-[#54636b]">
              {[
                "A coordinator checks your request against the team list.",
                "Once approved you get an email with a link to set your password.",
                "Sign in and finish your profile — next of kin, and your checks and certificates.",
              ].map((step, index) => (
                <li key={step} className="flex gap-3">
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#e4f0ec] text-[10px] font-bold text-[#147f79]">
                    {index + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          )}
          <Link href="/login" className="public-primary-button w-full">
            Go to sign in
            <ArrowRight size={15} />
          </Link>
        </div>
      </AuthLayout>
    );

  return (
    <AuthLayout
      eyebrow="SUPPORT WORKERS"
      title="Request portal access."
      intro="Tell us who you are. A coordinator approves your request, then you'll get a link to set your password."
    >
      <form className="mt-6 space-y-4" onSubmit={submit}>
        <label className="public-label">
          Full name
          <div className="public-input-wrap">
            <CircleUserRound size={15} />
            <input
              required
              autoComplete="name"
              placeholder="As it appears on your ID"
              value={form.name}
              onChange={event => set("name")(event.target.value)}
            />
          </div>
        </label>
        <label className="public-label">
          Email
          <div className="public-input-wrap">
            <Mail size={15} />
            <input
              type="email"
              required
              autoComplete="email"
              placeholder="you@example.org"
              value={form.email}
              onChange={event => set("email")(event.target.value)}
            />
          </div>
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="public-label">
            Phone
            <div className="public-input-wrap">
              <input
                autoComplete="tel"
                placeholder="04xx xxx xxx"
                value={form.phone}
                onChange={event => set("phone")(event.target.value)}
              />
            </div>
          </label>
          <label className="public-label">
            Suburb
            <div className="public-input-wrap">
              <input
                autoComplete="address-level2"
                placeholder="Where you're based"
                value={form.suburb}
                onChange={event => set("suburb")(event.target.value)}
              />
            </div>
          </label>
        </div>
        <label className="public-label">
          Role you're applying for
          <div className="public-input-wrap">
            <BadgeCheck size={15} />
            <input
              placeholder="Support Worker"
              value={form.position}
              onChange={event => set("position")(event.target.value)}
            />
          </div>
        </label>
        <label className="public-label">
          Relevant experience
          <textarea
            className="public-textarea"
            rows={3}
            placeholder="Disability or community support you've done, and any certificates you hold."
            value={form.experience}
            onChange={event => set("experience")(event.target.value)}
          />
        </label>
        <label className="public-label">
          Anything else
          <textarea
            className="public-textarea"
            rows={2}
            placeholder="Availability, or anyone here who knows you."
            value={form.message}
            onChange={event => set("message")(event.target.value)}
          />
        </label>
        {notice && (
          <div className="public-form-notice" role="status">
            {notice}
          </div>
        )}
        <button
          type="submit"
          className="public-primary-button w-full"
          disabled={busy}
        >
          {busy ? "Sending…" : "Send request"}
          <ArrowRight size={15} />
        </button>
        <p className="text-center text-[10px] leading-4 text-[#8b979a]">
          Requesting access does not create an account or give you any client
          information until a coordinator approves it.
        </p>
      </form>
      <div className="public-auth-switch">
        Already have a login?{" "}
        <Link href="/login" className="public-inline-link">
          Sign in
        </Link>
      </div>
    </AuthLayout>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    try {
      await api.post("/auth/forgot-password", { email });
      setSent(true);
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthLayout
      eyebrow="PASSWORD RESET"
      title="Forgot your password?"
      intro="Enter your work email and we'll send a link to choose a new password."
    >
      {sent ? (
        <div className="mt-6 space-y-4">
          <div className="public-prototype-note">
            <Mail size={16} />
            <span>
              <b>Check your email</b>
              <small>
                If an account exists for {email}, a reset link is on its way. It
                expires in 30 minutes and works once.
              </small>
            </span>
          </div>
          <Link href="/login" className="public-secondary-button w-full">
            Back to sign in
          </Link>
        </div>
      ) : (
        <form className="mt-6 space-y-4" onSubmit={submit}>
          <label className="public-label">
            Work email
            <div className="public-input-wrap">
              <Mail size={15} />
              <input
                type="email"
                required
                autoComplete="email"
                placeholder="name@organisation.org.au"
                value={email}
                onChange={event => setEmail(event.target.value)}
              />
            </div>
          </label>
          {notice && <div className="public-form-notice">{notice}</div>}
          <button
            type="submit"
            className="public-primary-button w-full"
            disabled={busy}
          >
            {busy ? "Sending…" : "Send reset link"}
            <ArrowRight size={15} />
          </button>
          <div className="public-auth-switch">
            Remembered it?{" "}
            <Link href="/login" className="public-inline-link">
              Sign in
            </Link>
          </div>
        </form>
      )}
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const [, navigate] = useLocation();
  const token = new URLSearchParams(useSearch()).get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [notice, setNotice] = useState(
    token ? "" : "This reset link is incomplete. Request a new one."
  );
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (password.length < MIN_PASSWORD_LENGTH)
      return setNotice(MESSAGES.password(MIN_PASSWORD_LENGTH));
    if (password !== confirm) return setNotice(MESSAGES.passwordMismatch);
    setBusy(true);
    setNotice("");
    try {
      await api.post("/auth/reset-password", { token, password });
      navigate("/login?reset=1");
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthLayout
      eyebrow="PASSWORD RESET"
      title="Choose a new password."
      intro="Resetting your password signs you out of every device."
    >
      <form className="mt-6 space-y-4" onSubmit={submit}>
        <label className="public-label">
          New password
          <PasswordInput
            value={password}
            onChange={setPassword}
            placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
            autoComplete="new-password"
            show={show}
            onToggle={() => setShow(value => !value)}
          />
        </label>
        <label className="public-label">
          Confirm new password
          <PasswordInput
            value={confirm}
            onChange={setConfirm}
            placeholder="Enter password again"
            autoComplete="new-password"
            show={show}
          />
        </label>
        {notice && <div className="public-form-notice">{notice}</div>}
        <button
          type="submit"
          className="public-primary-button w-full"
          disabled={busy || !token}
        >
          {busy ? "Saving…" : "Save new password"}
          <ArrowRight size={15} />
        </button>
        <div className="public-auth-switch">
          <Link href="/forgot-password" className="public-inline-link">
            Request a new link
          </Link>
        </div>
      </form>
    </AuthLayout>
  );
}

export function LandingPage() {
  const { signedIn, setupRequired, demoEnabled } = useEntry();
  const [, navigate] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const demo = useDemoSignIn();
  const primary = signedIn
    ? { label: "Open the workspace", action: () => navigate("/app") }
    : demoEnabled
      ? { label: "Explore the demo workspace", action: () => void demo.start() }
      : setupRequired
        ? { label: "Set up the workspace", action: () => navigate("/signup") }
        : {
            label: "Sign in to the workspace",
            action: () => navigate("/login"),
          };

  return (
    <main className="public-site min-h-screen">
      <header className="public-header">
        <Brand />
        <nav
          className={`public-nav-links ${mobileMenuOpen ? "is-open" : ""}`}
          aria-label="Main navigation"
        >
          <a href="#approach" onClick={() => setMobileMenuOpen(false)}>
            Our approach
          </a>
          <a href="#workspace" onClick={() => setMobileMenuOpen(false)}>
            The workspace
          </a>
          <a href="#contact" onClick={() => setMobileMenuOpen(false)}>
            Contact
          </a>
        </nav>
        <div className="flex items-center gap-2">
          {signedIn ? (
            <Link href="/app" className="public-header-cta">
              Open workspace <ArrowRight size={14} />
            </Link>
          ) : (
            <>
              <Link
                href="/login"
                className="public-text-button hidden sm:inline-flex"
              >
                Admin sign in
              </Link>
              {setupRequired && (
                <Link href="/signup" className="public-header-cta">
                  Create Admin account <ArrowRight size={14} />
                </Link>
              )}
            </>
          )}
          <button
            type="button"
            className="public-menu-button"
            aria-label="Toggle navigation"
            aria-expanded={mobileMenuOpen}
            onClick={() => setMobileMenuOpen(value => !value)}
          >
            <span />
            <span />
          </button>
        </div>
      </header>
      <section className="public-hero">
        <div className="public-hero-copy">
          <div className="public-eyebrow">
            <span className="public-eyebrow-dot" />
            PERSON-LED SUPPORT, CLEARLY CONNECTED
          </div>
          <h1 className="public-display serif">
            Support that makes room for <em>more life.</em>
          </h1>
          <p className="public-hero-lede">
            A considered home for the people, plans and everyday details behind
            great community support.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <button
              type="button"
              className="public-primary-button"
              onClick={primary.action}
              disabled={demo.busy}
            >
              {primary.label} <ArrowRight size={15} />
            </button>
            {!signedIn && (
              <Link href="/login" className="public-secondary-button">
                Admin sign in
              </Link>
            )}
          </div>
          {demo.error && (
            <div className="public-form-notice mt-4 max-w-md">{demo.error}</div>
          )}
          <div className="public-hero-proof">
            <span>
              <Check size={14} />
              One tenant workspace
            </span>
            <span>
              <Check size={14} />
              One administrator role
            </span>
          </div>
        </div>
        <div className="public-hero-visual">
          <img
            src="/hero.svg"
            alt="Illustration of two people walking together along a path through a green park"
          />
          <div className="public-image-caption">
            <span className="public-caption-icon">
              <HandHeart size={15} />
            </span>
            <span>
              <b>Built around the person</b>
              <small>Support that follows their goals, choices and pace.</small>
            </span>
          </div>
          <div className="public-image-stamp">
            <span className="public-stamp-dot" />
            Care, connected
          </div>
        </div>
      </section>
      <section id="approach" className="public-value-strip">
        <div>
          <span className="public-value-number">01</span>
          <span>
            <b>Know the person</b>
            <small>Profiles, plans, consent and goals together.</small>
          </span>
        </div>
        <div>
          <span className="public-value-number">02</span>
          <span>
            <b>See the support</b>
            <small>
              Progress notes, incidents and travel records in context.
            </small>
          </span>
        </div>
        <div>
          <span className="public-value-number">03</span>
          <span>
            <b>Plan with clarity</b>
            <small>Flexible rosters and participant budgets at a glance.</small>
          </span>
        </div>
      </section>
      <section id="workspace" className="public-workspace-section">
        <div className="public-section-heading">
          <div className="public-eyebrow">A CLEARER DAILY VIEW</div>
          <h2 className="serif">
            The details belong
            <br />
            in one place.
          </h2>
          <p>
            From the first conversation to the next support shift, keep the
            important context close at hand.
          </p>
        </div>
        <div className="public-feature-grid">
          <article className="public-feature-card public-feature-card-main">
            <div className="public-feature-icon">
              <Users size={18} />
            </div>
            <div className="public-feature-kicker">PARTICIPANT FILES</div>
            <h3 className="serif">A folder for the whole story.</h3>
            <p>
              Participant profiles, service agreements, goals, progress notes,
              incidents, kilometres and correspondence—organised in a familiar,
              year-and-month structure.
            </p>
            <div className="public-folder-list">
              <span>
                <FileText size={13} />
                Support plans & goals
              </span>
              <span>
                <CalendarDays size={13} />
                Progress notes by month
              </span>
              <span>
                <BadgeCheck size={13} />
                Consent & agreements
              </span>
            </div>
          </article>
          <article className="public-feature-card">
            <div className="public-feature-icon public-feature-icon-blue">
              <CalendarDays size={18} />
            </div>
            <div className="public-feature-kicker">FLEXIBLE ROSTERING</div>
            <h3 className="serif">The right people, in rhythm.</h3>
            <p>
              Plan one-to-one and shared supports with a clear view of staff,
              participants and time.
            </p>
          </article>
          <article className="public-feature-card">
            <div className="public-feature-icon public-feature-icon-sand">
              <WalletCards size={18} />
            </div>
            <div className="public-feature-kicker">BUDGET VISIBILITY</div>
            <h3 className="serif">Understand what is planned.</h3>
            <p>
              See plan allocations alongside approved support, items under
              review and future commitments.
            </p>
          </article>
        </div>
      </section>
      <section className="public-admin-band">
        <div className="public-admin-mark">
          <LockKeyhole size={18} />
        </div>
        <div>
          <div className="public-eyebrow text-white/70">
            SIMPLE ACCESS MODEL
          </div>
          <h2 className="serif">One tenant. One Admin role.</h2>
          <p>
            A single administrator account has access to the complete
            workspace—no separate staff, reviewer or manager roles to navigate.
          </p>
        </div>
        <button
          type="button"
          className="public-ghost-button"
          onClick={() =>
            navigate(signedIn ? "/app" : setupRequired ? "/signup" : "/login")
          }
        >
          {signedIn
            ? "Open the workspace"
            : setupRequired
              ? "Create the Admin account"
              : "Admin sign in"}{" "}
          <ArrowRight size={15} />
        </button>
      </section>
      <footer id="contact" className="public-footer">
        <div className="flex flex-wrap items-center justify-between gap-5">
          <div>
            <Brand />
            <p className="mt-3 max-w-sm text-[11px] leading-5 text-[#7b898e]">
              A single workspace for connected community support in Adelaide,
              South Australia.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-5">
            <Link href="/login" className="public-footer-link">
              Admin sign in
            </Link>
            {setupRequired && (
              <Link href="/signup" className="public-footer-link">
                Create account
              </Link>
            )}
          </div>
        </div>
        <div className="public-footer-bottom">
          <span>© {new Date().getFullYear()} Noble Community Support</span>
          <span>Secure, single-tenant workspace</span>
        </div>
      </footer>
    </main>
  );
}
