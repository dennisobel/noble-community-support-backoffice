import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
import { Route, Switch } from "wouter";
import { ApiError } from "@/api/client";
import AppShell from "@/components/app/AppShell";
import ErrorBoundary from "@/components/ErrorBoundary";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/contexts/ThemeContext";
import {
  ForgotPasswordPage,
  LandingPage,
  LoginPage,
  ResetPasswordPage,
  SignupPage,
  StaffSignupPage,
} from "@/features/public/PublicPages";
import {
  AuthProvider,
  FullScreenLoader,
  RequireAuth,
  RequireRole,
} from "@/lib/auth";
import { NotifyProvider } from "@/lib/notify";
import NotFound from "@/pages/NotFound";

const StaffShell = lazy(() => import("@/features/staff-portal/StaffShell"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      // Retry transient failures only; 4xx responses are final.
      retry: (failureCount, error) =>
        failureCount < 2 &&
        (!(error instanceof ApiError) ||
          error.status === 0 ||
          error.status >= 500),
    },
  },
});

function Router() {
  return (
    <Switch>
      <Route path="/" component={LandingPage} />
      <Route path="/login" component={LoginPage} />
      <Route path="/signup" component={SignupPage} />
      <Route path="/staff-signup" component={StaffSignupPage} />
      <Route path="/forgot-password" component={ForgotPasswordPage} />
      <Route path="/reset-password" component={ResetPasswordPage} />
      <Route path={/^\/app(?:\/.*)?$/}>
        <RequireAuth>
          <RequireRole role="admin">
            <AppShell />
          </RequireRole>
        </RequireAuth>
      </Route>
      <Route path={/^\/staff(?:\/.*)?$/}>
        <RequireAuth>
          <RequireRole role="staff">
            <Suspense
              fallback={<FullScreenLoader label="Loading your portal…" />}
            >
              <StaffShell />
            </Suspense>
          </RequireRole>
        </RequireAuth>
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <QueryClientProvider client={queryClient}>
          <NotifyProvider>
            <AuthProvider>
              <TooltipProvider>
                <Router />
              </TooltipProvider>
            </AuthProvider>
          </NotifyProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
