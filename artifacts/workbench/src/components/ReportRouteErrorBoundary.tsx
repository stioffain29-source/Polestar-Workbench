import { Component, type ErrorInfo, type ReactNode } from "react";

const BRAND = {
  midnight: "#0b0a3d",
  electric: "#465bff",
  dusk: "#363636",
};

interface Props {
  reportId: string;
  children: ReactNode;
}

interface State {
  failed: boolean;
}

export default class ReportRouteErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const log = (topic: string) => {
      console.error("Report route render failed", {
        reportId: this.props.reportId,
        topic,
        component:
          info.componentStack?.trim().split("\n")[0] ?? "ReportEditor",
        exception: error.message,
        stack: error.stack,
      });
    };

    fetch(`/api/reports/${this.props.reportId}`, { credentials: "include" })
      .then((response) => response.json())
      .then((report: { topic?: string | null }) => log(report.topic ?? "unknown"))
      .catch(() => log("unknown"));
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-2xl font-semibold" style={{ color: BRAND.midnight }}>
          This report could not be displayed
        </h1>
        <p className="mt-3 text-sm leading-6" style={{ color: BRAND.dusk }}>
          The report encountered invalid data while rendering. Navigation remains
          available; return to the reports list or retry this report.
        </p>
        <div className="mt-6 flex gap-3">
          <a
            href="../reports"
            className="rounded px-4 py-2 text-sm font-medium text-white"
            style={{ backgroundColor: BRAND.electric }}
          >
            Back to reports
          </a>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded border px-4 py-2 text-sm font-medium"
            style={{ borderColor: BRAND.dusk, color: BRAND.midnight }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }
}