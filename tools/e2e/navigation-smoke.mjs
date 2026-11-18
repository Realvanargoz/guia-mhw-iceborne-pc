// Smoke test de navegación SPA: hace clic en enlaces (sin page.goto) y detecta pantallas en blanco/errores.
// Uso: npm i && node navigation-smoke.mjs [baseUrl] [--fest]   (env CHROME=ruta a chrome.exe, SHOTS=carpeta capturas)
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = process.argv.find((a) => a.startsWith("http")) ?? "http://localhost:8080";
const FEST = process.argv.includes("--fest");
const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const SHOTS = process.env.SHOTS ?? path.join(os.tmpdir(), "mhw-e2e-shots");
fs.mkdirSync(SHOTS, { recursive: true });
const NAV = ["Monstruos", "Materiales", "Armaduras", "Armas", "Superpuestas", "Logros", "Mapas", "Misiones", "Eventos", "Calendario", "Bestiario", "Guías"];
const PER_LIST = 2, DEPTH_LINKS = 1;

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: "new", defaultViewport: { width: 1360, height: 900 },
  userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), "mhw-e2e-")),
});
const page = await browser.newPage();
const problems = [];
let visited = 0, current = "";
const note = (kind, msg) => problems.push({ at: current, kind, msg: String(msg).slice(0, 900) });
page.on("pageerror", (e) => note("pageerror", e.stack));
page.on("console", (m) => { if (m.type() === "error") note("console", m.text()); });
page.on("response", (r) => { if (r.status() >= 400 && r.url().startsWith(BASE)) note("http" + r.status(), r.url()); });
page.on("requestfailed", (r) => { if (r.url().startsWith(BASE) && !r.failure()?.errorText.includes("ABORTED")) note("reqfailed", r.url()); });

if (FEST) await page.evaluateOnNewDocument(() => localStorage.setItem("mhw.fest", "1"));

async function settle(label) {
  current = label;
  const t0 = Date.now();
  await page.waitForNetworkIdle({ idleTime: 300, timeout: 20000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 150));
  const s = await page.evaluate(() => {
    const m = document.querySelector("main.main");
    return {
      root: document.getElementById("root")?.children.length ?? 0,
      text: m?.innerText.trim().length ?? -1,
      h: m?.getBoundingClientRect().height ?? 0,
      err: !!document.querySelector(".errorbox, .error"),
      loading: !!document.querySelector(".loading"),
      path: location.pathname,
    };
  });
  visited++; if (process.env.VERBOSE) console.log(visited, label, Date.now() - t0, "ms");
  const bad = s.root === 0 || s.text < 20 || s.h < 100 || s.loading || (s.err && !/not found/i.test(""));
  if (bad) {
    note("BLANK", JSON.stringify(s));
    await page.screenshot({ path: path.join(SHOTS, `blank-${visited}.png`) }).catch(() => {});
  }
  return Date.now() - t0;
}

const links = () => page.evaluate(() =>
  [...new Set([...document.querySelectorAll("main a[href^='/']")].map((a) => a.getAttribute("href")))]
    .filter((h) => !h.startsWith("/api") && !h.includes("."))
);
async function clickHref(href) {
  const ok = await page.evaluate((h) => {
    const a = [...document.querySelectorAll(`a[href='${h}']`)].find((x) => x.closest("main"));
    if (!a) return false; a.scrollIntoView(); a.click(); return true;
  }, href);
  return ok;
}
const slow = [];
async function clickNav(label) {
  await page.evaluate((l) => [...document.querySelectorAll("nav.nav a")].find((a) => a.textContent.trim() === l)?.click(), label);
  const ms = await settle(`nav:${label}`);
  return ms;
}

await page.goto(BASE, { waitUntil: "networkidle0" });
await settle("/");
const seen = new Set();
for (const label of NAV) {
  await clickNav(label);
  const listPath = await page.evaluate(() => location.pathname);
  const cand = (await links()).filter((h) => h !== listPath && !seen.has(h));
  const byKind = {};
  for (const h of cand) { const pp = h.split("/"); const k = pp[2] === "piezas" ? "/" + pp[1] + "/piezas" : "/" + pp[1]; (byKind[k] ??= []).push(h); }
  for (const hs of Object.values(byKind)) {
    for (const h of hs.slice(0, PER_LIST)) {
      seen.add(h);
      if (!(await clickHref(h))) continue;
      const ms = await settle(h); slow.push([h, ms]);
      // enlaces dentro del detalle
      const inner = (await links()).filter((x) => x !== h && !seen.has(x)).slice(0, DEPTH_LINKS);
      for (const x of inner) {
        seen.add(x);
        if (!(await clickHref(x))) continue;
        slow.push([x, await settle(x)]);
        await page.goBack(); await settle("back:" + h);
        await page.goForward(); await settle("fwd:" + x);
        await page.goBack(); await settle("back2:" + h);
      }
      await page.goBack(); await settle("back-list:" + listPath);
    }
  }
}
// ids con muchas filas
for (const p of ["/objetos", "/monstruos"]) { await clickNav(p === "/objetos" ? "Materiales" : "Monstruos"); }
slow.sort((a, b) => b[1] - a[1]);
console.log(`Páginas visitadas: ${visited} | fest=${FEST} | problemas: ${problems.length}`);
console.log("Más lentas (ms hasta red inactiva):", slow.slice(0, 5).map((s) => s.join(" ")).join(" | "));
for (const p of problems) console.log(`[${p.kind}] ${p.at} :: ${p.msg}`);
await browser.close();
process.exit(problems.length ? 1 : 0);
