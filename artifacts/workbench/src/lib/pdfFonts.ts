// Embed Roboto into every jsPDF instance before any text is drawn. jsPDF's
// default is Helvetica; per Polestar brand spec Roboto is mandatory across
// all reports, so we ship the TTF bytes through Vite, fetch them once at
// runtime, base64-encode, and register Regular / Medium / Bold / Italic via
// addFileToVFS + addFont.
import type jsPDF from "jspdf";
import RobotoRegularUrl from "@expo-google-fonts/roboto/400Regular/Roboto_400Regular.ttf?url";
import RobotoMediumUrl from "@expo-google-fonts/roboto/500Medium/Roboto_500Medium.ttf?url";
import RobotoBoldUrl from "@expo-google-fonts/roboto/700Bold/Roboto_700Bold.ttf?url";
import RobotoItalicUrl from "@expo-google-fonts/roboto/400Regular_Italic/Roboto_400Regular_Italic.ttf?url";

interface RobotoBytes {
  regular: string;
  medium: string;
  bold: string;
  italic: string;
}

let cache: RobotoBytes | null = null;
let loading: Promise<RobotoBytes> | null = null;

async function fetchAsBase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`pdfFonts: failed to fetch ${url} (${res.status})`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  // btoa needs a binary string; build it in chunks to avoid call-stack limits
  // on large TTF buffers (~170 KB each).
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    bin += String.fromCharCode.apply(
      null,
      Array.from(buf.subarray(i, i + CHUNK)),
    );
  }
  return btoa(bin);
}

async function loadRobotoBytes(): Promise<RobotoBytes> {
  if (cache) return cache;
  if (loading) return loading;
  loading = (async () => {
    const [regular, medium, bold, italic] = await Promise.all([
      fetchAsBase64(RobotoRegularUrl),
      fetchAsBase64(RobotoMediumUrl),
      fetchAsBase64(RobotoBoldUrl),
      fetchAsBase64(RobotoItalicUrl),
    ]);
    cache = { regular, medium, bold, italic };
    return cache;
  })();
  return loading;
}

const registered = new WeakSet<jsPDF>();

/**
 * Register Roboto on the given jsPDF instance. Idempotent per instance.
 * Must be awaited before any text is drawn, otherwise jsPDF will silently
 * fall back to Helvetica.
 */
export async function ensureRobotoLoaded(pdf: jsPDF): Promise<void> {
  if (registered.has(pdf)) return;
  const fonts = await loadRobotoBytes();
  pdf.addFileToVFS("Roboto-Regular.ttf", fonts.regular);
  pdf.addFont("Roboto-Regular.ttf", "Roboto", "normal", 400);
  pdf.addFileToVFS("Roboto-Medium.ttf", fonts.medium);
  pdf.addFont("Roboto-Medium.ttf", "Roboto", "normal", 500);
  pdf.addFileToVFS("Roboto-Bold.ttf", fonts.bold);
  pdf.addFont("Roboto-Bold.ttf", "Roboto", "bold", 700);
  pdf.addFileToVFS("Roboto-Italic.ttf", fonts.italic);
  pdf.addFont("Roboto-Italic.ttf", "Roboto", "italic", 400);
  registered.add(pdf);
  // Default every fresh instance to Roboto Regular so any forgotten call
  // site still renders in the right family rather than Helvetica.
  pdf.setFont("Roboto", "normal", 400);
}

export type RobotoWeight = "regular" | "medium" | "bold" | "italic";

/**
 * Switch the active jsPDF font to a Roboto weight. Use this everywhere
 * instead of `pdf.setFont("helvetica", ...)`.
 */
export function setRoboto(pdf: jsPDF, weight: RobotoWeight = "regular"): void {
  switch (weight) {
    case "regular":
      pdf.setFont("Roboto", "normal", 400);
      return;
    case "medium":
      pdf.setFont("Roboto", "normal", 500);
      return;
    case "bold":
      pdf.setFont("Roboto", "bold", 700);
      return;
    case "italic":
      pdf.setFont("Roboto", "italic", 400);
      return;
  }
}
