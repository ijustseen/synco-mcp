import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const from = join(here, "../../integrations");
const to = join(here, "integrations");
mkdirSync(to, { recursive: true });
cpSync(from, to, { recursive: true });
