import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import type { TestProject } from "vitest/node";

/**
 * Starts a throwaway PostgreSQL (embedded-postgres), applies every Prisma migration from
 * scratch with `prisma migrate deploy`, and exposes the URL to tests. Torn down afterwards.
 */
export default async function setup(project: TestProject) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "d8-pg-"));
  const port = 55000 + Math.floor(Math.random() * 2000);
  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    user: "d8test",
    password: "d8test",
    port,
    persistent: false,
    onLog: () => {},
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("d8test");
  const url = `postgresql://d8test:d8test@127.0.0.1:${port}/d8test`;
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
  project.provide("databaseUrl", url);

  return async () => {
    await pg.stop();
    rmSync(dir, { recursive: true, force: true });
  };
}

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}
