// Shapes of config/outlets.json and config/stack.json. The API loads and validates them at startup.
import { z } from "zod";
import { FEED_IDS, FEEDS, type FeedId } from "./feeds.ts";

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "must be a kebab-case slug").max(60);
const domain = z
  .string()
  .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/, "must be a lowercase host name");

export const outletSchema = z
  .object({
    slug,
    name: z.string().min(1).max(100),
    aliases: z.array(z.string().min(1).max(100)).default([]),
    domains: z.array(domain).default([]),
    feeds: z.array(z.enum(FEED_IDS)).min(1),
    /** Coverage group per feed (must be one of that feed's groups). */
    group: z.partialRecord(z.enum(FEED_IDS), z.string()),
    /** Free-text lean or kind from the prompt's outlet map, e.g. "center-right", "alternative", "fact-check". */
    lean: z.string().max(60).optional(),
  })
  .strict()
  .superRefine((o, ctx) => {
    for (const feed of o.feeds) {
      const g = o.group[feed];
      if (!g) {
        ctx.addIssue({ code: "custom", message: `missing group for feed ${feed}`, path: ["group", feed] });
      } else if (!FEEDS[feed].coverageGroups.some((cg) => cg.id === g)) {
        ctx.addIssue({ code: "custom", message: `unknown group ${g} for feed ${feed}`, path: ["group", feed] });
      }
    }
  });

export const outletsFileSchema = z
  .object({ outlets: z.array(outletSchema) })
  .strict()
  .superRefine((f, ctx) => {
    const seen = new Set<string>();
    const domains = new Map<string, string>();
    f.outlets.forEach((o, i) => {
      if (seen.has(o.slug)) ctx.addIssue({ code: "custom", message: `duplicate slug ${o.slug}`, path: ["outlets", i] });
      seen.add(o.slug);
      for (const d of o.domains) {
        const prev = domains.get(d);
        if (prev) ctx.addIssue({ code: "custom", message: `domain ${d} used by ${prev} and ${o.slug}`, path: ["outlets", i] });
        domains.set(d, o.slug);
      }
    });
  });

export type OutletConfig = z.infer<typeof outletSchema>;
export type OutletsFile = z.infer<typeof outletsFileSchema>;

const regexString = z.string().refine((s) => {
  try {
    new RegExp(s, "iu");
    return true;
  } catch {
    return false;
  }
}, "must be a valid regular expression");

export const stackAliasSchema = z.union([
  z.string().min(1),
  z
    .object({
      text: z.string().min(1),
      case_sensitive: z.boolean().optional(),
      /** At least one of these regexes must match near the alias (± context_window chars). */
      context: z.array(regexString).optional(),
    })
    .strict(),
]);

export const stackEntrySchema = z
  .object({
    slug,
    name: z.string().min(1),
    aliases: z.array(stackAliasSchema).min(1),
    case_sensitive: z.boolean().default(false),
    context: z.array(regexString).optional(),
    /** Spans matching these regexes are ignored (e.g. "sudo apt ..." shell commands). */
    exclude: z.array(regexString).default([]),
    note: z.string().optional(),
  })
  .strict();

export const stackFileSchema = z
  .object({
    context_window: z.number().int().min(10).max(500).default(80),
    software: z.array(stackEntrySchema).min(1),
  })
  .strict()
  .superRefine((f, ctx) => {
    const seen = new Set<string>();
    f.software.forEach((s, i) => {
      if (seen.has(s.slug)) ctx.addIssue({ code: "custom", message: `duplicate slug ${s.slug}`, path: ["software", i] });
      seen.add(s.slug);
    });
  });

export type StackEntry = z.infer<typeof stackEntrySchema>;
export type StackFile = z.infer<typeof stackFileSchema>;

function formatIssues(name: string, error: z.ZodError): string {
  return `${name}: ` + error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
}

export function parseOutletsFile(raw: unknown): OutletsFile {
  const r = outletsFileSchema.safeParse(raw);
  if (!r.success) throw new Error(formatIssues("outlets.json", r.error));
  return r.data;
}

export function parseStackFile(raw: unknown): StackFile {
  const r = stackFileSchema.safeParse(raw);
  if (!r.success) throw new Error(formatIssues("stack.json", r.error));
  return r.data;
}

export function outletGroup(o: OutletConfig, feed: FeedId): string | undefined {
  return o.group[feed];
}
