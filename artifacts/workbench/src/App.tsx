import { useState, useEffect } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuth } from "@workspace/replit-auth-web";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Incidents from "./pages/Incidents";
import MapPage from "./pages/Map";
import Timeline from "./pages/Timeline";
import Topic from "./pages/Topic";
import Protests from "./pages/Protests";
import Conflict from "./pages/Conflict";
import CargoWatch from "./pages/CargoWatch";
import Shipping from "./pages/Shipping";
import Strikes from "./pages/Strikes";
import StrikesBackfill from "./pages/StrikesBackfill";
import Sources from "./pages/Sources";
import GdeltStructured from "./pages/GdeltStructured";
import Countries from "./pages/Countries";
import CountryReport from "./pages/CountryReport";
import Reports from "./pages/Reports";
import ReportEditor from "./pages/ReportEditor";
import SpotReports from "./pages/SpotReports";
import SpotReportEditor from "./pages/SpotReportEditor";
import PublicationCalendar from "./pages/PublicationCalendar";
import Cards from "./pages/Cards";
import CardBuilder from "./pages/CardBuilder";
import BrandSettings from "./pages/BrandSettings";

const queryClient = new QueryClient();

const BRAND = {
  midnight: "#0B0B3D",
  electric: "#4655FF",
  polar: "#E2E2E2",
  dusk: "#303030",
};

function AuthScreen({
  title,
  message,
  actionLabel,
  onAction,
}: {
  title: string;
  message: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: BRAND.midnight,
        padding: "24px",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "420px",
          border: `1px solid ${BRAND.dusk}`,
          padding: "40px 32px",
          textAlign: "center",
        }}
      >
        <h1
          style={{
            fontFamily: "'Roboto Condensed', sans-serif",
            fontWeight: 700,
            fontSize: "26px",
            letterSpacing: "0.02em",
            color: BRAND.polar,
            margin: 0,
          }}
        >
          {title}
        </h1>
        <p
          style={{
            fontFamily: "'Roboto', sans-serif",
            fontSize: "15px",
            lineHeight: 1.5,
            color: BRAND.polar,
            opacity: 0.8,
            margin: "16px 0 28px",
          }}
        >
          {message}
        </p>
        <button
          type="button"
          onClick={onAction}
          style={{
            fontFamily: "'Roboto', sans-serif",
            fontSize: "15px",
            fontWeight: 500,
            color: "#FFFFFF",
            backgroundColor: BRAND.electric,
            border: "none",
            borderRadius: "4px",
            padding: "12px 28px",
            cursor: "pointer",
          }}
        >
          {actionLabel}
        </button>
      </div>
    </div>
  );
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const { isLoading, isAuthenticated, login, logout } = useAuth();
  const [access, setAccess] = useState<{ checked: boolean; allowed: boolean }>({
    checked: false,
    allowed: false,
  });

  useEffect(() => {
    if (!isAuthenticated) {
      setAccess({ checked: true, allowed: false });
      return;
    }
    let cancelled = false;
    fetch("/api/access", { credentials: "include" })
      .then((res) => res.json() as Promise<{ allowed: boolean }>)
      .then((data) => {
        if (!cancelled) setAccess({ checked: true, allowed: !!data.allowed });
      })
      .catch(() => {
        if (!cancelled) setAccess({ checked: true, allowed: false });
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  if (isLoading || (isAuthenticated && !access.checked)) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: BRAND.midnight,
          fontFamily: "'Roboto', sans-serif",
          color: BRAND.polar,
          opacity: 0.8,
        }}
      >
        Loading…
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <AuthScreen
        title="Polestar Advisory Workbench"
        message="This workbench is private. Sign in to continue."
        actionLabel="Log in"
        onAction={login}
      />
    );
  }

  if (!access.allowed) {
    return (
      <AuthScreen
        title="No access"
        message="You are signed in, but this account is not authorised to use the workbench."
        actionLabel="Log out"
        onAction={logout}
      />
    );
  }

  return <>{children}</>;
}

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/incidents" component={Incidents} />
        <Route path="/map" component={MapPage} />
        <Route path="/timeline" component={Timeline} />
        <Route path="/topics/cargo-watch" component={CargoWatch} />
        <Route path="/topics/shipping" component={Shipping} />
        <Route path="/topics/protests" component={Protests} />
        <Route path="/topics/conflict" component={Conflict} />
        <Route path="/topics/:topic" component={Topic} />
        <Route path="/strikes/backfill" component={StrikesBackfill} />
        <Route path="/strikes/:theatre" component={Strikes} />
        <Route path="/sources" component={Sources} />
        <Route path="/gdelt-structured" component={GdeltStructured} />
        <Route path="/countries" component={Countries} />
        <Route path="/countries/:slug" component={CountryReport} />
        <Route path="/reports" component={Reports} />
        <Route path="/reports/:id" component={ReportEditor} />
        <Route path="/spot-reports" component={SpotReports} />
        <Route path="/spot-reports/:id" component={SpotReportEditor} />
        <Route path="/calendar" component={PublicationCalendar} />
        <Route path="/card-builder" component={Cards} />
        <Route path="/card-builder/:id" component={CardBuilder} />
        <Route path="/card-settings" component={BrandSettings} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthGate>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
        </AuthGate>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
