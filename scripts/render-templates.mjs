import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const [templatePath, outputPath, replacementsJson] = process.argv.slice(2);
if (!templatePath || !outputPath || !replacementsJson) {
  throw new Error("usage: render-templates.mjs TEMPLATE OUTPUT REPLACEMENTS_JSON");
}
const replacements = JSON.parse(replacementsJson);
if (replacements === null || typeof replacements !== "object" || Array.isArray(replacements)) {
  throw new Error("replacements must be an object");
}
const resolvedOutputPath = resolve(outputPath);
try {
  const outputIdentity = await lstat(resolvedOutputPath);
  if (outputIdentity.isSymbolicLink()) throw new Error("output path must not be a symbolic link");
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
let source = await readFile(resolve(templatePath), "utf8");
for (const [key, value] of Object.entries(replacements)) {
  if (!/^__[A-Z0-9_]+__$/.test(key) || typeof value !== "string" || /[\u0000\r\n]/.test(value)) {
    throw new Error(`invalid replacement ${key}`);
  }
  source = source.split(key).join(value);
}
const unresolved = source.match(/__[A-Z0-9_]+__/g);
if (unresolved) throw new Error(`unresolved placeholders: ${[...new Set(unresolved)].join(",")}`);
await mkdir(dirname(resolvedOutputPath), { recursive: true, mode: 0o700 });
await writeFile(resolvedOutputPath, source, { mode: 0o600 });
