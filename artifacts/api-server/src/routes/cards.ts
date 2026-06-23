import { Router, type IRouter } from "express";
import {
  db,
  cardDraftsTable,
  cardTemplatesTable,
  brandSettingsTable,
} from "@workspace/db";
import type {
  InsertCardDraft,
  InsertCardTemplate,
  InsertBrandSettings,
} from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import {
  CreateCardDraftBody,
  UpdateCardDraftBody,
  CreateCardTemplateBody,
  UpdateCardTemplateBody,
  UpdateBrandSettingsBody,
} from "@workspace/api-zod";
import { requireAdminToken } from "../lib/adminAuth";

const router: IRouter = Router();

const BRAND_ID = 1;

function parseId(raw: string | string[] | undefined): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const n = parseInt(v ?? "", 10);
  return Number.isNaN(n) ? -1 : n;
}

// ---------------------------------------------------------------------------
// Card drafts
// ---------------------------------------------------------------------------

router.get("/card-drafts", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(cardDraftsTable)
    .orderBy(desc(cardDraftsTable.lastEditedAt));
  res.json(rows);
});

router.get("/card-drafts/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const [row] = await db
    .select()
    .from(cardDraftsTable)
    .where(eq(cardDraftsTable.id, id));
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(row);
});

router.post("/card-drafts", requireAdminToken, async (req, res): Promise<void> => {
  const parsed = CreateCardDraftBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const insertValues = parsed.data as InsertCardDraft;
  const [row] = await db.insert(cardDraftsTable).values(insertValues).returning();
  res.status(201).json(row);
});

router.patch("/card-drafts/:id", requireAdminToken, async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const parsed = UpdateCardDraftBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const updateData = {
    ...parsed.data,
    lastEditedAt: new Date(),
  } as Partial<InsertCardDraft>;
  const [row] = await db
    .update(cardDraftsTable)
    .set(updateData)
    .where(eq(cardDraftsTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(row);
});

router.delete("/card-drafts/:id", requireAdminToken, async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  await db.delete(cardDraftsTable).where(eq(cardDraftsTable.id, id));
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Card templates
// ---------------------------------------------------------------------------

router.get("/card-templates", async (_req, res): Promise<void> => {
  // Built-ins first, then most-recently-edited saved presets.
  const rows = await db
    .select()
    .from(cardTemplatesTable)
    .orderBy(desc(cardTemplatesTable.isBuiltIn), desc(cardTemplatesTable.lastEditedAt));
  res.json(rows);
});

router.get("/card-templates/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const [row] = await db
    .select()
    .from(cardTemplatesTable)
    .where(eq(cardTemplatesTable.id, id));
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(row);
});

router.post("/card-templates", requireAdminToken, async (req, res): Promise<void> => {
  const parsed = CreateCardTemplateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  // Analyst-saved presets are never built-in (built-ins are seeded on boot).
  const insertValues = { ...parsed.data, isBuiltIn: false } as InsertCardTemplate;
  const [row] = await db
    .insert(cardTemplatesTable)
    .values(insertValues)
    .returning();
  res.status(201).json(row);
});

router.patch("/card-templates/:id", requireAdminToken, async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const parsed = UpdateCardTemplateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const updateData = {
    ...parsed.data,
    lastEditedAt: new Date(),
  } as Partial<InsertCardTemplate>;
  const [row] = await db
    .update(cardTemplatesTable)
    .set(updateData)
    .where(eq(cardTemplatesTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(row);
});

router.delete("/card-templates/:id", requireAdminToken, async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  // Protect the seeded built-in presets from deletion.
  const [existing] = await db
    .select()
    .from(cardTemplatesTable)
    .where(eq(cardTemplatesTable.id, id));
  if (existing?.isBuiltIn) {
    res.status(400).json({ error: "Built-in templates cannot be deleted" });
    return;
  }
  await db.delete(cardTemplatesTable).where(eq(cardTemplatesTable.id, id));
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Brand settings (singleton, id = 1)
// ---------------------------------------------------------------------------

async function ensureBrandSettings() {
  const [existing] = await db
    .select()
    .from(brandSettingsTable)
    .where(eq(brandSettingsTable.id, BRAND_ID));
  if (existing) return existing;
  const [created] = await db
    .insert(brandSettingsTable)
    .values({ id: BRAND_ID } as InsertBrandSettings)
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const [row] = await db
    .select()
    .from(brandSettingsTable)
    .where(eq(brandSettingsTable.id, BRAND_ID));
  return row;
}

router.get("/brand-settings", async (_req, res): Promise<void> => {
  const row = await ensureBrandSettings();
  res.json(row);
});

router.put("/brand-settings", requireAdminToken, async (req, res): Promise<void> => {
  const parsed = UpdateBrandSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  await ensureBrandSettings();
  const updateData = {
    ...parsed.data,
    updatedAt: new Date(),
  } as Partial<InsertBrandSettings>;
  const [row] = await db
    .update(brandSettingsTable)
    .set(updateData)
    .where(eq(brandSettingsTable.id, BRAND_ID))
    .returning();
  res.json(row);
});

export default router;
