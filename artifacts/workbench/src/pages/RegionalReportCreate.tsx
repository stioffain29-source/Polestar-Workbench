import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import {
  getGetDashboardOverviewQueryKey,
  getListReportsQueryKey,
  type RegionalReportJob,
  type RegionalReportJobInput,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getLoginUrl } from "@workspace/replit-auth-web";
import { ArrowLeft, Loader2, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { currentReportDate } from "@/lib/reportLifecycle";
import {
  regionalCreationInput,
  RegionalCreationError,
  waitForRegionalReport,
} from "@/lib/regionalReportCreation";

type RegionalTopic = RegionalReportJobInput["topic"];
type Stage = RegionalReportJob["stage"];

const STAGE_COPY: Record<Stage, { title: string; detail: string }> = {
  queued: {
    title: "Starting your report",
    detail: "Your creation request is saved. Preparing the regional source checks.",
  },
  collecting: {
    title: "Collecting regional sources",
    detail: "Checking the required security, political, regulatory, operational, energy, weather and cyber sources.",
  },
  building: {
    title: "Building the report",
    detail: "Selecting and validating the current seven-day evidence set.",
  },
  saving: {
    title: "Saving the report",
    detail: "Saving the complete, validated report before opening its editor.",
  },
  completed: {
    title: "Opening the report",
    detail: "Your report is saved. Opening its editor.",
  },
  failed: {
    title: "Report creation failed",
    detail: "The report could not be completed.",
  },
};

export default function RegionalReportCreate() {
  const [, params] = useRoute("/regional-reports/create/:topic");
  const topic = params?.topic === "apac_weekly" || params?.topic === "middle_east_weekly"
    ? params.topic as RegionalTopic
    : null;
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const runGeneration = useRef(0);
  const inputRef = useRef<RegionalReportJobInput | null>(null);
  const retryFailedRef = useRef(false);
  const [attempt, setAttempt] = useState(0);
  const [stage, setStage] = useState<Stage | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [error, setError] = useState<RegionalCreationError | null>(null);

  useEffect(() => {
    if (!topic) {
      setError(new RegionalCreationError("Unknown regional report type.", "report"));
      return;
    }
    const generation = ++runGeneration.current;
    const controller = new AbortController();
    const active = () => generation === runGeneration.current;

    void (async () => {
      try {
        setError(null);
        setReconnecting(false);
        if (!inputRef.current || inputRef.current.topic !== topic) {
          inputRef.current = regionalCreationInput(topic, currentReportDate());
          setStage(null);
        }
        const retryFailed = retryFailedRef.current;
        retryFailedRef.current = false;
        const reportId = await waitForRegionalReport(inputRef.current, {
          signal: controller.signal,
          retryFailed,
          onProgress: (job) => { if (active()) setStage(job.stage); },
          onReconnecting: (value) => { if (active()) setReconnecting(value); },
        });
        if (!active()) return;
        setStage("completed");
        // A failed background list refresh must never hide an already-saved
        // report or keep its editor from opening.
        void qc.invalidateQueries({ queryKey: getListReportsQueryKey(), refetchType: "none" });
        void qc.invalidateQueries({ queryKey: getGetDashboardOverviewQueryKey(), refetchType: "none" });
        setLocation(`/reports/${reportId}`);
      } catch (cause) {
        if (!active()) return;
        setError(
          cause instanceof RegionalCreationError
            ? cause
            : new RegionalCreationError("Report creation could not be started. Please try again.", "report"),
        );
      }
    })();

    return () => {
      runGeneration.current += 1;
      controller.abort();
    };
  }, [attempt, qc, setLocation, topic]);

  const resume = (retryFailed = false) => {
    retryFailedRef.current = retryFailed;
    setAttempt((value) => value + 1);
  };
  const copy = STAGE_COPY[stage ?? "queued"];
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-2xl items-center justify-center">
      <section className="w-full rounded-sm border border-border bg-card p-10 text-center">
        {error ? (
          <>
            <h1 className="font-serif text-2xl font-bold text-primary">
              {error.kind === "connection" ? "Connection interrupted" : error.kind === "session" ? "Sign in to continue" : error.kind === "access" ? "Owner access required" : "Report creation failed"}
            </h1>
            <p role="alert" className="mt-3 text-sm text-muted-foreground">{error.message}</p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Button variant="outline" asChild>
                <Link href="/regional-reports">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back to reports
                </Link>
              </Button>
              {topic && error.kind !== "session" && error.kind !== "access" && (
                <Button onClick={() => resume(error.kind === "report")}>
                  <RotateCw className="mr-2 h-4 w-4" />
                  {error.kind === "connection" ? "Reconnect" : "Try again"}
                </Button>
              )}
              {(error.kind === "session" || error.kind === "access") && (
                <Button asChild>
                  <a href={getLoginUrl()}>
                    {error.kind === "access" ? "Sign in with owner account" : "Sign in and resume"}
                  </a>
                </Button>
              )}
              {error.kind === "connection" && (
                <Button variant="outline" onClick={() => window.location.reload()}>
                  Reload page
                </Button>
              )}
            </div>
          </>
        ) : (
          <>
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-accent" />
            <div role="status" aria-live="polite">
              <h1 className="mt-5 font-serif text-2xl font-bold text-primary">
                {reconnecting ? "Reconnecting to your report" : copy.title}
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                {reconnecting ? "Status updates are temporarily unavailable. Checking the same request automatically; no duplicate report will be created." : copy.detail}
              </p>
              {reconnecting && stage && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Last confirmed step: {copy.title.toLowerCase()}.
                </p>
              )}
            </div>
            <p className="mt-5 text-xs uppercase tracking-widest text-muted-foreground">
              The editor will open automatically. Refreshing this page is safe.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Button variant="outline" asChild>
                <Link href="/regional-reports">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back to reports
                </Link>
              </Button>
              {reconnecting && (
                <>
                  <Button onClick={() => resume()}>
                    <RotateCw className="mr-2 h-4 w-4" />
                    Check now
                  </Button>
                  <Button variant="outline" onClick={() => window.location.reload()}>
                    Reload page
                  </Button>
                </>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}