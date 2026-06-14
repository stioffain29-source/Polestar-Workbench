import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
import CargoWatch from "./pages/CargoWatch";
import Shipping from "./pages/Shipping";
import Strikes from "./pages/Strikes";
import StrikesBackfill from "./pages/StrikesBackfill";
import Sources from "./pages/Sources";
import Countries from "./pages/Countries";
import CountryReport from "./pages/CountryReport";
import Reports from "./pages/Reports";
import ReportEditor from "./pages/ReportEditor";
import SpotReports from "./pages/SpotReports";
import SpotReportEditor from "./pages/SpotReportEditor";
import PublicationCalendar from "./pages/PublicationCalendar";

const queryClient = new QueryClient();

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
        <Route path="/topics/:topic" component={Topic} />
        <Route path="/strikes/backfill" component={StrikesBackfill} />
        <Route path="/strikes/:theatre" component={Strikes} />
        <Route path="/sources" component={Sources} />
        <Route path="/countries" component={Countries} />
        <Route path="/countries/:slug" component={CountryReport} />
        <Route path="/reports" component={Reports} />
        <Route path="/reports/:id" component={ReportEditor} />
        <Route path="/spot-reports" component={SpotReports} />
        <Route path="/spot-reports/:id" component={SpotReportEditor} />
        <Route path="/calendar" component={PublicationCalendar} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
