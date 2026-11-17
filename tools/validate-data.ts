import { readFileSync } from "node:fs";
import { validateData } from "../src/domain/validate.js";

const file = process.argv[2];
if (!file) {
  console.error("Usage: validate-data <path to movies.json>");
  process.exit(2);
}

let raw: unknown;
try {
  raw = JSON.parse(readFileSync(file, "utf8")) as unknown;
} catch (error) {
  console.error(`ERROR: cannot parse ${file}: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const { errors, warnings } = validateData(raw);
for (const message of warnings) console.log(`WARNING: ${message}`);
for (const message of errors) console.error(`ERROR: ${message}`);
console.log(`${file}: ${errors.length} error(s), ${warnings.length} warning(s).`);
if (errors.length > 0) process.exit(1);
