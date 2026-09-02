/**
 * Resolve the Resend API key for validation summary emails.
 *
 * Precedence:
 *   1. process.env.RESEND_API_KEY (Replit Configurations / Secrets / shell)
 *   2. never a hardcoded fallback
 */
export function resolveResendApiKey(): string | undefined {
  const key = process.env.RESEND_API_KEY?.trim();
  return key || undefined;
}

export function resolveValidationEmailRecipient(): string {
  return (process.env.VALIDATION_SUMMARY_TO ?? "tommyto0925@gmail.com").trim();
}

export function resolveValidationEmailSender(): string {
  return (
    process.env.VALIDATION_SUMMARY_FROM ??
    "Polestar Validation <onboarding@resend.dev>"
  ).trim();
}
