// Smoke test de navegación SPA: hace clic en enlaces (sin page.goto) y detecta pantallas en blanco/errores.
// Uso: npm i && node navigation-smoke.mjs [baseUrl] [--fest]   (env CHROME=ruta a chrome.exe, SHOTS=carpeta capturas, E2E_SKIP_PLANNER=1 omite el flujo del constructor)
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

/* ---- Flujo del constructor por pasos (plannerFlow). Se omite con E2E_SKIP_PLANNER=1. ---- */
const SKIP_PLANNER = process.env.E2E_SKIP_PLANNER === "1";
const STEPPER = 'nav[aria-label="Pasos del constructor"]';
const STEP_ORDER = ["Objetivo", "Habilidades", "Bono de set", "Prioridades", "Armadura", "Joyas y amuleto", "Probar"];
const must = (cond, msg) => { if (!cond) throw new Error(msg); };
const visible = (sel) => page.evaluate((s) => [...document.querySelectorAll(s)].some((e) => e.offsetParent !== null), sel);
const newJsErrors = (from) => problems.slice(from).filter((p) => p.kind === "console" || p.kind === "pageerror" || p.kind === "planner" || /^http|^reqfailed/.test(p.kind));

/** Clic en el primer elemento visible y habilitado que cumpla selector + texto. */
async function clickText(selector, text, what) {
  const ok = await page.evaluate((sel, t) => {
    const norm = (s) => s.replace(/\s+/g, " ").trim();
    const el = [...document.querySelectorAll(sel)].find((e) => e.offsetParent !== null && !e.disabled && norm(e.textContent).includes(t));
    if (!el) return false;
    el.scrollIntoView({ block: "center" });
    el.click();
    return true;
  }, selector, text);
  must(ok, `No encuentro «${what}» (selector ${selector}, texto «${text}») visible y habilitado`);
}

/** Texto del paso marcado con aria-current="step" dentro del stepper visible. */
const currentStep = () => page.evaluate((sel) => {
  const el = [...document.querySelectorAll(`${sel} [aria-current="step"]`)].find((e) => e.offsetParent !== null);
  return el?.querySelector(".pl-step__t")?.textContent.trim() ?? "";
}, STEPPER);

async function waitStep(label) {
  await page.waitForFunction((sel, l) => {
    const el = [...document.querySelectorAll(`${sel} [aria-current="step"]`)].find((e) => e.offsetParent !== null);
    return el?.querySelector(".pl-step__t")?.textContent.trim() === l;
  }, { timeout: 15000 }, STEPPER, label).catch(() => {});
  const cur = await currentStep();
  must(cur === label, `Paso activo «${cur || "ninguno"}», se esperaba «${label}» (aria-current="step")`);
}

async function goStep(label) {
  await clickText(`${STEPPER} button.pl-step`, label, `paso «${label}» del constructor`);
  await waitStep(label);
}

async function plannerFlow() {
  const base = problems.length;
  const stage = (s) => { current = `planner:${s}`; };
  try {
    /* 1. entrada «Constructor» en el menú -> stepper visible */
    stage("1 menu Constructor");
    await clickNav("Constructor");
    await page.waitForFunction((sel) => [...document.querySelectorAll(sel)].some((e) => e.offsetParent !== null), { timeout: 15000 }, STEPPER).catch(() => {});
    must(await visible(STEPPER), `La nav «Pasos del constructor» no es visible tras pulsar «Constructor» (ruta ${await page.evaluate(() => location.pathname)})`);

    /* 2. Objetivo: arma, arquetipo y estilo «bloqueo» */
    stage("2 objetivo");
    await goStep("Objetivo");
    await clickText('button[role="radio"]', "Hacha cargada", "arma «Hacha cargada»");
    await page.waitForFunction(() => [...document.querySelectorAll(".pl-arch")].some((e) => e.textContent.includes("Hacha de carga: impacto")), { timeout: 15000 }).catch(() => {});
    await clickText(".pl-arch", "Hacha de carga: impacto", "arquetipo «Hacha de carga: impacto» (cb_impact)");
    must(await page.evaluate(() => [...document.querySelectorAll(".pl-arch")].some((e) => e.textContent.includes("Hacha de carga: impacto") && e.getAttribute("aria-checked") === "true")), "El arquetipo cb_impact no quedó seleccionado (aria-checked)");
    await clickText(".pl-chip", "Bloqueo", "estilo de juego «bloqueo»");
    must(await page.evaluate(() => [...document.querySelectorAll(".pl-chip")].some((e) => e.textContent.includes("Bloqueo") && e.getAttribute("aria-pressed") === "true")), "El estilo «bloqueo» no quedó marcado (aria-pressed)");
    /* sin plantilla no hay habilidades objetivo y «Buscar armadura» queda deshabilitado */
    await clickText("button.bd-btn", "plantilla", "«Aplicar plantilla»");
    await page.waitForFunction(() => /Plantilla aplicada|No se pudo cargar la plantilla/.test(document.querySelector(".pl-msg")?.textContent ?? ""), { timeout: 15000 }).catch(() => {});
    const tplMsg = await page.evaluate(() => document.querySelector(".pl-msg")?.textContent ?? "");
    must(/Plantilla aplicada/.test(tplMsg), `La plantilla no se aplicó: «${tplMsg.trim() || "sin mensaje"}»`);

    /* 3. Siguiente hasta Armadura, verificando cada paso con aria-current */
    stage("3 hasta Armadura");
    for (let i = 0; i < STEP_ORDER.length; i++) {
      const cur = await currentStep();
      if (cur === "Armadura") break;
      const k = STEP_ORDER.indexOf(cur);
      must(k >= 0 && k < STEP_ORDER.length - 1, `Paso activo inesperado «${cur}» al avanzar`);
      await clickText(".pl-pager button", "Siguiente", "botón «Siguiente»");
      await waitStep(STEP_ORDER[k + 1]);
    }
    await waitStep("Armadura");

    /* 4. Buscar armadura: al menos un resultado y sin errores de consola */
    stage("4 buscar armadura");
    const e4 = problems.length;
    await clickText("button.bd-btn", "Buscar armadura", "«Buscar armadura»");
    await page.waitForFunction(() => document.querySelectorAll('[role="tab"].pl-alt, ul.pl-pcs > li').length > 0, { timeout: 15000 }).catch(() => {});
    const nRes = await page.evaluate(() => document.querySelectorAll('[role="tab"].pl-alt').length);
    const status = await page.evaluate(() => document.querySelector(".pl-status")?.textContent.trim() ?? "");
    must(nRes > 0, `«Buscar armadura» no devolvió resultados en 15 s (estado: «${status || "sin estado"}»)`);
    const errs4 = newJsErrors(e4).filter((p) => p.kind === "console" || p.kind === "pageerror");
    must(errs4.length === 0, `Errores de consola durante la búsqueda: ${errs4.map((p) => p.msg.split("\n")[0]).join(" | ")}`);

    /* 5. Joyas y amuleto: filas de cobertura */
    stage("5 joyas y amuleto");
    await goStep("Joyas y amuleto");
    await page.waitForFunction(() => document.querySelectorAll("ul.pl-cov > li").length > 0, { timeout: 15000 }).catch(() => {});
    must(await page.evaluate(() => document.querySelectorAll("ul.pl-cov > li").length) > 0, "En «Joyas y amuleto» no hay filas de cobertura (ul.pl-cov > li)");

    /* 6. Probar: panel de evaluación */
    stage("6 probar");
    await goStep("Probar");
    await page.waitForFunction(() => [...document.querySelectorAll("aside.bd-res")].some((e) => e.offsetParent !== null), { timeout: 15000 }).catch(() => {});
    must(await visible("aside.bd-res"), "El panel de evaluación (aside.bd-res) no se muestra en «Probar»");

    /* 7. enlace antiguo: bestiario -> «Abrir en el constructor» -> piezas de armadura en «Probar» */
    stage("7 bestiario -> constructor");
    await page.goto(`${BASE}/bestiario/17?tab=equipo`, { waitUntil: "networkidle0" });
    await settle("planner:bestiario/17?tab=equipo");
    await clickText("a", "Abrir en el constructor", "enlace «Abrir en el constructor» del bestiario");
    await page.waitForFunction(() => location.pathname === "/constructor", { timeout: 15000 });
    await waitStep("Probar");
    await page.waitForFunction(() => [...document.querySelectorAll("ul.bd-slots button.bd-x")].some((b) => b.offsetParent !== null && !/amuleto/i.test(b.getAttribute("aria-label") ?? "")), { timeout: 15000 }).catch(() => {});
    must(
      await page.evaluate(() => [...document.querySelectorAll("ul.bd-slots button.bd-x")].some((b) => b.offsetParent !== null && !/amuleto/i.test(b.getAttribute("aria-label") ?? ""))),
      "El enlace antiguo abre «Probar» pero no muestra piezas de armadura (ul.bd-slots)",
    );

    /* 8. enlace de objetivo general: carga sin errores */
    stage("8 /constructor?goal=recoleccion");
    const e8 = problems.length;
    await page.goto(`${BASE}/constructor?goal=recoleccion`, { waitUntil: "networkidle0" });
    await settle("planner:/constructor?goal=recoleccion");
    must(await visible(STEPPER), "/constructor?goal=recoleccion no muestra la nav «Pasos del constructor»");
    const errs8 = newJsErrors(e8);
    must(errs8.length === 0, `Errores al cargar /constructor?goal=recoleccion: ${errs8.map((p) => p.msg.split("\n")[0]).join(" | ")}`);
  } catch (e) {
    note("planner", e.message);
    await page.screenshot({ path: path.join(SHOTS, "planner-fail.png") }).catch(() => {});
  }
  return problems.length - base;
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
if (SKIP_PLANNER) console.log("planner: omitido (E2E_SKIP_PLANNER=1)");
else await plannerFlow();
slow.sort((a, b) => b[1] - a[1]);
console.log(`Páginas visitadas: ${visited} | fest=${FEST} | problemas: ${problems.length}`);
console.log("Más lentas (ms hasta red inactiva):", slow.slice(0, 5).map((s) => s.join(" ")).join(" | "));
for (const p of problems) console.log(`[${p.kind}] ${p.at} :: ${p.msg}`);
await browser.close();
process.exit(problems.length ? 1 : 0);
