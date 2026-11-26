// Checks the canteen rules engine (web/src/pages/canteen/engine.ts) against research/canteen/sim_cases.json, the
// seed's recipes and suggest() edge cases. Prints a PASS/FAIL table and exits 1 on any failure.
//
// Run from the repo root:  node tools/canteen-engine-check.mjs
// Node 24 (also >= 22.18 / 23.6) imports .ts files directly by stripping types. On an older Node use:
//   node --experimental-strip-types tools/canteen-engine-check.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createEngine } from "../web/src/pages/canteen/engine.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const seed = JSON.parse(readFileSync(join(ROOT, "research/canteen/canteen.json"), "utf8")).entries;
const cases = JSON.parse(readFileSync(join(ROOT, "research/canteen/sim_cases.json"), "utf8")).cases;
const recipes = Array.isArray(seed.recipes) ? seed.recipes : [];

/** EData from the seed; `withBranches=false` exercises the derived-branches path (old data). */
function buildData(withBranches) {
  const skills = Array.isArray(seed.skills) ? seed.skills : [];
  return {
    ingredients: seed.ingredients.map((i) => ({ ...i, done: false })),
    skills: { ingredient: skills.filter((s) => s.kind === "ingredient"), daily: skills.filter((s) => s.kind === "daily") },
    branches: withBranches && Array.isArray(seed.branches) ? seed.branches : undefined,
    recipes,
  };
}

const rows = [];
function check(section, name, ok, detail = "") {
  rows.push({ section, name, ok: !!ok, detail: String(detail ?? "") });
}
function safe(section, name, fn) {
  try {
    fn();
  } catch (err) {
    check(section, name, false, `threw: ${err && err.stack ? err.stack.split("\n")[0] : err}`);
  }
}
const sameSet = (a, b) => a.length === b.length && new Set(a).size === new Set([...a, ...b]).size;
const superseded = (r) => r.branches.flatMap((b) => b.skills.filter((s) => s.state === "superseded").map((s) => s.id));
const STATS = ["attack", "defense", "elemental_res"];

// --------------------------------------------------------------------------------------------------------- cases
function runCases(engine, section) {
  for (const c of cases) {
    safe(section, c.id, () => {
      const inp = c.input;
      const r = engine.simulate(inp.ingredients, { slots: inp.slots, voucher: inp.voucher, daily: inp.daily_skill_ids ?? [] });
      const p = [];
      if (r.skillSlots.length !== 3) p.push(`skillSlots length ${r.skillSlots.length}`);
      const fresh = Math.min(r.fresh, 5);
      if (r.health.hunter !== fresh * 10 || r.health.palico !== fresh * 4) p.push(`health ${JSON.stringify(r.health)}`);
      if (c.expect_error) {
        if (r.errors_es.length === 0) p.push("expected errors_es, got none");
        check(section, c.id, p.length === 0, p.join("; ") || `errors: ${r.errors_es.map((e) => e.code).join(",")}`);
        return;
      }
      const e = c.expect;
      if (r.errors_es.length) p.push(`unexpected errors ${r.errors_es.map((x) => x.code).join(",")}`);
      if (!sameSet(r.activeSkillIds, e.active_skill_ids)) p.push(`active [${r.activeSkillIds}] != [${e.active_skill_ids}]`);
      if (!sameSet(superseded(r), e.superseded_skill_ids)) p.push(`superseded [${superseded(r)}] != [${e.superseded_skill_ids}]`);
      for (const k of STATS) if (r.stats[k].level !== e.stat_levels[k]) p.push(`${k} ${r.stats[k].level} != ${e.stat_levels[k]}`);
      if (r.stars !== e.stars) p.push(`stars ${r.stars} != ${e.stars}`);
      const free = 3 - r.activeSkillIds.length;
      if (free !== e.free_skill_slots) p.push(`free ${free} != ${e.free_skill_slots}`);
      if (r.skillSlots.filter((s) => s.kind === "branch").length !== r.activeSkillIds.length) p.push("branch slots != active");
      check(section, c.id, p.length === 0, p.join("; ") || r.summary_es);
    });
  }
}

const engine = createEngine(buildData(true));
const derived = createEngine(buildData(false));
runCases(engine, "cases");
runCases(derived, "cases (derived branches)");

// ------------------------------------------------------------------------------------------------ simulate extras
const caseById = Object.fromEntries(cases.map((c) => [c.id, c]));
const sim = (id, eng = engine) => {
  const inp = caseById[id].input;
  return eng.simulate(inp.ingredients, { slots: inp.slots, voucher: inp.voucher, daily: inp.daily_skill_ids ?? [] });
};
safe("simulate", "summary_es example", () => {
  const s = sim("four_artillery_two_courage_meat").summary_es;
  check("simulate", "summary_es example", s === "4 Artillería + 2 Coraje → Bombardero Felyne, Pulidor Felyne · Ataque G", s);
});
safe("simulate", "warnings_es", () => {
  const want = [
    ["five_courage", "5 de Coraje: el quinto no sube de nivel."],
    ["three_courage_odd", "3 de Coraje: el tercero no sube de nivel."],
    ["six_artillery_meat", "La rama da solo su nivel más alto"],
    ["six_perception_drinks_fresh", "Solo bebidas"],
    ["daily_fills_free_slot", "Sin hueco para «"],
  ];
  const bad = want.filter(([id, txt]) => !sim(id).warnings_es.some((w) => w.includes(txt))).map(([id]) => id);
  check("simulate", "warnings_es", bad.length === 0, bad.length ? `missing in ${bad}` : `${want.length} expected warnings found`);
});
safe("simulate", "daily slot order", () => {
  const r = sim("daily_fills_free_slot");
  const kinds = r.skillSlots.map((s) => `${s.kind}:${s.skillId}`).join(" ");
  check("simulate", "daily slot order", kinds === "branch:fs_felyne_polisher branch:fs_felyne_riser_hi daily:fs_felyne_temper", kinds);
});
safe("simulate", "health and nextAt", () => {
  const a = sim("three_fresh_no_voucher");
  const g = sim("gourmet_voucher");
  const f = sim("five_courage");
  const courage = f.branches.find((b) => b.branch === "Courage");
  const ok = a.health.hunter === 30 && a.health.palico === 12 && g.fresh === 6 && g.health.hunter === 50 && g.health.palico === 20
    && courage.nextAt === 1 && courage.nextSkillId === "fs_felyne_slugger" && f.stats.attack.nextAt === 1;
  check("simulate", "health and nextAt", ok, `3 fresh ${a.health.hunter}/${a.health.palico}; gourmet ${g.health.hunter}/${g.health.palico}; 5 Courage nextAt ${courage.nextAt}`);
});
safe("simulate", "never throws on garbage", () => {
  const r = engine.simulate([{ id: 5 }, null, "ing_wyvern_thigh", { id: "ing_wyvern_thigh", fresh: true }], { slots: 99, voucher: "bad", daily: null });
  const r2 = engine.simulate(undefined, undefined);
  const ok = r.slots === 6 && r.count === 1 && r.errors_es.filter((e) => e.code === "unknown").length === 2
    && r.errors_es.some((e) => e.code === "duplicate") && r.warnings_es.some((w) => w.startsWith("Huecos fuera de rango"))
    && r2.count === 0 && r2.summary_es === "Plato vacío";
  check("simulate", "never throws on garbage", ok, `codes ${r.errors_es.map((e) => e.code)}; ${r2.summary_es}`);
});
safe("helpers", "branches and labels", () => {
  const order = derived.branchOrder.join(",");
  const ok = order === "Courage,Resilience,Vigor,Acumen,Artillery,Perception,Fortune,Preparation,Trailblazer"
    && derived.branch("Artillery").name_es === "Artillería" && derived.branch("Fortune").group === "drink"
    && engine.branchOf("ing_peon_turkey") === "Artillery" && engine.ingredientsBy("meat", "Courage").length === 6
    && engine.ingredientsBy("drink", null).length === 24 && engine.branchSkills("Vigor").map((s) => s.id).join() === "fs_felyne_riser_hi,fs_felyne_black_belt,fs_felyne_heroics"
    && engine.skillTier("fs_felyne_rider").tier === 2 && engine.skillTier("fs_felyne_temper") === null
    && engine.statOfCategory.fish === "defense" && engine.categoryLabel_es.veggie === "Verdura" && engine.statLabel_es.elemental_res === "Res. elemental"
    && engine.isOwned("ing_wyvern_thigh") && !engine.isOwned("ing_peon_turkey") && engine.isOwned("ing_peon_turkey", ["ing_peon_turkey"]);
  check("helpers", "branches and labels", ok, `derived order ${order}`);
});
safe("helpers", "normalizePicks", () => {
  const n = engine.normalizePicks(["ing_wyvern_thigh", "x", "ing_wyvern_thigh", "ing_wyvern_egg", "ing_wyvern_tail", "ing_wyvern_head", "ing_wyvern_filet"], 4);
  const ok = n.picks.map((p) => p.id).join() === "ing_wyvern_thigh,ing_wyvern_egg,ing_wyvern_tail,ing_wyvern_head"
    && n.dropped.map((d) => `${d.id}:${d.code}`).join() === "x:unknown,ing_wyvern_thigh:duplicate,ing_wyvern_filet:overflow";
  check("helpers", "normalizePicks", ok, n.dropped.map((d) => `${d.id}:${d.code}`).join(" "));
});

// ------------------------------------------------------------------------------------------------------- recipes
const base = { preferOwned: false, ownedOnly: false };
if (recipes.length === 0) {
  check("recipes", "all", true, "skipped (no recipes yet)");
} else {
  for (const rec of recipes) {
    safe("recipes", rec.id, () => {
      const p = [];
      const plate = engine.recipePlate(rec, base);
      if (!plate.ok) p.push(`recipePlate: ${plate.reason_es}`);
      const extra = plate.result ? plate.result.activeSkillIds.filter((t) => !rec.target_skill_ids.includes(t)) : [];
      if (extra.length) p.push(`extra skills ${extra}`);
      const food = rec.composition.find((x) => x.category !== "drink");
      const stat = food ? engine.statOfCategory[food.category] : "none";
      const sg = engine.suggest({ targets: rec.target_skill_ids, stat, slots: 6, ...base });
      if (!sg.ok) p.push(`suggest(${stat}): ${sg.reason_es}`);
      const owned = engine.recipePlate(rec, { preferOwned: true, ownedOnly: true, owned: [] });
      if (!owned.ok) p.push(`ownedOnly: ${owned.reason_es}`);
      check("recipes", rec.id, p.length === 0, p.join("; ") || `${plate.result.summary_es} | suggest ${stat}: ${sg.result.summary_es}`);
    });
  }
}

// ------------------------------------------------------------------------------------------------------- suggest
const S = (targets, extra = {}) => engine.suggest({ targets, stat: "attack", slots: 6, preferOwned: false, ownedOnly: false, ...extra });
const reject = (name, res, needle) =>
  check("suggest", name, !res.ok && res.result === null && typeof res.reason_es === "string" && res.reason_es.includes(needle), res.reason_es);
safe("suggest", "same branch rejected", () =>
  reject("same branch rejected", S(["fs_felyne_polisher", "fs_felyne_rider"]), "Solo se activa el nivel más alto de cada rama: elige una sola habilidad de Coraje"));
safe("suggest", "over budget rejected (6)", () =>
  reject("over budget rejected (6)", S(["fs_felyne_bombardier", "fs_felyne_black_belt"]), "Necesitas 8 huecos y tu cantina tiene 6"));
safe("suggest", "over budget rejected (4)", () =>
  reject("over budget rejected (4)", S(["fs_felyne_bombardier", "fs_felyne_polisher"], { slots: 4 }), "Necesitas 6 huecos y tu cantina tiene 4"));
safe("suggest", "daily target rejected", () => reject("daily target rejected", S(["fs_felyne_temper"]), "habilidad diaria"));
safe("suggest", "unknown target rejected", () => reject("unknown target rejected", S(["fs_nope"]), "desconocida"));
safe("suggest", "4 targets rejected", () =>
  reject("4 targets rejected", S(["fs_felyne_polisher", "fs_felyne_acrobat", "fs_felyne_groomer", "fs_felyne_cleats"]), "como máximo 3"));
safe("suggest", "bombardier + attack fill", () => {
  const r = S(["fs_felyne_bombardier"]);
  const ok = r.ok && r.picks.length === 6 && r.result.stats.attack.level === 3 && sameSet(r.result.activeSkillIds, ["fs_felyne_bombardier"])
    && r.plan.some((x) => x.role === "filler" && x.count === 2 && x.category === "meat");
  check("suggest", "bombardier + attack fill", ok, r.result && r.result.summary_es);
});
safe("suggest", "stat only (attack)", () => {
  const r = S([]);
  const ok = r.ok && r.picks.length === 5 && r.result.activeSkillIds.length === 0 && r.result.stats.attack.level === 2
    && r.notes_es.some((n) => n.includes("hueco vacío"));
  check("suggest", "stat only (attack)", ok, r.result && r.result.summary_es);
});
safe("suggest", "fill empty", () => {
  const r = S(["fs_felyne_polisher"], { stat: "defense", fill: "empty" });
  const ok = r.ok && r.picks.length === 2 && r.result.stats.defense.level === 1 && r.notes_es.some((n) => n.includes("huecos libres"));
  check("suggest", "fill empty", ok, r.result && r.result.summary_es);
});
safe("suggest", "ownedOnly falls back to fish", () => {
  const fish = engine.ingredientsBy("fish", "Artillery").map((i) => i.id);
  const r = S(["fs_felyne_bombardier"], { ownedOnly: true, owned: fish });
  const art = r.picks.filter((p) => engine.branchOf(p.id) === "Artillery").map((p) => engine.ingredient(p.id).category);
  const ok = r.ok && art.length === 4 && art.every((c) => c === "fish") && r.missing.length === 0
    && r.notes_es.some((n) => n.includes("cambia la estadística"));
  check("suggest", "ownedOnly falls back to fish", ok, r.result && `${r.result.summary_es} | missing ${r.missing.length}`);
});
safe("suggest", "ownedOnly lists missing", () => {
  const r = S(["fs_felyne_pyro"], { ownedOnly: true, owned: [] });
  const ok = r.ok && r.missing.length === 6 && r.missing.every((m) => !engine.isOwned(m.id, []));
  check("suggest", "ownedOnly lists missing", ok, `missing ${r.missing.length}`);
});
safe("suggest", "preferOwned order", () => {
  const r = S(["fs_felyne_sharpshooter"], { preferOwned: true, owned: ["ing_kaiser_turkey"], fill: "empty" });
  check("suggest", "preferOwned order", r.ok && r.picks[0].id === "ing_kaiser_turkey", r.picks.map((p) => p.id).join(","));
});
safe("suggest", "stat none picks most-owned", () => {
  const owned = engine.ingredientsBy("veggie", "Courage").map((i) => i.id);
  const r = engine.suggest({ targets: ["fs_felyne_rider"], stat: "none", slots: 4, preferOwned: true, ownedOnly: false, owned });
  const cats = r.picks.map((p) => engine.ingredient(p.id).category);
  check("suggest", "stat none picks most-owned", r.ok && cats.every((c) => c === "veggie"), cats.join(","));
});

// Exhaustive: every 0..3 target set (one per branch) x stat x slots x fill x ownership mode.
safe("suggest", "exhaustive", () => {
  const all = engine.branchOrder.flatMap((b) => engine.branchSkills(b).map((s) => s.id));
  const sets = [[]];
  for (let i = 0; i < all.length; i++) {
    sets.push([all[i]]);
    for (let j = i + 1; j < all.length; j++) {
      sets.push([all[i], all[j]]);
      for (let k = j + 1; k < all.length; k++) sets.push([all[i], all[j], all[k]]);
    }
  }
  const modes = [{ preferOwned: false, ownedOnly: false }, { preferOwned: true, ownedOnly: true, owned: [] }];
  let n = 0;
  const bad = [];
  for (const t of sets) {
    const branches = t.map((id) => engine.skillTier(id).branch);
    const sameBranch = new Set(branches).size !== branches.length;
    const need = t.reduce((a, id) => a + 2 * engine.skillTier(id).tier, 0);
    for (const stat of ["attack", "defense", "elemental_res", "none"]) {
      for (const slots of [2, 4, 6]) {
        for (const fill of ["singles", "empty"]) {
          for (const m of modes) {
            n++;
            const r = engine.suggest({ targets: t, stat, slots, fill, ...m });
            const expectOk = !sameBranch && need <= slots;
            let good = r.ok === expectOk;
            if (good && r.ok) {
              const ids = r.picks.map((p) => p.id);
              good = sameSet(r.result.activeSkillIds, t) && r.result.errors_es.length === 0 && ids.length <= slots
                && new Set(ids).size === ids.length && (fill === "empty" ? ids.length === need : ids.length >= need);
            }
            if (!good && bad.length < 3) bad.push(`${t.join("+") || "none"}/${stat}/${slots}/${fill}: ${r.reason_es}`);
          }
        }
      }
    }
  }
  check("suggest", "exhaustive", bad.length === 0, bad.length ? bad.join(" | ") : `${n} requests`);
});

// --------------------------------------------------------------------------------------------------------- report
const pad = (s, w) => (s.length >= w ? s.slice(0, w) : s + " ".repeat(w - s.length));
const wSec = Math.max(...rows.map((r) => r.section.length));
const wName = Math.max(...rows.map((r) => r.name.length));
for (const r of rows) {
  const d = r.detail.length > 110 ? `${r.detail.slice(0, 107)}...` : r.detail;
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${pad(r.section, wSec)}  ${pad(r.name, wName)}  ${d}`);
}
const failed = rows.filter((r) => !r.ok).length;
console.log(`\n${rows.length - failed}/${rows.length} PASS${failed ? `, ${failed} FAIL` : ""}`);
process.exit(failed ? 1 : 0);
