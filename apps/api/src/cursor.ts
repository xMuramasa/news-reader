// Opaque keyset cursors: base64url JSON of the last item's sort values plus the sort's name, so a cursor can't be
// replayed against a different ordering. Values are type-checked on the way back in.
import type { Document } from "mongodb";
import { badRequest } from "./http.ts";

export interface SortKey {
  field: string;
  dir: 1 | -1;
  type: "string" | "date" | "int";
}

export interface SortSpec {
  name: string;
  keys: SortKey[];
}

export const EDITIONS_SORT: SortSpec = {
  name: "editions",
  keys: [
    { field: "run_at", dir: -1, type: "date" },
    { field: "_id", dir: -1, type: "string" },
  ],
};

export const STORIES_SORT: Record<"newest" | "oldest", SortSpec> = {
  newest: {
    name: "stories-newest",
    keys: [
      { field: "sort_date", dir: -1, type: "string" },
      { field: "run_at", dir: -1, type: "date" },
      { field: "position", dir: 1, type: "int" },
      { field: "_id", dir: 1, type: "string" },
    ],
  },
  oldest: {
    name: "stories-oldest",
    keys: [
      { field: "sort_date", dir: 1, type: "string" },
      { field: "run_at", dir: 1, type: "date" },
      { field: "position", dir: 1, type: "int" },
      { field: "_id", dir: 1, type: "string" },
    ],
  },
};

export const FAVORITES_SORT: SortSpec = {
  name: "favorites",
  keys: [
    { field: "created_at", dir: -1, type: "date" },
    { field: "_id", dir: 1, type: "string" },
  ],
};

type Value = string | number | Date;

export function mongoSort(spec: SortSpec): Record<string, 1 | -1> {
  return Object.fromEntries(spec.keys.map((k) => [k.field, k.dir]));
}

function get(doc: Document, field: string): unknown {
  return doc[field];
}

export function encodeCursor(spec: SortSpec, doc: Document): string {
  const v = spec.keys.map((k) => {
    const x = get(doc, k.field);
    return x instanceof Date ? x.toISOString() : x;
  });
  return Buffer.from(JSON.stringify({ s: spec.name, v })).toString("base64url");
}

export function decodeCursor(spec: SortSpec, cursor: string): Value[] {
  const invalid = () => badRequest("invalid cursor");
  if (cursor.length > 1000 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw invalid();
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw invalid();
  }
  const p = parsed as { s?: unknown; v?: unknown };
  if (!p || p.s !== spec.name || !Array.isArray(p.v) || p.v.length !== spec.keys.length) throw invalid();
  return spec.keys.map((k, i) => {
    const x = (p.v as unknown[])[i];
    if (k.type === "int") {
      if (typeof x !== "number" || !Number.isInteger(x)) throw invalid();
      return x;
    }
    if (typeof x !== "string" || x.length > 200) throw invalid();
    if (k.type === "date") {
      const d = new Date(x);
      if (Number.isNaN(d.getTime())) throw invalid();
      return d;
    }
    return x;
  });
}

/** Filter for "strictly after the cursor" in the given ordering. */
export function afterCursor(spec: SortSpec, values: Value[]): Document {
  const or: Document[] = spec.keys.map((k, i) => {
    const clause: Document = {};
    for (let j = 0; j < i; j++) clause[spec.keys[j]!.field] = values[j];
    clause[k.field] = { [k.dir === 1 ? "$gt" : "$lt"]: values[i] };
    return clause;
  });
  return { $or: or };
}
