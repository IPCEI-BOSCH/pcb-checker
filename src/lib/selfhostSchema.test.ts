import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { generateSchema, migrationSources, sqlStatements } from "../../scripts/selfhost-schema";

describe("self-host migration parity", () => {
  it("includes every migration through 0014 and matches the generated schema", () => {
    const sources = migrationSources();
    expect(sources).toHaveLength(15);
    expect(sources.at(-1)?.name).toBe("0014_deadlines_scope_and_enforce.sql");
    const actual = readFileSync(
      new URL("../../selfhost/sql/schema.sql", import.meta.url),
      "utf8",
    ).replace(/\r\n/g, "\n");
    expect(actual).toBe(generateSchema(sources));
    for (const source of sources)
      expect(actual).toContain(`-- ==== drizzle/migrations/${source.name}`);
  });

  it("retains all tables, indexes, functions, final policies and triggers without destructive DDL", () => {
    const schema = generateSchema();
    expect(schema).toContain("CREATE TABLE IF NOT EXISTS public.deadlines");
    expect(schema).toContain("CREATE UNIQUE INDEX IF NOT EXISTS deadlines_group_uidx");
    expect(schema).toContain("FUNCTION public.enforce_submission_deadline()");
    expect(schema).toContain("CREATE TRIGGER trg_enforce_submission_deadline");
    expect(schema).toContain("ALTER POLICY deadlines_select");
    expect(schema).not.toMatch(/\bDROP (TABLE|COLUMN|POLICY|TRIGGER|INDEX)\b/i);
    expect(schema).not.toMatch(/\bADD COLUMN (?!IF NOT EXISTS)/i);
    expect(schema).not.toMatch(/\bCREATE TABLE (?!IF NOT EXISTS)/i);
    expect(schema).not.toMatch(/\bCREATE (?:UNIQUE )?INDEX (?!IF NOT EXISTS)/i);
    expect(schema).toContain("ON CONFLICT (name) DO NOTHING");
    const policies = [...schema.matchAll(/^\s*create policy (.+?) on ([\w.]+)/gim)].map(
      (m) => `${m[2]}:${m[1]}`,
    );
    expect(new Set(policies).size).toBe(policies.length);
    const sourceTables = migrationSources().flatMap((s) =>
      [...s.sql.matchAll(/create table (?:if not exists )?([\w.]+)/gi)].map((m) => m[1]),
    );
    for (const table of sourceTables)
      expect(schema.toLowerCase()).toContain(`create table if not exists ${table}`);
  });

  it("keeps quoted semicolons and function bodies intact", () => {
    expect(sqlStatements("-- comment;\nSELECT ';'; DO $$ BEGIN PERFORM 1; END $$;")).toHaveLength(
      2,
    );
    expect(() => sqlStatements("SELECT 'unterminated;")).toThrow();
  });
  it("preserves every final policy, latest function body, grant and RLS enablement", () => {
    const policies = new Map<string, string>();
    const functions = new Map<string, string>();
    const schema = generateSchema();
    for (const source of migrationSources()) {
      for (const sql of sqlStatements(source.sql)) {
        const policy = sql.match(/^create policy ("[^"]+"|\w+) on ([\w.]+)/i);
        const drop = sql.match(/^drop policy if exists ("[^"]+"|\w+) on ([\w.]+)/i);
        const fn = sql.match(/^create or replace function ([\w.]+)\(([^)]*)\)/i);
        if (policy) policies.set(`${policy[2]}:${policy[1]}`, sql);
        if (drop) policies.delete(`${drop[2]}:${drop[1]}`);
        if (fn) functions.set(`${fn[1]}(${fn[2]})`, sql);
        if (/^(grant|revoke)\b/i.test(sql) || /enable row level security$/i.test(sql)) {
          expect(schema).toContain(`${sql};`);
        }
      }
    }
    for (const sql of policies.values()) expect(schema).toContain(`${sql};`);
    for (const sql of functions.values()) expect(schema).toContain(`${sql};`);
    expect(policies.size).toBeGreaterThan(70);
  });
});
