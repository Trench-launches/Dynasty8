// Pre-sized copies of the bundled photos and logos, served straight from Cloudflare's static
// assets. The site does not use the Next.js image optimizer (it would run every image through the
// Worker and use up the free plan's CPU), so cards load these small files instead of the originals.
//
//   node scripts/make-thumbnails.mjs
//
// Re-run after adding or replacing a photo in public/properties or public/brand.
import { readdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(import.meta.dirname, "..", "public");

async function photos(dir) {
  const files = (await readdir(path.join(root, dir))).filter((f) => /\.jpe?g$/i.test(f));
  for (const file of files) {
    const out = path.join(root, dir, file.replace(/\.jpe?g$/i, "-sm.webp"));
    await sharp(path.join(root, dir, file)).resize({ width: 720, withoutEnlargement: true }).webp({ quality: 72 }).toFile(out);
    console.log("wrote", path.relative(root, out));
  }
}

async function logo(file) {
  const out = path.join(root, "brand", file.replace(/\.png$/, "-sm.png"));
  await sharp(path.join(root, "brand", file)).resize({ width: 360 }).png({ compressionLevel: 9 }).toFile(out);
  console.log("wrote", path.relative(root, out));
}

await photos("properties");
await photos("brand");
await logo("dynasty15-logo.png");
await logo("dynasty15-logo-dark.png");
