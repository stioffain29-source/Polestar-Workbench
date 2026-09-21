export type RegionalReportWorkerTermination = "deadline" | "parent_disconnected";

type DisconnectProcess = {
  once(event: "disconnect", listener: () => void): unknown;
  removeListener(event: "disconnect", listener: () => void): unknown;
};

export function installRegionalReportWorkerLifetime(options: {
  timeoutMs: number;
  onTerminate: (reason: RegionalReportWorkerTermination) => void;
  processLike?: DisconnectProcess;
}): () => void {
  const processLike = options.processLike ?? process;
  let finished = false;
  const terminate = (reason: RegionalReportWorkerTermination) => {
    if (finished) return;
    finished = true;
    options.onTerminate(reason);
  };
  const onDisconnect = () => terminate("parent_disconnected");
  processLike.once("disconnect", onDisconnect);
  const deadline = setTimeout(() => terminate("deadline"), options.timeoutMs);
  deadline.unref?.();
  return () => {
    if (finished) return;
    finished = true;
    clearTimeout(deadline);
    processLike.removeListener("disconnect", onDisconnect);
  };
}