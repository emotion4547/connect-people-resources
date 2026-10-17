/**
 * Сверка фронтенда с базой: вызовы функций (rpc), таблицы и столбцы, которые использует код в src/,
 * должны существовать в схеме после всех миграций. Ловит опечатки в именах аргументов и столбцов,
 * которые иначе всплывают только у пользователя («функция не найдена», «нет столбца»).
 * Вызывается из db-test.mjs на той же базе PGlite.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (/\.(ts|tsx)$/.test(e.name) && !p.includes("/integrations/")) out.push(p);
  }
  return out;
}

// Вырезает объектный литерал, начинающийся в позиции i (src[i] === "{"); возвращает [текст, конец].
function braceBlock(src, i) {
  let depth = 0, q = null;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (q) { if (c === "\\") j++; else if (c === q) q = null; continue; }
    if (c === "'" || c === '"' || c === "`") { q = c; continue; }
    if (c === "{") depth++;
    if (c === "}") { depth--; if (depth === 0) return [src.slice(i, j + 1), j + 1]; }
  }
  return [src.slice(i), src.length];
}

// Ключи верхнего уровня объектного литерала и признак spread.
function topKeys(block) {
  const body = block.slice(1, -1);
  const keys = []; let spread = false;
  let depth = 0, q = null, token = "", start = true;
  const flush = () => {
    const t = token.trim();
    if (t.startsWith("...")) spread = true;
    else {
      const m = t.match(/^(?:'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$]*))\s*(?::|$)/);
      if (m) keys.push(m[1] ?? m[2] ?? m[3]);
    }
    token = "";
  };
  for (let j = 0; j < body.length; j++) {
    const c = body[j];
    if (q) { token += c; if (c === "\\") { token += body[++j] ?? ""; } else if (c === q) q = null; continue; }
    if (c === "'" || c === '"' || c === "`") { q = c; token += c; continue; }
    if ("{[(".includes(c)) depth++;
    if ("}])".includes(c)) depth--;
    if (c === "," && depth === 0) { flush(); continue; }
    token += c;
  }
  flush();
  return { keys, spread };
}

export async function checkFrontend(db) {
  const problems = [];
  const fnRows = (await db.query(`
    select p.proname, p.proargnames, p.proargmodes, p.pronargdefaults, p.pronargs
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`)).rows;
  const fns = new Map();
  for (const r of fnRows) {
    const names = r.proargnames ?? [];
    const modes = r.proargmodes ?? [];
    const inputs = names.filter((_, i) => !modes[i] || ["i", "b", "v"].includes(modes[i]));
    // Число входных без значения по умолчанию
    const required = inputs.slice(0, Math.max(0, inputs.length - r.pronargdefaults));
    const prev = fns.get(r.proname);
    // Перегрузки: берём объединение допустимых имён, обязательные — пересечение
    if (!prev) fns.set(r.proname, { inputs: new Set(inputs), required: new Set(required) });
    else { inputs.forEach((x) => prev.inputs.add(x)); for (const x of [...prev.required]) if (!required.includes(x)) prev.required.delete(x); }
  }
  const colRows = (await db.query(`
    select table_name, column_name from information_schema.columns where table_schema = 'public'`)).rows;
  const tables = new Map();
  for (const r of colRows) { if (!tables.has(r.table_name)) tables.set(r.table_name, new Set()); tables.get(r.table_name).add(r.column_name); }

  const files = await walk("src");
  for (const f of files) {
    const src = await readFile(f, "utf8");
    const rel = f;

    // Вызовы функций: любое «имя('функция', { ... })» и rpc('функция')
    for (const m of src.matchAll(/(\w+)\(\s*['"]([a-z][a-z0-9_]*)['"]\s*(?:,\s*(\{))?/g)) {
      const [, caller, name, brace] = m;
      const isRpc = caller === "rpc";
      const fn = fns.get(name);
      if (!fn) { if (isRpc) problems.push(`${rel}: rpc('${name}') — такой функции нет в базе`); continue; }
      if (!isRpc && !["run", "call", "act", "callRpc", "invoke"].includes(caller) && !brace) continue;
      if (!isRpc && !brace) continue;
      if (!brace) { if (fn.required.size) problems.push(`${rel}: rpc('${name}') без аргументов, а нужны: ${[...fn.required].join(", ")}`); continue; }
      const [block] = braceBlock(src, m.index + m[0].length - 1);
      const { keys, spread } = topKeys(block);
      for (const k of keys) if (!fn.inputs.has(k)) problems.push(`${rel}: ${name}({ ${k} }) — у функции нет аргумента «${k}» (есть: ${[...fn.inputs].join(", ")})`);
      if (!spread) for (const r of fn.required) if (!keys.includes(r)) problems.push(`${rel}: ${name}() — не передан обязательный аргумент «${r}»`);
    }

    // Таблицы и столбцы: db('таблица') ... до конца цепочки
    for (const m of src.matchAll(/\bdb\(\s*['"]([a-z_]+)['"]\s*\)/g)) {
      const table = m[1];
      const cols = tables.get(table);
      if (!cols) { problems.push(`${rel}: db('${table}') — нет такой таблицы или представления`); continue; }
      const stops = [src.indexOf(";", m.index), src.indexOf("db(", m.index + 3), src.indexOf("rpc(", m.index + 3), src.indexOf("supabase.", m.index + 3), m.index + 1500].filter((x) => x > m.index);
      const chain = src.slice(m.index, Math.min(...stops));
      for (const s of chain.matchAll(/\.select\(\s*(['"`])([^'"`]*)\1/g)) {
        if (s[2].includes("(")) continue; // связанные таблицы
        for (const part of s[2].split(",")) {
          const c = part.trim().replace(/::.*$/, "").replace(/^[^:]+:/, "");
          if (!c || c === "*" || /[^a-z0-9_]/.test(c)) continue;
          if (!cols.has(c)) problems.push(`${rel}: db('${table}').select — нет столбца «${c}»`);
        }
      }
      for (const s of chain.matchAll(/\.(?:eq|neq|gt|gte|lt|lte|is|in|ilike|like|order|not|contains)\(\s*['"]([a-z_]+)['"]/g)) {
        if (!cols.has(s[1])) problems.push(`${rel}: db('${table}') фильтр/сортировка по «${s[1]}» — нет такого столбца`);
      }
      for (const s of chain.matchAll(/\.(insert|update|upsert)\(\s*(\{)/g)) {
        const [block] = braceBlock(chain, s.index + s[0].length - 1);
        const { keys } = topKeys(block);
        for (const k of keys) if (!cols.has(k)) problems.push(`${rel}: db('${table}').${s[1]} — нет столбца «${k}»`);
      }
    }
  }
  return [...new Set(problems)];
}
