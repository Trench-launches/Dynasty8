// Runs a database task (migrate | seed), except on Cloudflare Workers Builds of a NON-production
// branch. Workers Builds runs the same build command (`npm run db:migrate && npm run db:seed &&
// npm run build:cf`) for every pushed branch, with the production DATABASE_URL as a build
// variable, so without this guard a pull-request branch would migrate and seed the PRODUCTION
// database. Outside Workers Builds (local, Node hosts) the task always runs.
//
//   node scripts/db-task.mjs migrate   -> prisma migrate deploy
//   node scripts/db-task.mjs seed      -> tsx prisma/seed.ts
//
// PRODUCTION_BRANCH (default "main") names the branch whose builds may touch the database.
import { spawnSync } from "node:child_process";

const task = process.argv[2];
const commands = {
  migrate: ["prisma", ["migrate", "deploy"]],
  seed: ["tsx", ["--env-file-if-exists=.env", "prisma/seed.ts"]],
};
if (!commands[task]) {
  console.error("usage: node scripts/db-task.mjs <migrate|seed>");
  process.exit(2);
}

const ciBranch = process.env.WORKERS_CI === "1" || process.env.WORKERS_CI_BRANCH ? process.env.WORKERS_CI_BRANCH ?? "" : null;
const production = process.env.PRODUCTION_BRANCH || "main";
if (ciBranch !== null && ciBranch !== production) {
  console.log(`[db-task] Skipping "${task}": Workers Builds branch "${ciBranch || "(unknown)"}" is not "${production}". Only ${production} builds change the database.`);
  process.exit(0);
}

const [bin, args] = commands[task];
const r = spawnSync("npx", ["--no-install", bin, ...args], { stdio: "inherit", shell: process.platform === "win32" });
process.exit(r.status ?? 1);
