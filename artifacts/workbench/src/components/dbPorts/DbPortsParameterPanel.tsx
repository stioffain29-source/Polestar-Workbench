import type { DbPortsParameters, DbPortsTheme } from "@workspace/api-client-react";
import {
  DB_PORTS_COUNTRIES,
  DB_PORTS_SEVERITIES,
  DB_PORTS_THEMES,
  dbPortsThemeLabel,
} from "@workspace/db-ports";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Props = {
  value: DbPortsParameters;
  onChange: (next: DbPortsParameters) => void;
  /** Present on a report, absent when editing the saved preset. */
  period?: { startDate: string; endDate: string; onEndDateChange: (endDate: string) => void };
  disabled?: boolean;
};

function lines(values: string[]): string {
  return values.join("\n");
}

function parseLines(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{label}</span>
      {children}
      {hint ? <span className="block text-[11px] text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

/** The single configuration panel. The same component edits a report's own
 * parameters and the saved default preset, so the two can never diverge. */
export default function DbPortsParameterPanel({ value, onChange, period, disabled }: Props) {
  const set = <K extends keyof DbPortsParameters>(key: K, next: DbPortsParameters[K]) =>
    onChange({ ...value, [key]: next });

  const toggleCountry = (country: string, checked: boolean) =>
    set(
      "includedCountries",
      checked
        ? [...value.includedCountries, country]
        : value.includedCountries.filter((entry) => entry !== country),
    );

  const toggleTheme = (theme: DbPortsTheme, checked: boolean) =>
    set(
      "includedThemes",
      checked
        ? [...value.includedThemes, theme]
        : value.includedThemes.filter((entry) => entry !== theme),
    );

  return (
    <div className="space-y-6" data-testid="db-ports-parameters">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Report title">
          <Input
            value={value.reportTitle}
            disabled={disabled}
            onChange={(event) => set("reportTitle", event.target.value)}
            data-testid="input-report-title"
          />
        </Field>
        <Field label="Customer name">
          <Input
            value={value.customerName}
            disabled={disabled}
            onChange={(event) => set("customerName", event.target.value)}
            data-testid="input-customer-name"
          />
        </Field>
        <Field
          label="Reporting period"
          hint={period ? `Fortnight: ${period.startDate} to ${period.endDate}` : "Set per report; a fortnight ending on the chosen date."}
        >
          <Input
            type="date"
            value={period?.endDate ?? ""}
            disabled={disabled || !period}
            onChange={(event) => period?.onEndDateChange(event.target.value)}
            data-testid="input-period-end"
          />
        </Field>
        <Field label="Publication date">
          <Input
            type="date"
            value={value.publicationDate ?? ""}
            disabled={disabled}
            onChange={(event) => set("publicationDate", event.target.value || null)}
            data-testid="input-publication-date"
          />
        </Field>
        <Field label="Target number of items" hint="10 to 15 is the normal band; the draft is never padded to reach it.">
          <Input
            type="number"
            min={1}
            max={40}
            value={value.targetItems}
            disabled={disabled}
            onChange={(event) => set("targetItems", Number(event.target.value))}
            data-testid="input-target-items"
          />
        </Field>
        <Field label="Minimum severity">
          <Select
            value={value.minimumSeverity}
            disabled={disabled}
            onValueChange={(next) => set("minimumSeverity", next as DbPortsParameters["minimumSeverity"])}
          >
            <SelectTrigger data-testid="select-minimum-severity"><SelectValue /></SelectTrigger>
            <SelectContent>
              {DB_PORTS_SEVERITIES.map((severity) => (
                <SelectItem key={severity} value={severity}>{severity}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Maximum item word count" hint="Complete items normally run 150 to 225 words.">
          <Input
            type="number"
            min={150}
            max={600}
            value={value.itemWordTarget}
            disabled={disabled}
            onChange={(event) => set("itemWordTarget", Number(event.target.value))}
            data-testid="input-item-words"
          />
        </Field>
        <Field label="Regional Overview word count" hint="150 to 250 words.">
          <Input
            type="number"
            min={150}
            max={250}
            value={value.overviewWordTarget}
            disabled={disabled}
            onChange={(event) => set("overviewWordTarget", Number(event.target.value))}
            data-testid="input-overview-words"
          />
        </Field>
      </div>

      <div>
        <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Countries and regions</div>
        <div className="mt-2 grid gap-1.5 sm:grid-cols-3 lg:grid-cols-4">
          {DB_PORTS_COUNTRIES.map((country) => (
            <label key={country} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={value.includedCountries.includes(country)}
                disabled={disabled}
                onCheckedChange={(checked) => toggleCountry(country, checked === true)}
              />
              <span>{country}</span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Included intelligence themes</div>
        <div className="mt-2 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {DB_PORTS_THEMES.map((theme) => (
            <label key={theme} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={value.includedThemes.includes(theme)}
                disabled={disabled}
                onCheckedChange={(checked) => toggleTheme(theme, checked === true)}
              />
              <span>{dbPortsThemeLabel(theme)}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Excluded regions" hint="One per line. Matched against the item's own text.">
          <Textarea
            rows={5}
            value={lines(value.excludedRegions)}
            disabled={disabled}
            onChange={(event) => set("excludedRegions", parseLines(event.target.value))}
            data-testid="input-excluded-regions"
          />
        </Field>
        <Field label="Excluded subjects" hint="One per line.">
          <Textarea
            rows={5}
            value={lines(value.excludedSubjects)}
            disabled={disabled}
            onChange={(event) => set("excludedSubjects", parseLines(event.target.value))}
            data-testid="input-excluded-subjects"
          />
        </Field>
      </div>

      <Field label="Priority ports, terminals and corridors" hint="One per line. Matching items are ranked ahead of the rest.">
        <Textarea
          rows={5}
          value={lines(value.priorityAssets)}
          disabled={disabled}
          onChange={(event) => set("priorityAssets", parseLines(event.target.value))}
          data-testid="input-priority-assets"
        />
      </Field>

      <div className="flex flex-wrap gap-6">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={value.includeWatchlist}
            disabled={disabled}
            onCheckedChange={(checked) => set("includeWatchlist", checked === true)}
            data-testid="checkbox-include-watchlist"
          />
          <span>Include Watchlist</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={value.includeSourceLinks}
            disabled={disabled}
            onCheckedChange={(checked) => set("includeSourceLinks", checked === true)}
            data-testid="checkbox-include-links"
          />
          <span>Include source hyperlinks</span>
        </label>
      </div>
    </div>
  );
}
