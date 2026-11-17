/**
 * Local PostgreSQL for development and tests, using the `embedded-postgres` npm package
 * (real PostgreSQL binaries, no Docker or system install needed).
 *
 *   node scripts/local-postgres.mjs            # start, keep running (Ctrl+C to stop)
 *   PGPORT=54330 PGDATA_DIR=.data/pg-test ...  # alternate instance
 *
 * Creates databases `dynasty8` and `dynasty8_test`. Local-only credentials; never use in production.
 */
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import path from "node:path";

const port = Number(process.env.PGPORT ?? 54329);
const dataDir = path.resolve(process.env.PGDATA_DIR ?? ".data/pg");
const fresh = !existsSync(path.join(dataDir, "PG_VERSION"));

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "dynasty8",
  password: "dynasty8-local-only",
  port,
  persistent: true,
  onLog: () => {},
});

if (fresh) await pg.initialise();
await pg.start();
for (const db of ["dynasty8", "dynasty8_test"]) {
  try {
    await pg.createDatabase(db);
  } catch {
    /* already exists */
  }
}
console.log(`postgres ready on 127.0.0.1:${port} (databases: dynasty8, dynasty8_test)`);

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
setInterval(() => {}, 1 << 30);
