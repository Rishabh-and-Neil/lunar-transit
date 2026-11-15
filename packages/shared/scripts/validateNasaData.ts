/**
 * Validates the bundled NASA educational content.
 * Run from the repo root:  npx tsx packages/shared/scripts/validateNasaData.ts
 */
import { z } from "zod";
import nasaSources from "../src/data/nasaSources.json";
import nasaFacts from "../src/data/nasaFacts.json";
import education from "../src/data/education.json";
import { ATTACHMENT_IDS } from "../src/config/attachments";
import { LUNAR_TASKS } from "../src/tasks/definitions";

// The shared package compiles without Node typings; declare the one global we use.
declare const process: { exitCode?: number };

const REQUIRED_SOURCE_IDS = [
  "design-science-missions",
  "gmat",
  "concept-maturity-levels",
  "mission-design-lab",
  "nasa-mission-viz",
  "telescope-learning-game",
  "cubesat-101",
  "vr-space-mission",
  "nasa-digital-games",
] as const;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const kebabId = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "expected kebab-case id");

const SourceSchema = z
  .object({
    id: kebabId,
    title: z.string().min(3),
    sourceType: z.enum(["pdf", "web", "text", "software"]),
    officialUrl: z
      .string()
      .url()
      .refine((u) => u.startsWith("https://"), "officialUrl must be https")
      .optional(),
    localReference: z.string().min(3).optional(),
    version: z.string().min(1).optional(),
    accessedOn: isoDate.optional(),
  })
  .strict()
  .refine((s) => s.officialUrl !== undefined || s.localReference !== undefined, {
    message: "a source needs an officialUrl or a localReference",
  });

const FactSchema = z
  .object({
    id: kebabId,
    title: z.string().min(3).max(60),
    text: z.string().min(20).max(320),
    topic: z.enum(["mission-design", "propulsion", "power", "shielding", "navigation", "lunar-science"]),
    sourceIds: z.array(kebabId).min(1),
    sourceLocations: z.array(z.string().min(3)).min(1),
  })
  .strict();

const EducationSchema = z
  .object({
    attachmentId: z.enum(["repair-drone", ...ATTACHMENT_IDS]),
    explanation: z.string().min(20),
    realWorldPrinciple: z.string().min(20),
    gameplayAbstraction: z.string().min(20),
    sourceIds: z.array(kebabId),
  })
  .strict();

const errors: string[] = [];
const warnings: string[] = [];

function parse<T>(label: string, schema: z.ZodType<T>, data: unknown): T | null {
  const res = schema.safeParse(data);
  if (!res.success) {
    for (const issue of res.error.issues) errors.push(`${label}: ${issue.path.join(".")} ${issue.message}`);
    return null;
  }
  return res.data;
}

const sources = parse("nasaSources.json", z.array(SourceSchema), nasaSources);
const facts = parse("nasaFacts.json", z.array(FactSchema).min(24).max(32), nasaFacts);
const edu = parse("education.json", z.array(EducationSchema), education);

function dupes(ids: string[]): string[] {
  const seen = new Set<string>();
  const d = new Set<string>();
  for (const id of ids) (seen.has(id) ? d : seen).add(id);
  return [...d];
}

if (sources) {
  const ids = new Set(sources.map((s) => s.id));
  for (const d of dupes(sources.map((s) => s.id))) errors.push(`duplicate source id ${d}`);
  for (const r of REQUIRED_SOURCE_IDS) if (!ids.has(r)) errors.push(`missing required source ${r}`);
  for (const s of sources) {
    if (!(REQUIRED_SOURCE_IDS as readonly string[]).includes(s.id)) errors.push(`unexpected source ${s.id} (only the nine approved resources are allowed)`);
    if (!s.officialUrl) warnings.push(`source ${s.id} has no confirmed officialUrl`);
  }

  const checkRefs = (label: string, refs: string[]) => {
    for (const r of refs) if (!ids.has(r)) errors.push(`${label} references unknown source ${r}`);
  };

  if (facts) {
    for (const d of dupes(facts.map((f) => f.id))) errors.push(`duplicate fact id ${d}`);
    for (const f of facts) checkRefs(`fact ${f.id}`, f.sourceIds);
    const topics = new Set(facts.map((f) => f.topic));
    for (const t of ["mission-design", "propulsion", "power", "shielding", "navigation", "lunar-science"]) {
      if (!topics.has(t as (typeof facts)[number]["topic"])) errors.push(`no fact covers topic ${t}`);
    }
  }

  if (edu) {
    for (const e of edu) checkRefs(`education ${e.attachmentId}`, e.sourceIds);
    for (const d of dupes(edu.map((e) => e.attachmentId))) errors.push(`duplicate education entry ${d}`);
    const covered = new Set<string>(edu.map((e) => e.attachmentId));
    for (const a of [...ATTACHMENT_IDS, "repair-drone"]) if (!covered.has(a)) errors.push(`attachment ${a} has no education entry`);
  }

  for (const t of Object.values(LUNAR_TASKS)) checkRefs(`task ${t.id}`, t.sourceIds);
}

for (const w of warnings) console.warn(`warn: ${w}`);
if (errors.length > 0) {
  for (const e of errors) console.error(`error: ${e}`);
  console.error(`\nNASA data validation FAILED (${errors.length} error(s)).`);
  process.exitCode = 1;
} else {
  console.log(
    `NASA data OK: ${sources?.length ?? 0} sources, ${facts?.length ?? 0} facts, ${edu?.length ?? 0} education entries.`,
  );
}
