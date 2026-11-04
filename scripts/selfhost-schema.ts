import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));

/** Split statements, keeping function bodies and quoted semicolons intact. */
export function sqlStatements(sql: string): string[] {
  const result: string[] = [];
  let text = "",
    quote = "",
    dollar = "",
    comment = false,
    block = 0;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i]!,
      next = sql[i + 1];
    if (comment) {
      if (c === "\n") {
        comment = false;
        text += "\n";
      }
      continue;
    }
    if (block) {
      if (c === "/" && next === "*") {
        block++;
        i++;
      } else if (c === "*" && next === "/") {
        block--;
        i++;
      }
      continue;
    }
    if (dollar) {
      if (sql.startsWith(dollar, i)) {
        text += dollar;
        i += dollar.length - 1;
        dollar = "";
      } else text += c;
      continue;
    }
    if (quote) {
      text += c;
      if (c === quote) {
        if (next === quote) {
          text += next;
          i++;
        } else quote = "";
      }
      continue;
    }
    if (c === "-" && next === "-") {
      comment = true;
      i++;
      text += " ";
      continue;
    }
    if (c === "/" && next === "*") {
      block = 1;
      i++;
      text += " ";
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      text += c;
      continue;
    }
    if (c === "$") {
      const tag = sql.slice(i).match(/^\$(?:[A-Za-z_]\w*)?\$/)?.[0];
      if (tag) {
        dollar = tag;
        text += tag;
        i += tag.length - 1;
        continue;
      }
    }
    if (c === ";") {
      if (text.trim()) result.push(text.trim());
      text = "";
    } else text += c;
  }
  if (quote || dollar || block || text.trim()) throw new Error("Incomplete SQL statement");
  return result;
}

const literal = (s: string) => `'${s.replace(/'/g, "''")}'`;
const unquote = (s: string) => s.replace(/^"|"$/g, "").replace(/""/g, '"');
const identifier = '("[^"]+"|\\w+)';
const policyRe = new RegExp(
  `^create policy ${identifier} on ([\\w.]+)\\s+for (all|select|insert|update|delete)\\s+to (\\w+)\\s+([\\s\\S]+)$`,
  "i",
);
const triggerRe = new RegExp(`^create trigger ${identifier}\\s+[\\s\\S]+?\\bon ([\\w.]+)\\s+`, "i");

export function migrationSources(directory = resolve(root, "drizzle/migrations")) {
  return readdirSync(directory)
    .filter((name) => /^\d{4}.*\.sql$/.test(name))
    .sort()
    .map((name) => ({
      name,
      sql: readFileSync(resolve(directory, name), "utf8").replace(/\r\n/g, "\n"),
    }));
}

export function generateSchema(sources = migrationSources()): string {
  const sections: string[] = [];
  const policies = new Map<string, string>();
  const triggers = new Map<string, string>();
  for (const source of sources) {
    const statements: string[] = [];
    for (let sql of sqlStatements(source.sql)) {
      if (/^create policy /i.test(sql)) {
        const m = sql.match(policyRe);
        if (!m) throw new Error(`Unsupported policy: ${source.name}`);
        policies.set(`${m[2]}.${m[1]}`, sql);
        continue;
      }
      if (/^drop policy /i.test(sql)) {
        const m = sql.match(new RegExp(`^drop policy if exists ${identifier} on ([\\w.]+)$`, "i"));
        if (!m) throw new Error(`Unsupported policy drop: ${source.name}`);
        policies.delete(`${m[2]}.${m[1]}`);
        continue;
      }
      if (/^create trigger /i.test(sql)) {
        const m = sql.match(triggerRe);
        if (!m) throw new Error(`Unsupported trigger: ${source.name}`);
        triggers.set(`${m[2]}.${m[1]}`, sql);
        continue;
      }
      if (/^drop trigger /i.test(sql)) {
        const m = sql.match(new RegExp(`^drop trigger if exists ${identifier} on ([\\w.]+)$`, "i"));
        if (!m) throw new Error(`Unsupported trigger drop: ${source.name}`);
        triggers.delete(`${m[2]}.${m[1]}`);
        continue;
      }
      if (/^create type /i.test(sql)) {
        const type = sql.match(/^create type ([\w.]+) as enum/i)?.[1];
        if (!type) throw new Error(`Unsupported type: ${source.name}`);
        sql = `DO $schema$\nBEGIN\n  IF to_regtype(${literal(type)}) IS NULL THEN\n    ${sql};\n  END IF;\nEND\n$schema$`;
      }
      sql = sql
        .replace(/^create table (?!if not exists)/i, "CREATE TABLE IF NOT EXISTS ")
        .replace(
          /^create (unique )?index (?!if not exists)/i,
          (_, unique: string | undefined) => `CREATE ${unique ?? ""}INDEX IF NOT EXISTS `,
        )
        .replace(/\bADD COLUMN (?!IF NOT EXISTS)/gi, "ADD COLUMN IF NOT EXISTS ");
      if (/^insert into public\.academic_years/i.test(sql)) sql += " ON CONFLICT (name) DO NOTHING";
      if (/^drop\b|^truncate\b|^delete\b|\bdrop column\b/i.test(sql))
        throw new Error(`Non-additive SQL: ${source.name}`);
      statements.push(`${sql};`);
    }
    sections.push(`-- ==== drizzle/migrations/${source.name}\n${statements.join("\n\n")}`);
  }
  const finalPolicies = [...policies.values()].map((sql) => {
    const m = sql.match(policyRe)!;
    const [schema, table] = m[2]!.split(".");
    return `DO $schema$\nBEGIN\n  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = ${literal(schema!)} AND tablename = ${literal(table!)} AND policyname = ${literal(unquote(m[1]!))}) THEN\n    ALTER POLICY ${m[1]} ON ${m[2]} TO ${m[4]} ${m[5]};\n  ELSE\n    ${sql};\n  END IF;\nEND\n$schema$;`;
  });
  const finalTriggers = [...triggers.values()].map((sql) => {
    const m = sql.match(triggerRe)!;
    return `DO $schema$\nBEGIN\n  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = ${literal(m[2]!)}::regclass AND tgname = ${literal(unquote(m[1]!))} AND NOT tgisinternal) THEN\n    ${sql};\n  END IF;\nEND\n$schema$;`;
  });
  return `-- PCB Checker: generated from drizzle/migrations. Do not edit by hand.\n-- Regenerate: bun run schema:selfhost\n-- Requires the Supabase auth/storage schemas and roles (not bare PostgreSQL).\n-- Additive replay: final RLS policies are updated without dropping tables or data.\nBEGIN;\n\n${sections.join("\n\n")}\n\n-- Final policy state (including policy replacements in historical migrations).\n${finalPolicies.join("\n\n")}\n\n-- Triggers are installed once; their functions above use CREATE OR REPLACE.\n${finalTriggers.join("\n\n")}\n\nCOMMIT;\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const destination = resolve(root, "selfhost/sql/schema.sql");
  const sql = generateSchema();
  if (process.argv.includes("--check")) {
    if (readFileSync(destination, "utf8").replace(/\r\n/g, "\n") !== sql) {
      throw new Error("Schema self-host neactualizată. Rulează bun run schema:selfhost.");
    }
  } else writeFileSync(destination, sql, "utf8");
}
