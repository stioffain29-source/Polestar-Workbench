import { Link, useLocation } from "wouter";
import {
  useListCardDrafts,
  useDeleteCardDraft,
  getListCardDraftsQueryKey,
  type CardDraft,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArrowRight, Plus, Trash2, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cardRatingColor, cardRatingTextColor, cardRatingLabel, templateMeta } from "@/lib/cardTemplates";

export default function Cards() {
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const { data: drafts = [] } = useListCardDrafts();
  const del = useDeleteCardDraft();

  const invalidate = () => qc.invalidateQueries({ queryKey: getListCardDraftsQueryKey() });

  return (
    <div className="max-w-[1600px] mx-auto space-y-5">
      <div className="flex items-end justify-between">
        <div>
          <div className="text-xs font-sans uppercase tracking-widest text-muted-foreground">
            Card Studio
          </div>
          <h1 className="text-3xl font-serif font-bold text-primary uppercase tracking-tight mt-1">
            Infographic Cards
          </h1>
          <p className="text-muted-foreground font-sans mt-1 text-sm">
            Template-driven 1080×1350 social cards, exported as PNG
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setLocation("/card-settings")} className="rounded-sm">
            <Settings className="w-4 h-4 mr-2" /> Brand Settings
          </Button>
          <Button
            onClick={() => setLocation("/card-builder/new")}
            className="bg-accent hover:bg-accent/90 text-accent-foreground rounded-sm"
          >
            <Plus className="w-4 h-4 mr-2" /> New Card
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {drafts.length === 0 && (
          <div className="text-sm text-muted-foreground">No cards yet.</div>
        )}
        {drafts.map((d) => (
          <CardTile
            key={d.id}
            draft={d}
            onDelete={() => {
              if (confirm("Delete card?")) {
                del.mutate({ id: d.id }, { onSuccess: invalidate });
              }
            }}
          />
        ))}
      </div>
    </div>
  );
}

function CardTile({ draft: d, onDelete }: { draft: CardDraft; onDelete: () => void }) {
  const meta = templateMeta(d.templateKey);
  const rating = d.content?.rating;
  return (
    <div className="bg-card border border-border rounded-sm p-5 group">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span className="px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-sm bg-secondary text-secondary-foreground">
            {meta.name}
          </span>
          {rating && (
            <span
              className="px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-sm"
              style={{ background: cardRatingColor(rating), color: cardRatingTextColor(rating) }}
            >
              {cardRatingLabel(rating)}
            </span>
          )}
        </div>
        <button onClick={onDelete} className="text-muted-foreground hover:text-destructive">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      <Link href={`/card-builder/${d.id}`} className="block mt-3">
        <h2 className="font-serif font-bold text-lg text-primary group-hover:text-accent transition-colors">
          {d.title}
        </h2>
        {(d.content?.headline || d.content?.country) && (
          <div className="text-xs text-muted-foreground mt-1 font-sans">
            {d.content?.country}
            {d.content?.country && d.content?.headline ? " · " : ""}
            {d.content?.headline}
          </div>
        )}
      </Link>

      <div className="text-xs text-muted-foreground mt-2 font-mono">
        {format(new Date(d.lastEditedAt), "d MMM yyyy, HH:mm")}
      </div>

      <Link href={`/card-builder/${d.id}`}>
        <div className="mt-4 pt-3 border-t border-border text-xs font-sans uppercase tracking-wider text-accent inline-flex items-center gap-1 group-hover:gap-2 transition-all">
          Open Builder <ArrowRight className="w-3.5 h-3.5" />
        </div>
      </Link>
    </div>
  );
}
