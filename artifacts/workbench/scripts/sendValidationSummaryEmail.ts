/**
 * Send the Phase 4.1 validation summary by email after runPhase41 finishes.
 *
 * Delivery backends (first match wins):
 *   1. Resend — set RESEND_API_KEY (+ optional VALIDATION_SUMMARY_FROM)
 *   2. SMTP — set SMTP_USER + SMTP_PASS (+ optional SMTP_HOST / SMTP_PORT)
 *
 * Recipient defaults to tommyto0925@gmail.com; override with VALIDATION_SUMMARY_TO.
 *
 * Usage:
 *   VALIDATION_STATUS=PASSED npx tsx scripts/sendValidationSummaryEmail.ts /path/to/summary.txt
 */
import { readFileSync } from "node:fs";
import nodemailer from "nodemailer";

const DEFAULT_TO = "tommyto0925@gmail.com";
const DEFAULT_FROM = "Polestar Validation <onboarding@resend.dev>";

function recipient(): string {
  return (process.env.VALIDATION_SUMMARY_TO ?? DEFAULT_TO).trim();
}

function sender(): string {
  return (process.env.VALIDATION_SUMMARY_FROM ?? DEFAULT_FROM).trim();
}

function subject(status: string): string {
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  return `Polestar QA validation — ${status} (${stamp} UTC)`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function htmlBody(text: string): string {
  return `<!DOCTYPE html><html><body style="font-family:Consolas,Monaco,monospace;font-size:13px;line-height:1.45;color:#1a1a1a"><pre style="white-space:pre-wrap;margin:0">${escapeHtml(text)}</pre></body></html>`;
}

async function sendViaResend(
  to: string,
  from: string,
  subj: string,
  body: string,
): Promise<boolean> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) return false;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: subj,
      text: body,
      html: htmlBody(body),
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Resend API ${res.status}: ${detail}`);
  }
  return true;
}

async function sendViaSmtp(to: string, from: string, subj: string, body: string): Promise<boolean> {
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  if (!user || !pass) return false;

  const host = process.env.SMTP_HOST?.trim() || "smtp.gmail.com";
  const port = Number(process.env.SMTP_PORT ?? "587");
  const secure = process.env.SMTP_SECURE === "true" || port === 465;

  const transport = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });

  await transport.sendMail({
    from,
    to,
    subject: subj,
    text: body,
    html: htmlBody(body),
  });
  return true;
}

async function main(): Promise<void> {
  const summaryPath = process.argv[2];
  if (!summaryPath) {
    console.error("Usage: sendValidationSummaryEmail.ts <summary-file>");
    process.exit(2);
  }

  const body = readFileSync(summaryPath, "utf8");
  const status = (process.env.VALIDATION_STATUS ?? "UNKNOWN").trim().toUpperCase();
  const to = recipient();
  const from = sender();
  const subj = subject(status);

  if (await sendViaResend(to, from, subj, body)) {
    console.log(`Validation summary emailed to ${to} via Resend.`);
    return;
  }

  if (await sendViaSmtp(to, from, subj, body)) {
    console.log(`Validation summary emailed to ${to} via SMTP.`);
    return;
  }

  console.warn(
    "Validation summary was NOT emailed — configure RESEND_API_KEY or SMTP_USER/SMTP_PASS.",
  );
  console.warn(`Intended recipient: ${to}`);
  console.warn("--- summary (console fallback) ---");
  console.warn(body);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
