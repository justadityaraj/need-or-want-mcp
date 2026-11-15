import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function defaultDir(): string {
  return process.env.NEED_OR_WANT_HOME ?? join(homedir(), ".need-or-want");
}

export class Store {
  constructor(readonly dir: string = defaultDir()) {
    mkdirSync(dir, { recursive: true });
  }

  private file(name: string): string {
    return join(this.dir, name);
  }

  exists(name: string): boolean {
    return existsSync(this.file(name));
  }

  readJson<T>(name: string, fallback: T): T {
    if (!this.exists(name)) return fallback;
    return JSON.parse(readFileSync(this.file(name), "utf8")) as T;
  }

  writeJson(name: string, value: unknown): void {
    const tmp = this.file(`${name}.tmp`);
    writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
    renameSync(tmp, this.file(name));
  }

  append(name: string, value: unknown): void {
    appendFileSync(this.file(name), `${JSON.stringify(value)}\n`);
  }

  readLines<T>(name: string): { items: T[]; skipped: number } {
    if (!this.exists(name)) return { items: [], skipped: 0 };
    const items: T[] = [];
    let skipped = 0;
    for (const line of readFileSync(this.file(name), "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        items.push(JSON.parse(line) as T);
      } catch {
        skipped++;
      }
    }
    return { items, skipped };
  }
}
