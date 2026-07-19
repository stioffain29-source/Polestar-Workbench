import { useEffect, useMemo, useRef, useState } from "react";
import { useRoute, useLocation } from "wouter";
import {
  useGetSpecialReport,
  useCreateSpecialReport,
  useUpdateSpecialReport,
  useDeleteSpecialReport,
  useAppendSpecialReportExport,
  useListIncidents,
  getGetSpecialReportQueryKey,
  getListSpecialReportsQueryKey,
  type SpecialReport,
  type Incident,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  FileDown,
  ImagePlus,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { SEVERITY_LEVELS, CONFIDENCE_LEVELS } from "@/lib/topics";
import { exportElementToPdf, slugifyForFilename } from "@/lib/exportPdf";
import {
  checkSpecialReportQuality,
  resolveSpecialReportBlocks,
  specialReportSaveErrorMessage,
  SPECIAL_STATUSES,
  type QualityResult,
  type SpecialReportBlock,
} from "@/lib/specialReport";
import { COVER_LIBRARY, resolveCoverUrl } from "@/lib/coverImages";
// Photo/cover ceilings and the block-list validator come from the SHARED module
// the api-server route also uses, so the client pre-save guard and server
// validation can never drift.
import {
  MAX_PHOTOS,
  MAX_PHOTO_DATAURL_BYTES,
  MAX_PHOTOS_TOTAL_BYTES,
  MAX_COVER_DATAURL_BYTES,
  SPECIAL_REPORT_BLOCK_TYPES,
  validateSpecialReportBlocks,
  validateCoverDataUrl,
} from "@workspace/db/spot-report-limits";
import SpecialReportPreview from "@/components/SpecialReportPreview";
import { useToast } from "@/hooks/use-toast";

interface MapPointForm {
  lat: string;
  lng: string;
  label: string;
  severity: string;
}

interface ChartPointForm {
  label: string;
  value: string;
  color: string;
}

interface ChartForm {
  title: string;
  unit: string;
  points: ChartPointForm[];
}

// The free-form body is an ordered list of blocks the analyst composes in any
// order. Each block carries only the fields its type uses; unused fields stay
// blank. Chart and image DATA live INLINE on the block so a block is
// self-contained. map/incidents blocks are singleton references that render
// from the report-level coordinates / linked incidents at draw time.
type SpecialReportBlockType = (typeof SPECIAL_REPORT_BLOCK_TYPES)[number];

interface BlockForm {
  id: string;
  type: SpecialReportBlockType;
  text: string;
  body: string;
  dataUrl: string;
  caption: string;
  chart: ChartForm;
}

const BLOCK_LABELS: Record<SpecialReportBlockType, string> = {
  heading: "Heading",
  text: "Paragraph",
  bullets: "Bullet list",
  chart: "Chart",
  image: "Image",
  map: "Incident map",
  incidents: "Reference incidents",
};

function makeBlockId(): string {
  return `b-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function emptyChartForm(): ChartForm {
  return { title: "", unit: "", points: [{ label: "", value: "", color: "" }] };
}

function newBlock(type: SpecialReportBlockType): BlockForm {
  return {
    id: makeBlockId(),
    type,
    text: "",
    body: "",
    dataUrl: "",
    caption: "",
    chart: emptyChartForm(),
  };
}

function newImageBlock(dataUrl: string): BlockForm {
  return { ...newBlock("image"), dataUrl };
}

/** Rehydrate a saved chart into the editable string-based form shape. */
function chartFormFromChart(
  c: NonNullable<SpecialReportBlock["chart"]>,
): ChartForm {
  const points = (c.points ?? []).map((p) => ({
    label: p.label ?? "",
    value: p.value != null ? String(p.value) : "",
    color: p.color ?? "",
  }));
  return {
    title: c.title ?? "",
    unit: c.unit ?? "",
    points: points.length > 0 ? points : [{ label: "", value: "", color: "" }],
  };
}

/** Rehydrate a resolved block (saved OR synthesised from a legacy row) into the
 * editable form shape, so opening any report loads its body as editable blocks. */
function blockFormFromBlock(b: SpecialReportBlock): BlockForm {
  return {
    id: b.id || makeBlockId(),
    type: b.type as SpecialReportBlockType,
    text: b.text ?? "",
    body: b.body ?? "",
    dataUrl: b.dataUrl ?? "",
    caption: b.caption ?? "",
    chart: b.chart ? chartFormFromChart(b.chart) : emptyChartForm(),
  };
}

/** Coerce an editable chart into the stored shape, or null when it has no
 * labelled points (an empty chart renders nothing and is not worth storing). */
function toApiChart(
  c: ChartForm,
): NonNullable<SpecialReportBlock["chart"]> | null {
  const points = c.points
    .map((p) => {
      const n = parseFloat(p.value);
      return {
        label: p.label.trim(),
        value: Number.isFinite(n) ? n : 0,
        color: p.color.trim(),
      };
    })
    .filter((p) => p.label);
  if (points.length === 0) return null;
  const title = c.title.trim();
  const unit = c.unit.trim();
  return {
    ...(title ? { title } : {}),
    ...(unit ? { unit } : {}),
    points: points.map((p) => ({
      label: p.label,
      value: p.value,
      ...(p.color ? { color: p.color } : {}),
    })),
  };
}

/** Coerce the ordered editable blocks into the stored block list. Order is
 * preserved verbatim; each block keeps only the fields its type uses. Empty
 * blocks are kept (the renderer skips them) so editing continuity is preserved
 * and the on-screen preview stays byte-identical to the export. */
function toApiBlocks(blocks: BlockForm[]): SpecialReportBlock[] {
  return blocks.map((b) => {
    const base: SpecialReportBlock = { id: b.id, type: b.type };
    if (b.type === "heading") {
      const t = b.text.trim();
      if (t) base.text = t;
    } else if (b.type === "text" || b.type === "bullets") {
      base.body = b.body;
    } else if (b.type === "image") {
      if (b.dataUrl) base.dataUrl = b.dataUrl;
      const cap = b.caption.trim();
      if (cap) base.caption = cap;
    } else if (b.type === "chart") {
      const chart = toApiChart(b.chart);
      if (chart) base.chart = chart;
    }
    return base;
  });
}

interface FormState {
  title: string;
  status: string;
  reportDate: string;
  incidentDate: string;
  country: string;
  province: string;
  city: string;
  latitude: string;
  longitude: string;
  category: string;
  severity: string;
  analystNotes: string;
  confidenceLevel: string;
  internalSourceNotes: string;
  showSourcesInExport: boolean;
  linkedIncidentIds: number[];
  affectedRadiusKm: string;
  mapPoints: MapPointForm[];
  coverImageKey: string;
  coverImageDataUrl: string;
  blocks: BlockForm[];
  createdBy: string;
}

function toLocalInput(iso?: string | null): string {
  if (!iso) return "";
  try {
    return format(new Date(iso), "yyyy-MM-dd'T'HH:mm");
  } catch {
    return "";
  }
}

/** Parse a local "yyyy-MM-dd'T'HH:mm" value to ISO, or null if blank/invalid. */
function toIsoOrNull(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Normalise free-typed digits into 24-hour HH:mm (auto-colon, range-clamped). */
function formatTime24(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 4);
  if (digits.length === 0) return "";
  let hh = digits.slice(0, 2);
  if (hh.length === 2 && Number(hh) > 23) hh = "23";
  if (digits.length <= 2) return hh;
  let mm = digits.slice(2);
  if (mm.length === 2 && Number(mm) > 59) mm = "59";
  return `${hh}:${mm}`;
}

/**
 * 24-hour date + time control (see the Spot Report editor for the rationale):
 * the native datetime-local input renders am/pm in 12-hour locales and cannot be
 * forced to 24h, so the time is a plain 24-hour HH:mm text field. Emits/consumes
 * the same "yyyy-MM-dd'T'HH:mm" form string.
 */
function DateTime24({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const [datePart, timePart] = value.includes("T")
    ? (value.split("T") as [string, string])
    : [value, ""];
  const commit = (d: string, t: string) => {
    if (!d) {
      onChange("");
      return;
    }
    onChange(t ? `${d}T${t}` : `${d}T00:00`);
  };
  return (
    <div className="flex gap-2">
      <Input
        type="date"
        value={datePart}
        onChange={(e) => commit(e.target.value, timePart)}
        className="rounded-sm"
      />
      <Input
        type="text"
        inputMode="numeric"
        placeholder="HH:MM"
        aria-label="Time (24-hour)"
        maxLength={5}
        value={timePart}
        onChange={(e) => commit(datePart, formatTime24(e.target.value))}
        className="rounded-sm w-24 tabular-nums"
      />
    </div>
  );
}

/**
 * Read an image file and return a resized JPEG data URL (longest edge <= maxDim,
 * flattened onto white so transparent PNGs don't rasterise black), keeping the
 * stored payload small enough to live in the report jsonb and render straight
 * into the DOM-rasterised PDF. Shared shape with the Spot Report editor.
 */
async function fileToImageDataUrl(
  file: File,
  maxDim = 1600,
  quality = 0.82,
): Promise<string> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error("Could not read image"));
      im.src = objectUrl;
    });
    const longest = Math.max(img.width, img.height) || 1;
    const scale = Math.min(1, maxDim / longest);
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas not supported");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", quality);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function emptyForm(): FormState {
  return {
    title: "",
    status: "draft",
    reportDate: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
    incidentDate: "",
    country: "",
    province: "",
    city: "",
    latitude: "",
    longitude: "",
    category: "",
    severity: "",
    analystNotes: "",
    confidenceLevel: "",
    internalSourceNotes: "",
    showSourcesInExport: false,
    linkedIncidentIds: [],
    affectedRadiusKm: "",
    mapPoints: [],
    coverImageKey: "",
    coverImageDataUrl: "",
    blocks: [],
    createdBy: "",
  };
}

// ---------------------------------------------------------------------------
// Local draft autosave. A special report lives only in React state until Save
// POSTs it; we mirror the live form into localStorage on every change and
// recover it on load, so a draft survives navigation, a crash, a closed tab, or
// a failed save. Its own key prefix keeps it isolated from Spot Report drafts.
// ---------------------------------------------------------------------------
const DRAFT_PREFIX = "polestar:special-report-draft:v2:";

function draftKey(idOrNew: number | string): string {
  return `${DRAFT_PREFIX}${idOrNew}`;
}

function loadDraft(key: string): FormState | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { form?: Partial<FormState> } | null;
    if (!parsed?.form || typeof parsed.form !== "object") return null;
    // Merge over a fresh default so a draft written by an older schema (missing
    // fields) can never crash isFormEmpty/setForm; coerce the collections that
    // the render path indexes into.
    const merged: FormState = { ...emptyForm(), ...parsed.form };
    merged.linkedIncidentIds = Array.isArray(merged.linkedIncidentIds)
      ? merged.linkedIncidentIds
      : [];
    merged.mapPoints = Array.isArray(merged.mapPoints) ? merged.mapPoints : [];
    merged.blocks = Array.isArray(merged.blocks) ? merged.blocks : [];
    return merged;
  } catch {
    return null;
  }
}

function saveDraft(key: string, form: FormState): void {
  const write = (f: FormState) =>
    localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), form: f }));
  try {
    write(form);
  } catch {
    // localStorage quota (image/cover data URLs are large) — retry without the
    // heavy image payloads so the analyst's typed prose still survives. Drop
    // image blocks entirely rather than emptying them: a dataUrl-less image
    // block would fail validateSpecialReportBlocks on restore.
    try {
      write({
        ...form,
        blocks: form.blocks.filter((b) => b.type !== "image"),
        coverImageDataUrl: "",
      });
    } catch {
      // Best-effort only; never let autosave throw into the render path.
    }
  }
}

function clearDraft(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

/** True when the analyst has typed nothing worth preserving (ignores the
 * auto-stamped report date and the default status / empty collections). */
function isFormEmpty(f: FormState): boolean {
  const text = [
    f.title,
    f.incidentDate,
    f.country,
    f.province,
    f.city,
    f.latitude,
    f.longitude,
    f.category,
    f.severity,
    f.analystNotes,
    f.confidenceLevel,
    f.internalSourceNotes,
    f.affectedRadiusKm,
    f.coverImageKey,
    f.coverImageDataUrl,
    f.createdBy,
  ].some((v) => v.trim() !== "");
  return (
    !text &&
    f.linkedIncidentIds.length === 0 &&
    f.mapPoints.length === 0 &&
    f.blocks.length === 0
  );
}

function formFromReport(r: SpecialReport): FormState {
  return {
    title: r.title ?? "",
    status: r.status ?? "draft",
    reportDate: toLocalInput(r.reportDate) || format(new Date(), "yyyy-MM-dd'T'HH:mm"),
    incidentDate: toLocalInput(r.incidentDate),
    country: r.country ?? "",
    province: r.province ?? "",
    city: r.city ?? "",
    latitude: r.latitude != null ? String(r.latitude) : "",
    longitude: r.longitude != null ? String(r.longitude) : "",
    category: r.category ?? "",
    severity: r.severity ?? "",
    analystNotes: r.analystNotes ?? "",
    confidenceLevel: r.confidenceLevel ?? "",
    internalSourceNotes: r.internalSourceNotes ?? "",
    showSourcesInExport: r.showSourcesInExport ?? false,
    linkedIncidentIds: r.linkedIncidentIds ?? [],
    affectedRadiusKm: r.affectedRadiusKm != null ? String(r.affectedRadiusKm) : "",
    mapPoints: (r.mapPoints ?? []).map((m) => ({
      lat: m.lat != null ? String(m.lat) : "",
      lng: m.lng != null ? String(m.lng) : "",
      label: m.label ?? "",
      severity: m.severity ?? "",
    })),
    coverImageKey: r.coverImageKey ?? "",
    coverImageDataUrl: r.coverImageDataUrl ?? "",
    // Body loads as editable blocks: saved blocks win, else a legacy row is
    // synthesised into equivalent blocks so opening any report is editable and
    // re-saving migrates it to the block model.
    blocks: resolveSpecialReportBlocks(r).map(blockFormFromBlock),
    createdBy: r.createdBy ?? "",
  };
}

export default function SpecialReportEditor() {
  const [, params] = useRoute("/special-reports/:id");
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();

  const idParam = params?.id;
  const isNew = !idParam || idParam === "new";
  const id = isNew ? null : parseInt(idParam, 10);

  const { data: report, isLoading } = useGetSpecialReport(id ?? 0, {
    query: { enabled: !isNew && id != null },
  } as never);
  const { data: allIncidents = [] } = useListIncidents({});

  const create = useCreateSpecialReport();
  const update = useUpdateSpecialReport();
  const del = useDeleteSpecialReport();
  const appendExport = useAppendSpecialReportExport();

  const [form, setForm] = useState<FormState>(emptyForm);
  const [quality, setQuality] = useState<{
    open: boolean;
    doExportAfter: boolean;
    result: QualityResult;
  }>({ open: false, doExportAfter: false, result: { errors: [], warnings: [] } });
  const [incidentSearch, setIncidentSearch] = useState("");

  const previewRef = useRef<HTMLDivElement | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const coverInputRef = useRef<HTMLInputElement | null>(null);
  const initId = useRef<number | null>(null);
  const restoredNew = useRef(false);
  // Serialised snapshot of the "clean" form (server copy, recovered draft, or
  // empty). Autosave persists only when the live form DIFFERS from this.
  const baselineRef = useRef<string>("");
  // `ready` flips true only AFTER the restore decision is committed, so the
  // initial (still-empty) render can neither clear nor overwrite a draft.
  const [ready, setReady] = useState(false);
  const [recovered, setRecovered] = useState(false);

  const newDraftKey = useMemo(() => draftKey("new"), []);
  const currentDraftKey = isNew ? newDraftKey : id != null ? draftKey(id) : null;

  // Load saved report into the form once (re-runs if the id changes). If an
  // unsaved LOCAL draft that DIFFERS from the server copy exists, recover it in
  // preference so edits made before a lost save are not silently discarded.
  useEffect(() => {
    if (report && initId.current !== report.id) {
      const serverForm = formFromReport(report);
      const draft = loadDraft(draftKey(report.id));
      if (
        draft &&
        !isFormEmpty(draft) &&
        JSON.stringify(draft) !== JSON.stringify(serverForm)
      ) {
        setForm(draft);
        baselineRef.current = JSON.stringify(draft);
        setRecovered(true);
        toast({
          title: "Recovered unsaved changes",
          description: "Showing edits that were never saved. Press Save to keep them.",
        });
      } else {
        if (draft) clearDraft(draftKey(report.id));
        setForm(serverForm);
        baselineRef.current = JSON.stringify(serverForm);
      }
      initId.current = report.id;
      setReady(true);
    }
  }, [report, toast]);

  // Recover a NEW (unsaved) draft on mount.
  useEffect(() => {
    if (!isNew || restoredNew.current) return;
    const draft = loadDraft(newDraftKey);
    if (draft && !isFormEmpty(draft)) {
      setForm(draft);
      baselineRef.current = JSON.stringify(draft);
      setRecovered(true);
      toast({
        title: "Recovered your unsaved draft",
        description: "Press Save to store it permanently.",
      });
    } else {
      baselineRef.current = JSON.stringify(emptyForm());
    }
    restoredNew.current = true;
    setReady(true);
  }, [isNew, newDraftKey, toast]);

  // Mirror the live form into localStorage once the restore decision is
  // committed. Clearing on empty is synchronous; saving is debounced and skipped
  // when the form still matches the clean baseline.
  useEffect(() => {
    if (!ready || !currentDraftKey) return;
    if (isFormEmpty(form)) {
      clearDraft(currentDraftKey);
      return;
    }
    if (JSON.stringify(form) === baselineRef.current) return;
    const t = setTimeout(() => saveDraft(currentDraftKey, form), 400);
    return () => clearTimeout(t);
  }, [form, currentDraftKey, ready]);

  const linkedIncidents = useMemo(
    () => allIncidents.filter((i) => form.linkedIncidentIds.includes(i.id)),
    [allIncidents, form.linkedIncidentIds],
  );

  const previewReport = useMemo<SpecialReport>(() => {
    const num = (v: string) => {
      const n = parseFloat(v);
      return Number.isFinite(n) ? n : null;
    };
    return {
      id: report?.id ?? 0,
      title: form.title,
      status: form.status as SpecialReport["status"],
      reportDate: toIsoOrNull(form.reportDate) ?? new Date().toISOString(),
      incidentDate: toIsoOrNull(form.incidentDate),
      country: form.country || null,
      province: form.province || null,
      city: form.city || null,
      latitude: num(form.latitude),
      longitude: num(form.longitude),
      category: form.category || null,
      severity: (form.severity || null) as SpecialReport["severity"],
      // The fixed narrative columns and top-level photo/chart arrays are legacy;
      // the free-form body is the `blocks` list. The renderer reads blocks and
      // skips empty ones, so preview stays byte-identical to the export.
      bluf: null,
      incidentDetails: null,
      currentSituation: null,
      operationalImpact: null,
      assessment: null,
      outlook: null,
      recommendedActions: null,
      analystNotes: form.analystNotes || null,
      confidenceLevel: (form.confidenceLevel || null) as SpecialReport["confidenceLevel"],
      internalSourceNotes: form.internalSourceNotes || null,
      showSourcesInExport: form.showSourcesInExport,
      linkedIncidentIds: form.linkedIncidentIds,
      mapEnabled: form.blocks.some((b) => b.type === "map"),
      affectedRadiusKm: num(form.affectedRadiusKm),
      mapPoints: form.mapPoints
        .map((m) => ({
          lat: num(m.lat),
          lng: num(m.lng),
          label: m.label.trim(),
          severity: m.severity,
        }))
        .filter((m) => m.lat !== null && m.lng !== null)
        .map((m) => ({
          lat: m.lat as number,
          lng: m.lng as number,
          ...(m.label ? { label: m.label } : {}),
          ...(m.severity ? { severity: m.severity } : {}),
        })),
      photos: [],
      coverImageKey: form.coverImageKey || null,
      coverImageDataUrl: form.coverImageDataUrl || null,
      charts: [],
      blocks: toApiBlocks(form.blocks),
      createdBy: form.createdBy || null,
      exportHistory: report?.exportHistory ?? [],
      createdAt: report?.createdAt ?? new Date().toISOString(),
      lastEditedAt: report?.lastEditedAt ?? new Date().toISOString(),
    };
  }, [form, report]);

  // Image budget across all image blocks — mirrors the shared photo ceilings so
  // the pre-save guard and server validation stay in lockstep.
  const imageUsage = useMemo(() => {
    const imgs = form.blocks.filter((b) => b.type === "image" && b.dataUrl);
    const count = imgs.length;
    const bytes = imgs.reduce((n, b) => n + b.dataUrl.length, 0);
    const countRatio = MAX_PHOTOS > 0 ? count / MAX_PHOTOS : 0;
    const byteRatio =
      MAX_PHOTOS_TOTAL_BYTES > 0 ? bytes / MAX_PHOTOS_TOTAL_BYTES : 0;
    const ratio = Math.max(countRatio, byteRatio);
    const over = count > MAX_PHOTOS || bytes > MAX_PHOTOS_TOTAL_BYTES;
    return { count, bytes, ratio, over, warn: !over && ratio >= 0.8 };
  }, [form.blocks]);

  const coverPreviewUrl = useMemo(
    () =>
      resolveCoverUrl({
        coverImageKey: form.coverImageKey || null,
        coverImageDataUrl: form.coverImageDataUrl || null,
      }),
    [form.coverImageKey, form.coverImageDataUrl],
  );

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  // --- Cover -----------------------------------------------------------------
  function pickCoverKey(key: string) {
    // A library pick clears any custom upload so the choice is unambiguous.
    setForm((f) => ({ ...f, coverImageKey: key, coverImageDataUrl: "" }));
  }

  function clearCover() {
    setForm((f) => ({ ...f, coverImageKey: "", coverImageDataUrl: "" }));
  }

  async function uploadCover(files: FileList | null) {
    const file = files && files[0];
    if (!file || !file.type.startsWith("image/")) return;
    try {
      const dataUrl = await fileToImageDataUrl(file, 2000, 0.85);
      const err = validateCoverDataUrl(dataUrl);
      if (err) {
        toast({ title: "Cover image too large", description: err, variant: "destructive" });
        return;
      }
      // An upload wins over a library key; clear the key to keep the state clean.
      setForm((f) => ({ ...f, coverImageDataUrl: dataUrl, coverImageKey: "" }));
    } catch {
      toast({
        title: "Could not add cover",
        description: "The selected file could not be read as an image.",
        variant: "destructive",
      });
    }
  }

  // --- Map points ------------------------------------------------------------
  function addMapPoint() {
    setForm((f) => ({
      ...f,
      mapPoints: [...f.mapPoints, { lat: "", lng: "", label: "", severity: "" }],
    }));
  }
  function updateMapPoint(idx: number, key: keyof MapPointForm, value: string) {
    setForm((f) => ({
      ...f,
      mapPoints: f.mapPoints.map((p, i) => (i === idx ? { ...p, [key]: value } : p)),
    }));
  }
  function removeMapPoint(idx: number) {
    setForm((f) => ({ ...f, mapPoints: f.mapPoints.filter((_, i) => i !== idx) }));
  }

  // --- Body blocks -----------------------------------------------------------
  function addBlock(type: SpecialReportBlockType) {
    setForm((f) => ({ ...f, blocks: [...f.blocks, newBlock(type)] }));
  }
  function removeBlock(id: string) {
    setForm((f) => ({ ...f, blocks: f.blocks.filter((b) => b.id !== id) }));
  }
  function moveBlock(id: string, dir: -1 | 1) {
    setForm((f) => {
      const idx = f.blocks.findIndex((b) => b.id === id);
      if (idx < 0) return f;
      const j = idx + dir;
      if (j < 0 || j >= f.blocks.length) return f;
      const next = [...f.blocks];
      [next[idx], next[j]] = [next[j], next[idx]];
      return { ...f, blocks: next };
    });
  }
  function updateBlock(id: string, patch: Partial<BlockForm>) {
    setForm((f) => ({
      ...f,
      blocks: f.blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)),
    }));
  }
  function updateBlockChart(id: string, key: "title" | "unit", value: string) {
    setForm((f) => ({
      ...f,
      blocks: f.blocks.map((b) =>
        b.id === id ? { ...b, chart: { ...b.chart, [key]: value } } : b,
      ),
    }));
  }
  function addBlockChartPoint(id: string) {
    setForm((f) => ({
      ...f,
      blocks: f.blocks.map((b) =>
        b.id === id
          ? {
              ...b,
              chart: {
                ...b.chart,
                points: [...b.chart.points, { label: "", value: "", color: "" }],
              },
            }
          : b,
      ),
    }));
  }
  function updateBlockChartPoint(
    id: string,
    pi: number,
    key: keyof ChartPointForm,
    value: string,
  ) {
    setForm((f) => ({
      ...f,
      blocks: f.blocks.map((b) =>
        b.id === id
          ? {
              ...b,
              chart: {
                ...b.chart,
                points: b.chart.points.map((p, j) =>
                  j === pi ? { ...p, [key]: value } : p,
                ),
              },
            }
          : b,
      ),
    }));
  }
  function removeBlockChartPoint(id: string, pi: number) {
    setForm((f) => ({
      ...f,
      blocks: f.blocks.map((b) =>
        b.id === id
          ? { ...b, chart: { ...b.chart, points: b.chart.points.filter((_, j) => j !== pi) } }
          : b,
      ),
    }));
  }
  async function addImageBlocks(files: FileList | null) {
    const list = files
      ? Array.from(files).filter((f) => f.type.startsWith("image/"))
      : [];
    if (list.length === 0) return;
    const existing = form.blocks.filter((b) => b.type === "image" && b.dataUrl).length;
    if (existing + list.length > MAX_PHOTOS) {
      toast({
        title: "Too many images",
        description: `A special report can hold at most ${MAX_PHOTOS} images.`,
        variant: "destructive",
      });
      return;
    }
    try {
      const dataUrls = await Promise.all(list.map((f) => fileToImageDataUrl(f)));
      const existingBytes = form.blocks
        .filter((b) => b.type === "image")
        .reduce((n, b) => n + b.dataUrl.length, 0);
      const addedBytes = dataUrls.reduce((n, d) => n + d.length, 0);
      if (
        dataUrls.some((d) => d.length > MAX_PHOTO_DATAURL_BYTES) ||
        existingBytes + addedBytes > MAX_PHOTOS_TOTAL_BYTES
      ) {
        toast({
          title: "Image too large",
          description: "Please use smaller images or remove some.",
          variant: "destructive",
        });
        return;
      }
      setForm((f) => ({
        ...f,
        blocks: [...f.blocks, ...dataUrls.map((d) => newImageBlock(d))],
      }));
    } catch {
      toast({
        title: "Could not add image",
        description: "One of the selected files could not be read as an image.",
        variant: "destructive",
      });
    }
  }

  // Renders the type-specific editor body for one block. The surrounding card
  // (label + move/delete controls) is drawn by the caller; this fills the body.
  function renderBlockEditor(b: BlockForm) {
    const t = b.type as SpecialReportBlockType;
    if (t === "heading") {
      return (
        <Input
          value={b.text}
          onChange={(e) => updateBlock(b.id, { text: e.target.value })}
          placeholder="Heading text"
          className="rounded-sm"
        />
      );
    }
    if (t === "text") {
      return (
        <Textarea
          value={b.body}
          onChange={(e) => updateBlock(b.id, { body: e.target.value })}
          rows={4}
          placeholder="Paragraph text"
          className="rounded-sm"
        />
      );
    }
    if (t === "bullets") {
      return (
        <Textarea
          value={b.body}
          onChange={(e) => updateBlock(b.id, { body: e.target.value })}
          rows={4}
          placeholder="One bullet per line"
          className="rounded-sm"
        />
      );
    }
    if (t === "image") {
      return (
        <div className="flex gap-3 items-start">
          {b.dataUrl ? (
            <img
              src={b.dataUrl}
              alt=""
              className="w-24 h-24 object-cover rounded-sm border border-border shrink-0"
            />
          ) : (
            <div className="w-24 h-24 rounded-sm border border-dashed border-border shrink-0" />
          )}
          <Input
            value={b.caption}
            onChange={(e) => updateBlock(b.id, { caption: e.target.value })}
            placeholder="Caption (optional)"
            className="rounded-sm flex-1"
          />
        </div>
      );
    }
    if (t === "chart") {
      return (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Input
              value={b.chart.title}
              onChange={(e) => updateBlockChart(b.id, "title", e.target.value)}
              placeholder="Chart title"
              className="rounded-sm"
            />
            <Input
              value={b.chart.unit}
              onChange={(e) => updateBlockChart(b.id, "unit", e.target.value)}
              placeholder="Unit (optional)"
              className="rounded-sm"
            />
          </div>
          <div className="space-y-2">
            {b.chart.points.map((p, pi) => (
              <div key={pi} className="grid grid-cols-[1.6fr_1fr_auto_auto] gap-2 items-center">
                <Input
                  value={p.label}
                  onChange={(e) => updateBlockChartPoint(b.id, pi, "label", e.target.value)}
                  placeholder="Label"
                  className="rounded-sm"
                />
                <Input
                  value={p.value}
                  onChange={(e) => updateBlockChartPoint(b.id, pi, "value", e.target.value)}
                  placeholder="Value"
                  inputMode="decimal"
                  className="rounded-sm"
                />
                <input
                  type="color"
                  value={/^#[0-9a-fA-F]{6}$/.test(p.color) ? p.color : "#465bff"}
                  onChange={(e) => updateBlockChartPoint(b.id, pi, "color", e.target.value)}
                  aria-label="Bar colour"
                  className="h-9 w-10 rounded-sm border border-border bg-transparent p-0.5 cursor-pointer"
                />
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => removeBlockChartPoint(b.id, pi)}
                  className="rounded-sm text-muted-foreground hover:text-destructive h-9 px-2"
                  aria-label="Remove point"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>
          <Button type="button" variant="outline" onClick={() => addBlockChartPoint(b.id)} className="rounded-sm h-8">
            Add point
          </Button>
        </div>
      );
    }
    if (t === "map") {
      return (
        <p className="text-xs text-muted-foreground">
          Renders the incident map here — the primary location, any linked
          incidents, and the extra map points. Set coordinates in the Location
          and Additional Map Points cards.
        </p>
      );
    }
    return (
      <p className="text-xs text-muted-foreground">
        Renders a reference table of the linked incidents here. Choose incidents
        in the Linked Incidents card.
      </p>
    );
  }

  function buildData(forCreate: boolean): Record<string, unknown> {
    const num = (v: string) => {
      const n = parseFloat(v);
      return Number.isFinite(n) ? n : null;
    };
    const out: Record<string, unknown> = {
      title: form.title.trim(),
      status: form.status,
      reportDate: toIsoOrNull(form.reportDate) ?? new Date().toISOString(),
      showSourcesInExport: form.showSourcesInExport,
      // mapEnabled is DERIVED from the body: it is true iff the analyst placed a
      // map block. The old standalone checkbox is gone.
      mapEnabled: form.blocks.some((b) => b.type === "map"),
      linkedIncidentIds: form.linkedIncidentIds,
    };

    const textFields: Array<[keyof FormState, string]> = [
      ["country", form.country],
      ["province", form.province],
      ["city", form.city],
      ["category", form.category],
      ["analystNotes", form.analystNotes],
      ["internalSourceNotes", form.internalSourceNotes],
      ["createdBy", form.createdBy],
    ];
    for (const [key, raw] of textFields) {
      const v = raw.trim();
      if (forCreate) {
        if (v) out[key] = v;
      } else {
        out[key] = v;
      }
    }

    // Cover: on CREATE omit when empty; on UPDATE send null to CLEAR so an
    // analyst can remove a cover and have it stick.
    const coverKey = form.coverImageKey.trim();
    const coverData = form.coverImageDataUrl.trim();
    if (forCreate) {
      if (coverKey) out.coverImageKey = coverKey;
      if (coverData) out.coverImageDataUrl = coverData;
    } else {
      out.coverImageKey = coverKey ? coverKey : null;
      out.coverImageDataUrl = coverData ? coverData : null;
    }

    // Enum fields: on CREATE omit when empty; on UPDATE send null to CLEAR.
    if (forCreate) {
      if (form.severity) out.severity = form.severity;
      if (form.confidenceLevel) out.confidenceLevel = form.confidenceLevel;
    } else {
      out.severity = form.severity ? form.severity : null;
      out.confidenceLevel = form.confidenceLevel ? form.confidenceLevel : null;
    }

    const incidentDate = toIsoOrNull(form.incidentDate);
    const lat = num(form.latitude);
    const lng = num(form.longitude);
    const rad = num(form.affectedRadiusKm);
    if (forCreate) {
      if (incidentDate) out.incidentDate = incidentDate;
      if (lat !== null) out.latitude = lat;
      if (lng !== null) out.longitude = lng;
      if (rad !== null) out.affectedRadiusKm = rad;
    } else {
      out.incidentDate = incidentDate;
      out.latitude = lat;
      out.longitude = lng;
      out.affectedRadiusKm = rad;
    }

    // Map markers always travel as a (possibly empty) array — invalid rows are
    // dropped and blank label/severity omitted so the stored shape stays clean.
    out.mapPoints = form.mapPoints
      .map((m) => ({
        lat: num(m.lat),
        lng: num(m.lng),
        label: m.label.trim(),
        severity: m.severity,
      }))
      .filter((m) => m.lat !== null && m.lng !== null)
      .map((m) => ({
        lat: m.lat as number,
        lng: m.lng as number,
        ...(m.label ? { label: m.label } : {}),
        ...(m.severity ? { severity: m.severity } : {}),
      }));

    // The free-form body always travels as a (possibly empty) block array in
    // analyst order; chart/image data live inline on each block.
    out.blocks = toApiBlocks(form.blocks);

    // Blocks are the single source of truth for the body. On UPDATE, clear the
    // legacy fixed-narrative columns and the old top-level photo/chart arrays so
    // a migrated report never carries stale duplicate content. On CREATE they
    // simply default empty, so nothing to send.
    if (!forCreate) {
      const legacyProse = [
        "bluf",
        "incidentDetails",
        "currentSituation",
        "operationalImpact",
        "assessment",
        "outlook",
        "recommendedActions",
      ] as const;
      for (const k of legacyProse) out[k] = null;
      out.photos = [];
      out.charts = [];
    }

    return out;
  }

  function handleSave() {
    if (!form.title.trim()) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }
    const blockError = validateSpecialReportBlocks(toApiBlocks(form.blocks));
    if (blockError) {
      toast({
        title: "Report body is invalid",
        description: blockError,
        variant: "destructive",
      });
      return;
    }
    if (form.coverImageDataUrl.trim()) {
      const coverError = validateCoverDataUrl(form.coverImageDataUrl.trim());
      if (coverError) {
        toast({ title: "Cover image invalid", description: coverError, variant: "destructive" });
        return;
      }
    }
    if (isNew) {
      create.mutate(
        { data: buildData(true) as never },
        {
          onSuccess: (created) => {
            clearDraft(newDraftKey);
            baselineRef.current = JSON.stringify(form);
            setRecovered(false);
            qc.invalidateQueries({ queryKey: getListSpecialReportsQueryKey() });
            toast({ title: "Special report created" });
            setLocation(`/special-reports/${(created as SpecialReport).id}`);
          },
          onError: (err) => {
            toast({ ...specialReportSaveErrorMessage(err, "create"), variant: "destructive" });
          },
        },
      );
    } else if (id != null) {
      update.mutate(
        { id, data: buildData(false) as never },
        {
          onSuccess: () => {
            clearDraft(draftKey(id));
            baselineRef.current = JSON.stringify(form);
            setRecovered(false);
            qc.invalidateQueries({ queryKey: getGetSpecialReportQueryKey(id) });
            qc.invalidateQueries({ queryKey: getListSpecialReportsQueryKey() });
            toast({ title: "Saved" });
          },
          onError: (err) => {
            toast({ ...specialReportSaveErrorMessage(err, "save"), variant: "destructive" });
          },
        },
      );
    }
  }

  async function doExport() {
    const slug = slugifyForFilename(previewReport.title || "special-report");
    try {
      const el = previewRef.current?.querySelector(".print-report") as HTMLElement | null;
      if (!el) {
        toast({ title: "Preview not ready", variant: "destructive" });
        return;
      }
      await exportElementToPdf(el, `${slug}.pdf`);
    } catch {
      toast({ title: "Export failed", variant: "destructive" });
      return;
    }
    if (id != null) {
      appendExport.mutate(
        { id, data: { format: "pdf" } },
        {
          onSuccess: () => {
            qc.invalidateQueries({ queryKey: getGetSpecialReportQueryKey(id) });
            qc.invalidateQueries({ queryKey: getListSpecialReportsQueryKey() });
          },
          onError: () => {
            toast({
              title: "Export saved locally",
              description: "The file downloaded, but its export history could not be recorded.",
            });
          },
        },
      );
    }
  }

  function attemptExport() {
    if (id == null) {
      toast({ title: "Save the report before exporting", variant: "destructive" });
      return;
    }
    const result = checkSpecialReportQuality(previewReport, linkedIncidents);
    if (result.errors.length === 0 && result.warnings.length === 0) {
      doExport();
      return;
    }
    setQuality({ open: true, doExportAfter: true, result });
  }

  function runQualityCheck() {
    setQuality({
      open: true,
      doExportAfter: false,
      result: checkSpecialReportQuality(previewReport, linkedIncidents),
    });
  }

  const searchResults = useMemo(() => {
    const q = incidentSearch.trim().toLowerCase();
    const base = allIncidents.filter((i) => !form.linkedIncidentIds.includes(i.id));
    if (!q) return base.slice(0, 8);
    return base
      .filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          (i.summary ?? "").toLowerCase().includes(q) ||
          (i.country ?? "").toLowerCase().includes(q) ||
          (i.location ?? "").toLowerCase().includes(q),
      )
      .slice(0, 12);
  }, [incidentSearch, allIncidents, form.linkedIncidentIds]);

  function addIncident(i: Incident) {
    if (form.linkedIncidentIds.includes(i.id)) return;
    set("linkedIncidentIds", [...form.linkedIncidentIds, i.id]);
  }
  function removeIncident(incidentId: number) {
    set(
      "linkedIncidentIds",
      form.linkedIncidentIds.filter((x) => x !== incidentId),
    );
  }

  if (!isNew && isLoading) {
    return <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>;
  }
  if (!isNew && !report) {
    return <div className="p-8 text-center text-sm text-muted-foreground">Special report not found.</div>;
  }

  const saving = create.isPending || update.isPending;

  return (
    <div className="max-w-[1800px] mx-auto space-y-4">
      {/* Top bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 no-print">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            onClick={() => setLocation("/special-reports")}
            className="rounded-sm"
          >
            <ArrowLeft className="w-4 h-4 mr-2" /> Special Reports
          </Button>
          <h1 className="text-xl font-serif font-bold text-primary uppercase tracking-tight">
            {isNew ? "New Special Report" : "Edit Special Report"}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={runQualityCheck} className="rounded-sm">
            <ShieldCheck className="w-4 h-4 mr-2" /> Quality Check
          </Button>
          <Button
            variant="outline"
            onClick={attemptExport}
            disabled={id == null}
            className="rounded-sm"
          >
            <FileDown className="w-4 h-4 mr-2" /> PDF
          </Button>
          {!isNew && id != null && (
            <Button
              variant="ghost"
              onClick={() => {
                if (confirm("Delete this special report?")) {
                  del.mutate(
                    { id },
                    {
                      onSuccess: () => {
                        clearDraft(draftKey(id));
                        qc.invalidateQueries({ queryKey: getListSpecialReportsQueryKey() });
                        setLocation("/special-reports");
                      },
                      onError: (err) => {
                        toast({
                          ...specialReportSaveErrorMessage(err, "delete"),
                          variant: "destructive",
                        });
                      },
                    },
                  );
                }
              }}
              className="rounded-sm text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          )}
          {recovered && (
            <div className="flex items-center gap-2 text-xs font-sans text-muted-foreground">
              <span className="uppercase tracking-wider">Unsaved draft recovered</span>
              <button
                type="button"
                onClick={() => {
                  if (
                    !confirm("Discard the recovered local draft? Unsaved changes will be lost.")
                  )
                    return;
                  if (currentDraftKey) clearDraft(currentDraftKey);
                  const clean = report ? formFromReport(report) : emptyForm();
                  baselineRef.current = JSON.stringify(clean);
                  setForm(clean);
                  setRecovered(false);
                }}
                className="underline hover:text-foreground"
              >
                Discard
              </button>
            </div>
          )}
          <Button
            onClick={handleSave}
            disabled={saving}
            className="bg-accent hover:bg-accent/90 text-accent-foreground rounded-sm"
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {/* Builder form */}
        <div className="space-y-4 no-print">
          <Card title="Identification">
            <Field label="Title">
              <Input value={form.title} onChange={(e) => set("title", e.target.value)} className="rounded-sm" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Status">
                <Select value={form.status} onValueChange={(v) => set("status", v)}>
                  <SelectTrigger className="rounded-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SPECIAL_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Severity">
                <Select value={form.severity || "none"} onValueChange={(v) => set("severity", v === "none" ? "" : v)}>
                  <SelectTrigger className="rounded-sm"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {SEVERITY_LEVELS.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Category / Domain">
                <Input value={form.category} onChange={(e) => set("category", e.target.value)} className="rounded-sm" />
              </Field>
              <Field label="Prepared By">
                <Input value={form.createdBy} onChange={(e) => set("createdBy", e.target.value)} className="rounded-sm" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Report Date">
                <DateTime24 value={form.reportDate} onChange={(v) => set("reportDate", v)} />
              </Field>
              <Field label="Incident Date">
                <DateTime24 value={form.incidentDate} onChange={(v) => set("incidentDate", v)} />
              </Field>
            </div>
          </Card>

          <Card title="Front Cover">
            <p className="text-xs text-muted-foreground mb-3">
              Choose a front cover: pick one from the library or upload your own
              (JPEG/PNG/WebP, up to {Math.round(MAX_COVER_DATAURL_BYTES / (1024 * 1024))} MB).
              The cover renders as the first full page of the report and its PDF.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">
              <button
                type="button"
                onClick={clearCover}
                className={`border rounded-sm h-20 flex items-center justify-center text-xs uppercase tracking-wider ${
                  !coverPreviewUrl ? "border-accent text-accent" : "border-border text-muted-foreground"
                }`}
              >
                No cover
              </button>
              {COVER_LIBRARY.map((c) => {
                const active = !form.coverImageDataUrl && form.coverImageKey === c.key;
                return (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => pickCoverKey(c.key)}
                    className={`border rounded-sm h-20 overflow-hidden relative ${
                      active ? "ring-2 ring-accent border-accent" : "border-border"
                    }`}
                    title={c.label}
                  >
                    <img src={c.url} alt={c.label} className="w-full h-full object-cover" />
                    <span className="absolute bottom-0 inset-x-0 bg-black/55 text-white text-[10px] uppercase tracking-wider py-0.5 text-center">
                      {c.label}
                    </span>
                  </button>
                );
              })}
            </div>
            <input
              ref={coverInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                void uploadCover(e.target.files);
                e.target.value = "";
              }}
            />
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => coverInputRef.current?.click()}
                className="rounded-sm"
              >
                <ImagePlus className="w-4 h-4 mr-2" /> Upload cover
              </Button>
              {form.coverImageDataUrl && (
                <span className="text-xs text-muted-foreground">Custom cover uploaded</span>
              )}
            </div>
            {coverPreviewUrl && (
              <div className="mt-3 border border-border rounded-sm overflow-hidden">
                <img src={coverPreviewUrl} alt="Selected cover" className="w-full max-h-48 object-cover" />
              </div>
            )}
          </Card>

          <Card title="Location">
            <div className="grid grid-cols-3 gap-3">
              <Field label="Country">
                <Input value={form.country} onChange={(e) => set("country", e.target.value)} className="rounded-sm" />
              </Field>
              <Field label="Province / State">
                <Input value={form.province} onChange={(e) => set("province", e.target.value)} className="rounded-sm" />
              </Field>
              <Field label="Town / City">
                <Input value={form.city} onChange={(e) => set("city", e.target.value)} className="rounded-sm" />
              </Field>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Latitude">
                <Input value={form.latitude} onChange={(e) => set("latitude", e.target.value)} className="rounded-sm" />
              </Field>
              <Field label="Longitude">
                <Input value={form.longitude} onChange={(e) => set("longitude", e.target.value)} className="rounded-sm" />
              </Field>
              <Field label="Affected Radius (km)">
                <Input value={form.affectedRadiusKm} onChange={(e) => set("affectedRadiusKm", e.target.value)} className="rounded-sm" />
              </Field>
            </div>
          </Card>

          <Card title="Additional Map Points">
            <p className="text-xs text-muted-foreground mb-3">
              Plot extra coordinate markers on the report map — one row per point.
              Each appears as a dot (coloured by its severity) alongside the
              primary location and any linked incidents, shown wherever you add
              an Incident map block to the body below.
            </p>
            {form.mapPoints.length > 0 && (
              <div className="space-y-2 mb-3">
                {form.mapPoints.map((p, idx) => (
                  <div key={idx} className="grid grid-cols-[1fr_1fr_1.4fr_1.1fr_auto] gap-2 items-center">
                    <Input value={p.lat} onChange={(e) => updateMapPoint(idx, "lat", e.target.value)} placeholder="Latitude" className="rounded-sm" />
                    <Input value={p.lng} onChange={(e) => updateMapPoint(idx, "lng", e.target.value)} placeholder="Longitude" className="rounded-sm" />
                    <Input value={p.label} onChange={(e) => updateMapPoint(idx, "label", e.target.value)} placeholder="Label (optional)" className="rounded-sm" />
                    <Select
                      value={p.severity || "none"}
                      onValueChange={(v) => updateMapPoint(idx, "severity", v === "none" ? "" : v)}
                    >
                      <SelectTrigger className="rounded-sm"><SelectValue placeholder="Severity" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">—</SelectItem>
                        {SEVERITY_LEVELS.map((s) => (
                          <SelectItem key={s} value={s}>{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => removeMapPoint(idx)}
                      className="rounded-sm text-muted-foreground hover:text-destructive h-9 px-2"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <Button type="button" variant="outline" onClick={addMapPoint} className="rounded-sm">
              Add point
            </Button>
          </Card>

          <Card title="Linked Incidents">
            {linkedIncidents.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {linkedIncidents.map((i) => (
                  <span
                    key={i.id}
                    className="inline-flex items-center gap-1.5 bg-secondary text-secondary-foreground px-2 py-1 rounded-sm text-xs"
                  >
                    {(i.displayTitle?.trim() || i.title).trim()}
                    <button onClick={() => removeIncident(i.id)} className="hover:text-destructive">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <Input
              value={incidentSearch}
              onChange={(e) => setIncidentSearch(e.target.value)}
              placeholder="Search incidents to link…"
              className="rounded-sm"
            />
            <div className="mt-2 border border-border rounded-sm divide-y divide-border max-h-56 overflow-y-auto">
              {searchResults.length === 0 ? (
                <div className="p-3 text-xs text-muted-foreground">No matching incidents.</div>
              ) : (
                searchResults.map((i) => (
                  <button
                    key={i.id}
                    onClick={() => addIncident(i)}
                    className="w-full text-left p-2.5 hover:bg-muted/40 text-sm"
                  >
                    <div className="font-medium truncate">{(i.displayTitle?.trim() || i.title).trim()}</div>
                    <div className="text-xs text-muted-foreground">
                      {[i.country, i.location].filter(Boolean).join(", ")} ·{" "}
                      {format(new Date(i.occurredAt), "dd MMM yyyy")} · {i.severity}
                    </div>
                  </button>
                ))
              )}
            </div>
          </Card>

          <Card title="Report Body">
            <p className="text-xs text-muted-foreground mb-3">
              Build the report from blocks in any order — add headings,
              paragraphs, bullet lists, hand-built charts, images, an incident
              map, and a reference-incidents table. Reorder or remove any block;
              empty blocks are skipped in the preview and export.
            </p>
            <p
              className={`text-xs mb-3 ${
                imageUsage.over
                  ? "text-destructive font-medium"
                  : imageUsage.warn
                    ? "text-amber-600 font-medium"
                    : "text-muted-foreground"
              }`}
            >
              {imageUsage.count} / {MAX_PHOTOS} images ·{" "}
              {(imageUsage.bytes / (1024 * 1024)).toFixed(1)} MB /{" "}
              {Math.round(MAX_PHOTOS_TOTAL_BYTES / (1024 * 1024))} MB
              {imageUsage.over
                ? " — over the limit; remove or shrink some before saving"
                : imageUsage.warn
                  ? " — approaching the limit"
                  : ""}
            </p>

            {form.blocks.length === 0 ? (
              <p className="text-xs text-muted-foreground border border-dashed border-border rounded-sm p-4 mb-3">
                No blocks yet. Use the buttons below to build the report body.
              </p>
            ) : (
              <div className="space-y-3 mb-3">
                {form.blocks.map((b, idx) => (
                  <div key={b.id} className="border border-border rounded-sm p-3 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {BLOCK_LABELS[b.type]}
                      </span>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => moveBlock(b.id, -1)}
                          disabled={idx === 0}
                          className="rounded-sm h-8 px-2"
                          aria-label="Move block up"
                        >
                          <ArrowUp className="w-4 h-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => moveBlock(b.id, 1)}
                          disabled={idx === form.blocks.length - 1}
                          className="rounded-sm h-8 px-2"
                          aria-label="Move block down"
                        >
                          <ArrowDown className="w-4 h-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => removeBlock(b.id)}
                          className="rounded-sm h-8 px-2 text-muted-foreground hover:text-destructive"
                          aria-label="Remove block"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                    {renderBlockEditor(b)}
                  </div>
                ))}
              </div>
            )}

            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                void addImageBlocks(e.target.files);
                e.target.value = "";
              }}
            />
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => addBlock("heading")} className="rounded-sm h-8">
                Heading
              </Button>
              <Button type="button" variant="outline" onClick={() => addBlock("text")} className="rounded-sm h-8">
                Paragraph
              </Button>
              <Button type="button" variant="outline" onClick={() => addBlock("bullets")} className="rounded-sm h-8">
                Bullets
              </Button>
              <Button type="button" variant="outline" onClick={() => addBlock("chart")} className="rounded-sm h-8">
                Chart
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => photoInputRef.current?.click()}
                className="rounded-sm h-8"
              >
                <ImagePlus className="w-4 h-4 mr-2" /> Image
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => addBlock("map")}
                disabled={form.blocks.some((b) => b.type === "map")}
                className="rounded-sm h-8"
              >
                Incident map
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => addBlock("incidents")}
                disabled={form.blocks.some((b) => b.type === "incidents")}
                className="rounded-sm h-8"
              >
                Reference incidents
              </Button>
            </div>
          </Card>

          <Card title="Internal (not exported unless enabled)">
            <Field label="Analyst Notes (never exported)">
              <Textarea value={form.analystNotes} onChange={(e) => set("analystNotes", e.target.value)} rows={3} className="rounded-sm" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Confidence">
                <Select value={form.confidenceLevel || "none"} onValueChange={(v) => set("confidenceLevel", v === "none" ? "" : v)}>
                  <SelectTrigger className="rounded-sm"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {CONFIDENCE_LEVELS.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Field label="Internal Source Notes">
              <Textarea value={form.internalSourceNotes} onChange={(e) => set("internalSourceNotes", e.target.value)} rows={3} className="rounded-sm" />
            </Field>
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none mt-1">
              <input
                type="checkbox"
                checked={form.showSourcesInExport}
                onChange={(e) => set("showSourcesInExport", e.target.checked)}
                className="h-4 w-4 accent-accent"
              />
              <span>Show sources & confidence in client export</span>
            </label>
          </Card>

          {!isNew && report && report.exportHistory.length > 0 && (
            <Card title="Export History">
              <div className="space-y-1.5">
                {[...report.exportHistory].reverse().map((e, idx) => (
                  <div key={idx} className="flex items-center justify-between text-xs font-mono text-muted-foreground">
                    <span className="uppercase tracking-wider">{e.format}</span>
                    <span>{format(new Date(e.exportedAt), "dd MMM yyyy HH:mm")}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        {/* Live preview */}
        <div className="xl:sticky xl:top-4 h-fit">
          <div className="text-[10px] font-sans uppercase tracking-widest text-muted-foreground mb-2 no-print">
            Live preview — identical to the PDF export
          </div>
          <div ref={previewRef} className="border border-border rounded-sm overflow-hidden bg-white">
            <SpecialReportPreview report={previewReport} incidents={linkedIncidents} />
          </div>
        </div>
      </div>

      <QualityDialog
        state={quality}
        onClose={() => setQuality((q) => ({ ...q, open: false }))}
        onProceed={() => {
          setQuality((q) => ({ ...q, open: false }));
          doExport();
        }}
      />
    </div>
  );
}

function QualityDialog({
  state,
  onClose,
  onProceed,
}: {
  state: { open: boolean; doExportAfter: boolean; result: QualityResult };
  onClose: () => void;
  onProceed: () => void;
}) {
  const { errors, warnings } = state.result;
  const clean = errors.length === 0 && warnings.length === 0;
  const blocked = errors.length > 0;
  return (
    <Dialog open={state.open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-serif uppercase tracking-wide">Pre-Export Quality Check</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          {clean && <p className="text-muted-foreground">No issues found. The report is ready to export.</p>}
          {errors.length > 0 && (
            <div>
              <div className="text-[11px] font-bold uppercase tracking-widest mb-1" style={{ color: "#A33232" }}>
                Must fix before export
              </div>
              <ul className="list-disc pl-5 space-y-1">
                {errors.map((e, i) => (
                  <li key={i} style={{ color: "#A33232" }}>{e}</li>
                ))}
              </ul>
            </div>
          )}
          {warnings.length > 0 && (
            <div>
              <div className="text-[11px] font-bold uppercase tracking-widest mb-1 text-muted-foreground">
                Advisory
              </div>
              <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                {warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="rounded-sm">Close</Button>
          {state.doExportAfter && !blocked && (
            <Button onClick={onProceed} className="bg-accent hover:bg-accent/90 text-accent-foreground rounded-sm">
              Export anyway
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-sm p-4 space-y-3">
      <div className="text-xs font-serif font-bold uppercase tracking-wider text-primary">{title}</div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[10px] font-sans uppercase tracking-widest text-muted-foreground block mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}
