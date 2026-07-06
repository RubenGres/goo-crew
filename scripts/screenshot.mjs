#!/usr/bin/env node
// Smoke-check STAR SLOP in a headless browser: boot a dev server, start a solo
// run, force a fight, and capture screenshots (menu, combat, close-up).
//   node star-slop/scripts/screenshot.mjs
// Outputs to star-slop/screenshots/ (gitignored). Set CHROME to override the
// browser binary; defaults to the Playwright chromium if present.

import puppeteer from "puppeteer-core";
import { spawn } from "child_process";
import { mkdir } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "..");
const OUT = path.join(__dirname, "..", "screenshots");
const PORT = 5177;
const CHROME =
  process.env.CHROME ||
  ["/opt/pw-browsers/chromium", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find(existsSync);

if (!CHROME) {
  console.error("No Chrome/Chromium found; set CHROME=/path/to/chrome");
  process.exit(1);
}
await mkdir(OUT, { recursive: true });

const server = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], {
  cwd: ROOT,
  stdio: ["ignore", "pipe", "pipe"],
});
await new Promise((res, rej) => {
  server.stdout.on("data", (d) => d.toString().includes("localhost") && res());
  setTimeout(() => rej(new Error("vite start timeout")), 20000);
});

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--mute-audio"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 760 });
const errors = [];
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
page.on("console", (m) => {
  if (m.type() === "error" && !m.text().includes("404")) errors.push("CONSOLE: " + m.text().slice(0, 300));
});

await page.goto(`http://localhost:${PORT}/star-slop/`, { waitUntil: "networkidle0", timeout: 30000 });
await new Promise((r) => setTimeout(r, 2000));
await page.screenshot({ path: `${OUT}/menu.png` });

await page.click("#btn-solo");
await new Promise((r) => setTimeout(r, 3500));

await page.evaluate(() => window.__slop.debugCombat("raider"));
await new Promise((r) => setTimeout(r, 8000));
await page.evaluate(() => {
  window.__slop.send({ k: "wtarget", wi: 0, room: "shields" });
  window.__slop.send({ k: "wtarget", wi: 1, room: "weapons" });
});
await new Promise((r) => setTimeout(r, 9000));
await page.screenshot({ path: `${OUT}/combat.png` });

await page.evaluate(() => {
  const e = window.__slop.engine;
  e.camBase.set(-4.2, 3.4, 4.6);
  e.camLook.set(-4.2, 0.4, 0.4);
});
await new Promise((r) => setTimeout(r, 1500));
await page.screenshot({ path: `${OUT}/closeup.png` });

console.log("screenshots in", OUT);
console.log("ERRORS:", errors.length ? errors.join("\n---\n") : "none");
await browser.close();
server.kill();
process.exit(errors.length ? 1 : 0);
