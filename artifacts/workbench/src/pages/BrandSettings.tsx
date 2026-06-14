import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  useGetBrandSettings,
  useUpdateBrandSettings,
  getGetBrandSettingsQueryKey,
  type BrandSettings as BrandSettingsT,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Save, ImagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { MasterCard } from "@/components/MasterCard";
import { CARD_WIDTH, CARD_HEIGHT } from "@/lib/cardTemplates";

const PREVIEW_CONTENT = {
  topic: "Country Risk",
  country: "Papua New Guinea",
  eventDate: "14 Jun 2026",
  eventTime: "14:00 PGT",
  headline: "Brand Preview Card",
  bluf: "This preview reflects your current brand colours, fonts, logo and footer.",
  keyPoints: ["First key point", "Second key point", "Third key point"],
  highlights: [
    { label: "Crowd Size", body: "Several thousand demonstrators gathered downtown.", icon: "crowd" },
    { label: "Security Posture", body: "Police deployed in force around government buildings.", icon: "police" },
    { label: "Traffic Impact", body: "Major arterial roads closed through the afternoon.", icon: "traffic" },
  ],
  rating: "high",
  ratingNote: "",
  outlook: "Settings apply to every card preview and PNG export.",
  mapLocation: "Port Moresby",
  sourceNote: "Source: Polestar Advisory",
};

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function BrandSettings() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data } = useGetBrandSettings();
  const update = useUpdateBrandSettings();

  const [form, setForm] = useState<BrandSettingsT | null>(null);

  useEffect(() => {
    if (data && !form) setForm(data);
  }, [data, form]);

  if (!form) {
    return <div className="text-sm text-muted-foreground">Loading brand settings…</div>;
  }

  function set<K extends keyof BrandSettingsT>(key: K, value: BrandSettingsT[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f));
  }

  async function onUploadLogo(file?: File | null) {
    if (!file) return;
    const dataUrl = await fileToDataUrl(file);
    set("logoImage", dataUrl);
  }

  function save() {
    if (!form) return;
    update.mutate(
      {
        data: {
          colorMidnight: form.colorMidnight,
          colorElectric: form.colorElectric,
          colorDusk: form.colorDusk,
          colorPolar: form.colorPolar,
          colorExtreme: form.colorExtreme,
          logoImage: form.logoImage ?? null,
          fontHeading: form.fontHeading,
          fontBody: form.fontBody,
          footerText: form.footerText,
        },
      },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetBrandSettingsQueryKey() });
          toast({ title: "Brand settings saved" });
        },
        onError: () => toast({ title: "Save failed", variant: "destructive" }),
      },
    );
  }

  const colorFields: Array<{ key: keyof BrandSettingsT; label: string }> = [
    { key: "colorMidnight", label: "Midnight Blue" },
    { key: "colorElectric", label: "Electric Blue" },
    { key: "colorDusk", label: "Dusk Gray" },
    { key: "colorPolar", label: "Polar Gray" },
    { key: "colorExtreme", label: "Extreme (top tier only)" },
  ];

  return (
    <div className="max-w-[1600px] mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <button
          onClick={() => setLocation("/card-builder")}
          className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5"
        >
          <ArrowLeft className="w-4 h-4" /> Card Studio
        </button>
        <Button onClick={save} className="rounded-sm">
          <Save className="w-4 h-4 mr-2" /> Save Settings
        </Button>
      </div>

      <div>
        <div className="text-xs font-sans uppercase tracking-widest text-muted-foreground">
          Card Studio
        </div>
        <h1 className="text-3xl font-serif font-bold text-primary uppercase tracking-tight mt-1">
          Brand Settings
        </h1>
        <p className="text-muted-foreground font-sans mt-1 text-sm">
          Colours, logo, fonts and footer — applied to every card preview and PNG export.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-5">
          <div>
            <div className="text-xs font-sans uppercase tracking-wider text-muted-foreground mb-2">
              Palette
            </div>
            <div className="space-y-3">
              {colorFields.map(({ key, label }) => (
                <div key={String(key)} className="flex items-center gap-3">
                  <input
                    type="color"
                    value={String(form[key] ?? "#000000")}
                    onChange={(e) => set(key, e.target.value as never)}
                    className="w-10 h-10 rounded-sm border border-border bg-transparent p-0 cursor-pointer"
                  />
                  <div className="flex-1">
                    <div className="text-sm font-sans">{label}</div>
                  </div>
                  <Input
                    value={String(form[key] ?? "")}
                    onChange={(e) => set(key, e.target.value as never)}
                    className="w-32 rounded-sm font-mono text-sm"
                  />
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs font-sans uppercase tracking-wider text-muted-foreground mb-2">
              Typography
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-muted-foreground block mb-1.5">Heading font</label>
                <Input
                  value={form.fontHeading}
                  onChange={(e) => set("fontHeading", e.target.value)}
                  className="rounded-sm"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1.5">Body font</label>
                <Input
                  value={form.fontBody}
                  onChange={(e) => set("fontBody", e.target.value)}
                  className="rounded-sm"
                />
              </div>
            </div>
          </div>

          <div>
            <div className="text-xs font-sans uppercase tracking-wider text-muted-foreground mb-2">
              Logo
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm border border-input rounded-sm px-3 h-10 cursor-pointer hover:bg-muted">
                <ImagePlus className="w-4 h-4" />
                {form.logoImage ? "Replace logo" : "Upload logo"}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => onUploadLogo(e.target.files?.[0])}
                />
              </label>
              {form.logoImage && (
                <button className="text-xs text-destructive" onClick={() => set("logoImage", null)}>
                  Remove logo
                </button>
              )}
            </div>
          </div>

          <div>
            <label className="text-xs font-sans uppercase tracking-wider text-muted-foreground block mb-1.5">
              Footer text
            </label>
            <Input
              value={form.footerText}
              onChange={(e) => set("footerText", e.target.value)}
              className="rounded-sm"
            />
          </div>
        </div>

        {/* Live brand preview */}
        <div className="lg:sticky lg:top-4 self-start">
          <div className="text-xs font-sans uppercase tracking-widest text-muted-foreground mb-2">
            Preview
          </div>
          <div className="bg-muted/40 border border-border rounded-sm p-4 flex justify-center overflow-hidden">
            <div style={{ width: CARD_WIDTH * 0.42, height: CARD_HEIGHT * 0.42, position: "relative" }}>
              <div
                style={{
                  transform: "scale(0.42)",
                  transformOrigin: "top left",
                  position: "absolute",
                  top: 0,
                  left: 0,
                }}
              >
                <MasterCard templateKey="country_risk" content={PREVIEW_CONTENT} brand={form} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
