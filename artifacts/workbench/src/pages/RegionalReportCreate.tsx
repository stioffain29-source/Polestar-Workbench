import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import {
  createReport,
  listIncidents,
  getGetDashboardOverviewQueryKey,
  getListReportsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { canonicalReportTitle } from "@/lib/reportNaming";
import { currentReportDate } from "@/lib/reportLifecycle";
import {
  buildRegionalCanonicalReport,
  regionalCanonicalReportFromHardNumbers,
  type RegionalCoverageManifest,
  validateRegionalCanonicalStructure,
} from "@/lib/regionalWeekly";

type RegionalTopic = "apac_weekly" | "middle_east_weekly";
type Stage = "collecting" | "building" | "saving";

const STAGE_COPY: Record<Stage, { title: string; detail: string }> = {
  collecting: {
    title: "Collecting regional sources",
    detail: "Checking the required security, political, regulatory, operational, energy, weather and cyber sources.",
  },
  building: {
    title: "Building the report",
    detail: "Selecting and validating the current seven-day evidence set.",
  },
  saving: {
    title: "Opening the report",
    detail: "Saving the validated report and opening its editor.",
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
  const [attempt, setAttempt] = useState(0);
  const [stage, setStage] = useState<Stage>("collecting");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!topic) {
      setError("Unknown regional report type.");
      return;
    }
    const generation = ++runGeneration.current;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 60_000);
    const active = () => generation === runGeneration.current;

    void (async () => {
      try {
        setError(null);
        setStage("collecting");
        const issueDate = currentReportDate();
        const coverageResponse = await fetch("/api/reports/regional-coverage", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ topic, issueDate }),
          signal: controller.signal,
        });
        if (!coverageResponse.ok) {
          const payload = await coverageResponse.json().catch(() => null) as { error?: string } | null;
          throw new Error(payload?.error || `Regional source collection failed (${coverageResponse.status}).`);
        }
        const coverage = await coverageResponse.json() as RegionalCoverageManifest;
        if (!active()) return;

        setStage("building");
        const incidents = await listIncidents({ days: 7 }, { signal: controller.signal });
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
        const regionalCanonicalReport = buildRegionalCanonicalReport(
          incidents as never[],
          issueDate,
          topic,
          [],
          coverage,
        );
        const canonicalErrors = validateRegionalCanonicalStructure(regionalCanonicalReport);
        if (canonicalErrors.length > 0) {
          throw new Error(canonicalErrors.join(" "));
        }
        if (!active()) return;

        setStage("saving");
        const report = await createReport(
          {
            title: canonicalReportTitle(topic),
            topic,
            issueDate,
            status: "draft",
            hardNumbers: { regionalCanonicalReport },
          } as never,
          { signal: controller.signal },
        );
        if (!regionalCanonicalReportFromHardNumbers(report.hardNumbers, topic, issueDate)) {
          throw new Error("The server did not persist the validated regional report.");
        }
        await Promise.all([
          qc.invalidateQueries({ queryKey: getListReportsQueryKey() }),
          qc.invalidateQueries({ queryKey: getGetDashboardOverviewQueryKey() }),
        ]);
        if (active()) setLocation(`/reports/${report.id}`);
      } catch (cause) {
        if (!active()) return;
        const timedOut = cause instanceof DOMException && cause.name === "AbortError";
        setError(
          timedOut
            ? "Report creation timed out. No report was created."
            : cause instanceof Error
              ? cause.message
              : "Report creation failed.",
        );
      } finally {
        window.clearTimeout(timeout);
      }
    })();

    return () => {
      runGeneration.current += 1;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [attempt, qc, setLocation, topic]);

  const copy = STAGE_COPY[stage];
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-2xl items-center justify-center">
      <section className="w-full rounded-sm border border-border bg-card p-10 text-center">
        {error ? (
          <>
            <h1 className="font-serif text-2xl font-bold text-primary">Report creation failed</h1>
            <p className="mt-3 text-sm text-muted-foreground">{error}</p>
            <div className="mt-6 flex justify-center gap-3">
              <Button variant="outline" asChild>
                <Link href="/regional-reports">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back to reports
                </Link>
              </Button>
              {topic && (
                <Button onClick={() => setAttempt((value) => value + 1)}>
                  <RotateCw className="mr-2 h-4 w-4" />
                  Try again
                </Button>
              )}
            </div>
          </>
        ) : (
          <>
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-accent" />
            <h1 className="mt-5 font-serif text-2xl font-bold text-primary">{copy.title}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{copy.detail}</p>
            <p className="mt-5 text-xs uppercase tracking-widest text-muted-foreground">
              This page will open the editor automatically.
            </p>
          </>
        )}
      </section>
    </div>
  );
}