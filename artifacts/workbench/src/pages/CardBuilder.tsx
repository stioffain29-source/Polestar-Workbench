import { useEffect, useMemo, useRef, useState } from "react";
import { useRoute, useLocation } from "wouter";
import {
  useGetCardDraft,
  useCreateCardDraft,
  useUpdateCardDraft,
  useDeleteCardDraft,
  useListCardTemplates,
  useCreateCardTemplate,
  useGetBrandSettings,
  getGetCardDraftQueryKey,
  getListCardDraftsQueryKey,
  getListCardTemplatesQueryKey,
  type CardContent,
  type BrandSettings,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Download, Save, Trash2, LayoutTemplate, ImagePlus } from "lucide-react";
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
import { useToast } from "@/hooks/use-toast";
import { MasterCard } from "@/components/MasterCard";
import {
  CARD_RATINGS,
  CARD_TEMPLATES,
  CARD_TEMPLATE_KEYS,
  CARD_WIDTH,
  CARD_HEIGHT,
  cardRatingLabel,
  templateMeta,
} from "@/lib/cardTemplates";
import { exportCardToPng, slugifyForFilename } from "@/lib/exportCardPng";

const DEFAULT_BRAND: BrandSettings = {
  id: 1,
  colorMidnight: "#0B0B3D",
  colorElectric: "#4655FF",
  colorDusk: "#303030",
  colorPolar: "#E2E2E2",
  colorExtreme: "#A33232",
  logoImage: null,
  fontHeading: "Roboto Condensed",
  fontBody: "Roboto",
  footerText: "Polestar Advisory",
  updatedAt: new Date().toISOString(),
};

function emptyContent(templateKey: string): CardContent {
  const meta = templateMeta(templateKey);
  return {
    topic: meta.defaults.topic ?? "",
    country: "",
    eventDate: "",
    headline: "",
    bluf: "",
    keyPoints: ["", "", ""],
    rating: meta.defaults.rating ?? "moderate",
    outlook: "",
    mapLocation: "",
    mapImage: "",
    sourceNote: "",
    logoImage: "",
    footerText: "",
  };
}

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function CardBuilder() {
  const [, params] = useRoute("/card-builder/:id");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();

  const isNew = !params?.id || params.id === "new";
  const draftId = isNew ? undefined : Number(params!.id);

  const { data: draft } = useGetCardDraft(draftId ?? 0, {
    query: { enabled: !isNew, queryKey: getGetCardDraftQueryKey(draftId ?? 0) },
  });
  const { data: brandData } = useGetBrandSettings();
  const { data: templates = [] } = useListCardTemplates();
  const brand = brandData ?? DEFAULT_BRAND;

  const createDraft = useCreateCardDraft();
  const updateDraft = useUpdateCardDraft();
  const deleteDraft = useDeleteCardDraft();
  const createTemplate = useCreateCardTemplate();

  const [title, setTitle] = useState("Untitled Card");
  const [templateKey, setTemplateKey] = useState<string>("country_risk");
  const [content, setContent] = useState<CardContent>(() => emptyContent("country_risk"));
  const [loaded, setLoaded] = useState(false);

  // Hydrate from a saved draft once.
  useEffect(() => {
    if (isNew || !draft || loaded) return;
    setTitle(draft.title);
    setTemplateKey(draft.templateKey || "country_risk");
    setContent({ ...emptyContent(draft.templateKey || "country_risk"), ...draft.content });
    setLoaded(true);
  }, [isNew, draft, loaded]);

  const cardRef = useRef<HTMLDivElement>(null);
  const previewWrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.4);

  // Fit the full-size card into the available preview width.
  useEffect(() => {
    function recompute() {
      const w = previewWrapRef.current?.clientWidth ?? 0;
      if (w > 0) setScale(Math.min(0.6, w / CARD_WIDTH));
    }
    recompute();
    window.addEventListener("resize", recompute);
    return () => window.removeEventListener("resize", recompute);
  }, []);

  const keyPoints = useMemo(() => {
    const kp = [...(content.keyPoints ?? [])];
    while (kp.length < 3) kp.push("");
    return kp.slice(0, 3);
  }, [content.keyPoints]);

  function patch(p: Partial<CardContent>) {
    setContent((c) => ({ ...c, ...p }));
  }

  function setKeyPoint(i: number, value: string) {
    const kp = [...keyPoints];
    kp[i] = value;
    patch({ keyPoints: kp });
  }

  function onPickTemplate(key: string) {
    setTemplateKey(key);
    // Apply template defaults only for empty fields, so switching templates
    // mid-edit never wipes analyst content.
    const meta = templateMeta(key);
    setContent((c) => ({
      ...c,
      topic: c.topic ? c.topic : meta.defaults.topic ?? "",
      rating: c.rating ? c.rating : meta.defaults.rating ?? "moderate",
    }));
  }

  async function onUploadImage(field: "mapImage" | "logoImage", file?: File | null) {
    if (!file) return;
    const dataUrl = await fileToDataUrl(file);
    patch({ [field]: dataUrl } as Partial<CardContent>);
  }

  function save() {
    if (isNew) {
      createDraft.mutate(
        { data: { title, templateKey, content } },
        {
          onSuccess: (created) => {
            qc.invalidateQueries({ queryKey: getListCardDraftsQueryKey() });
            toast({ title: "Card saved" });
            setLocation(`/card-builder/${created.id}`);
          },
          onError: () => toast({ title: "Save failed", variant: "destructive" }),
        },
      );
    } else {
      updateDraft.mutate(
        { id: draftId!, data: { title, templateKey, content } },
        {
          onSuccess: () => {
            qc.invalidateQueries({ queryKey: getGetCardDraftQueryKey(draftId!) });
            qc.invalidateQueries({ queryKey: getListCardDraftsQueryKey() });
            toast({ title: "Card saved" });
          },
          onError: () => toast({ title: "Save failed", variant: "destructive" }),
        },
      );
    }
  }

  function remove() {
    if (isNew || !draftId) return;
    if (!confirm("Delete this card?")) return;
    deleteDraft.mutate(
      { id: draftId },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListCardDraftsQueryKey() });
          setLocation("/card-builder");
        },
      },
    );
  }

  function saveAsTemplate() {
    const name = prompt("Template name", `${title} template`);
    if (!name) return;
    createTemplate.mutate(
      { data: { name, templateKey, content } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListCardTemplatesQueryKey() });
          toast({ title: "Template saved" });
        },
        onError: () => toast({ title: "Save failed", variant: "destructive" }),
      },
    );
  }

  function applyTemplatePreset(id: string) {
    const t = templates.find((x) => String(x.id) === id);
    if (!t) return;
    setTemplateKey(t.templateKey || "country_risk");
    setContent({ ...emptyContent(t.templateKey || "country_risk"), ...t.content });
    toast({ title: `Loaded "${t.name}"` });
  }

  async function exportPng() {
    if (!cardRef.current) return;
    try {
      await exportCardToPng(cardRef.current, slugifyForFilename(title));
      toast({ title: "PNG exported (1080×1350)" });
    } catch {
      toast({ title: "Export failed", variant: "destructive" });
    }
  }

  return (
    <div className="max-w-[1600px] mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <button
          onClick={() => setLocation("/card-builder")}
          className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5"
        >
          <ArrowLeft className="w-4 h-4" /> All Cards
        </button>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={saveAsTemplate} className="rounded-sm">
            <LayoutTemplate className="w-4 h-4 mr-2" /> Save as Template
          </Button>
          {!isNew && (
            <Button variant="outline" onClick={remove} className="rounded-sm text-destructive">
              <Trash2 className="w-4 h-4" />
            </Button>
          )}
          <Button onClick={save} className="rounded-sm">
            <Save className="w-4 h-4 mr-2" /> Save
          </Button>
          <Button
            onClick={exportPng}
            className="bg-accent hover:bg-accent/90 text-accent-foreground rounded-sm"
          >
            <Download className="w-4 h-4 mr-2" /> Export PNG
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ---- Left: form ---- */}
        <div className="space-y-5">
          <div>
            <div className="text-xs font-sans uppercase tracking-widest text-muted-foreground">
              Card Studio
            </div>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 text-2xl font-serif font-bold h-12 rounded-sm"
              placeholder="Card title"
            />
          </div>

          <Field label="Template">
            <Select value={templateKey} onValueChange={onPickTemplate}>
              <SelectTrigger className="rounded-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CARD_TEMPLATE_KEYS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {CARD_TEMPLATES[k].name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">{templateMeta(templateKey).blurb}</p>
          </Field>

          {templates.length > 0 && (
            <Field label="Load saved preset">
              <Select onValueChange={applyTemplatePreset}>
                <SelectTrigger className="rounded-sm">
                  <SelectValue placeholder="Pick a saved template…" />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      {t.name}
                      {t.isBuiltIn ? " (built-in)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}

          <div className="grid grid-cols-2 gap-4">
            <Field label="Topic">
              <Input
                value={content.topic ?? ""}
                onChange={(e) => patch({ topic: e.target.value })}
                className="rounded-sm"
              />
            </Field>
            <Field label="Country">
              <Input
                value={content.country ?? ""}
                onChange={(e) => patch({ country: e.target.value })}
                className="rounded-sm"
              />
            </Field>
          </div>

          <Field label="Date / time">
            <Input
              value={content.eventDate ?? ""}
              onChange={(e) => patch({ eventDate: e.target.value })}
              placeholder="e.g. 14 Jun 2026, 14:00 PGT"
              className="rounded-sm"
            />
          </Field>

          <Field label="Headline">
            <Input
              value={content.headline ?? ""}
              onChange={(e) => patch({ headline: e.target.value })}
              className="rounded-sm"
            />
          </Field>

          <Field label="BLUF (bottom line up front)">
            <Textarea
              value={content.bluf ?? ""}
              onChange={(e) => patch({ bluf: e.target.value })}
              rows={3}
              className="rounded-sm"
            />
          </Field>

          <Field label="Key points (exactly three)">
            <div className="space-y-2">
              {keyPoints.map((kp, i) => (
                <Input
                  key={i}
                  value={kp}
                  onChange={(e) => setKeyPoint(i, e.target.value)}
                  placeholder={`Key point ${i + 1}`}
                  className="rounded-sm"
                />
              ))}
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Risk rating">
              <Select value={content.rating ?? "moderate"} onValueChange={(v) => patch({ rating: v })}>
                <SelectTrigger className="rounded-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CARD_RATINGS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {cardRatingLabel(r)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Map location label">
              <Input
                value={content.mapLocation ?? ""}
                onChange={(e) => patch({ mapLocation: e.target.value })}
                className="rounded-sm"
              />
            </Field>
          </div>

          <Field label="Outlook">
            <Textarea
              value={content.outlook ?? ""}
              onChange={(e) => patch({ outlook: e.target.value })}
              rows={2}
              className="rounded-sm"
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Visual / map image">
              <label className="flex items-center gap-2 text-sm border border-input rounded-sm px-3 h-10 cursor-pointer hover:bg-muted">
                <ImagePlus className="w-4 h-4" />
                {content.mapImage ? "Replace image" : "Upload image"}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => onUploadImage("mapImage", e.target.files?.[0])}
                />
              </label>
              {content.mapImage && (
                <button
                  className="text-xs text-destructive mt-1"
                  onClick={() => patch({ mapImage: "" })}
                >
                  Remove image
                </button>
              )}
            </Field>
            <Field label="Logo override (optional)">
              <label className="flex items-center gap-2 text-sm border border-input rounded-sm px-3 h-10 cursor-pointer hover:bg-muted">
                <ImagePlus className="w-4 h-4" />
                {content.logoImage ? "Replace logo" : "Upload logo"}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => onUploadImage("logoImage", e.target.files?.[0])}
                />
              </label>
              {content.logoImage && (
                <button
                  className="text-xs text-destructive mt-1"
                  onClick={() => patch({ logoImage: "" })}
                >
                  Use brand logo
                </button>
              )}
            </Field>
          </div>

          <Field label="Source note">
            <Input
              value={content.sourceNote ?? ""}
              onChange={(e) => patch({ sourceNote: e.target.value })}
              className="rounded-sm"
            />
          </Field>

          <Field label="Footer text (overrides brand default)">
            <Input
              value={content.footerText ?? ""}
              onChange={(e) => patch({ footerText: e.target.value })}
              placeholder={brand.footerText}
              className="rounded-sm"
            />
          </Field>
        </div>

        {/* ---- Right: live preview ---- */}
        <div className="lg:sticky lg:top-4 self-start">
          <div className="text-xs font-sans uppercase tracking-widest text-muted-foreground mb-2">
            Live Preview · 1080 × 1350
          </div>
          <div
            ref={previewWrapRef}
            className="bg-muted/40 border border-border rounded-sm p-4 flex justify-center overflow-hidden"
          >
            <div
              style={{
                width: CARD_WIDTH * scale,
                height: CARD_HEIGHT * scale,
                position: "relative",
              }}
            >
              <div
                style={{
                  transform: `scale(${scale})`,
                  transformOrigin: "top left",
                  position: "absolute",
                  top: 0,
                  left: 0,
                }}
              >
                <MasterCard ref={cardRef} templateKey={templateKey} content={content} brand={brand} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-sans uppercase tracking-wider text-muted-foreground block mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}
