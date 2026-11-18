-- MHW Iceborne (PC) guide schema. Rebuilt from scratch on every `etl load`,
-- except `progress`, which holds the user's personal checklist and is never dropped.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE OR REPLACE FUNCTION f_norm(text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS
$$ SELECT lower(public.unaccent('public.unaccent'::regdictionary, $1)) $$;

DROP SCHEMA IF EXISTS mhw CASCADE;
CREATE SCHEMA mhw;
SET search_path = mhw, public;

-- ---------------------------------------------------------------- locations
CREATE TABLE locations (
  id                int PRIMARY KEY,
  name_en           text NOT NULL UNIQUE,
  name_es           text,
  zone_count        int,
  kind              text NOT NULL DEFAULT 'map',        -- map | arena | special | siege
  expansion         text,                                -- base | iceborne
  external_map_url  text,
  notes_es          text
);

CREATE TABLE location_camps (
  id           serial PRIMARY KEY,
  location_id  int NOT NULL REFERENCES locations(id),
  name_en      text NOT NULL,
  name_es      text,
  area         int,
  unlock_es    text,
  source       text NOT NULL DEFAULT 'mhworlddata'
);

-- --------------------------------------------------------------------- items
CREATE TABLE items (
  id              int PRIMARY KEY,
  name_en         text NOT NULL,
  name_es         text,
  description_en  text,
  description_es  text,
  category        text,       -- material | item | misc | ammo | hidden
  subcategory     text,       -- account | trade | supply | appraisal
  rarity          int,
  buy_price       int,
  sell_price      int,
  carry_limit     int,
  points          int,
  icon_name       text,
  icon_color      text
);
CREATE INDEX ON items (name_en);

CREATE TABLE item_combinations (
  id              int PRIMARY KEY,
  result_item_id  int NOT NULL REFERENCES items(id),
  first_item_id   int REFERENCES items(id),
  second_item_id  int REFERENCES items(id),
  quantity        int
);

CREATE TABLE location_items (
  id           serial PRIMARY KEY,
  location_id  int NOT NULL REFERENCES locations(id),
  area         int,
  rank         text,           -- LR | HR | MR | NULL = LR and HR
  item_id      int NOT NULL REFERENCES items(id),
  stack        int,
  percentage   numeric,
  nodes        int,
  notes_es     text,
  source       text NOT NULL DEFAULT 'mhworlddata'
);
CREATE INDEX ON location_items (item_id);
CREATE INDEX ON location_items (location_id);

-- ------------------------------------------------------------------ monsters
CREATE TABLE monsters (
  id              int PRIMARY KEY,
  name_en         text NOT NULL UNIQUE,
  name_es         text,
  description_en  text,
  description_es  text,
  ecology_en      text,
  size            text,       -- large | small
  pitfall_trap    boolean,
  shock_trap      boolean,
  vine_trap       boolean
);

CREATE TABLE monster_weaknesses (
  id               serial PRIMARY KEY,
  monster_id       int NOT NULL REFERENCES monsters(id),
  form             text,
  alt_description  text,
  fire int, water int, thunder int, ice int, dragon int,
  poison int, sleep int, paralysis int, blast int, stun int
);

CREATE TABLE monster_hitzones (
  id          serial PRIMARY KEY,
  monster_id  int NOT NULL REFERENCES monsters(id),
  hitzone_en  text,
  hitzone_es  text,
  cut int, impact int, shot int, fire int, water int, thunder int, ice int, dragon int, ko int
);

CREATE TABLE monster_breaks (
  id          serial PRIMARY KEY,
  monster_id  int NOT NULL REFERENCES monsters(id),
  part_en     text,
  part_es     text,
  flinch      int,
  wound       int,
  sever       int,
  extract     text
);

CREATE TABLE monster_ailments (
  monster_id  int PRIMARY KEY REFERENCES monsters(id),
  data        jsonb NOT NULL
);

CREATE TABLE monster_habitats (
  id           serial PRIMARY KEY,
  monster_id   int NOT NULL REFERENCES monsters(id),
  location_id  int NOT NULL REFERENCES locations(id),
  start_area   text,
  move_area    text,
  rest_area    text,
  rank         text,
  notes_es     text,
  source       text NOT NULL DEFAULT 'mhworlddata'
);

CREATE TABLE reward_conditions (
  id       serial PRIMARY KEY,
  name_en  text NOT NULL UNIQUE,
  name_es  text NOT NULL,
  kind     text NOT NULL          -- carve | capture | break | wound | reward | track | drop | palico | gl | other
);

CREATE TABLE monster_rewards (
  id            serial PRIMARY KEY,
  monster_id    int NOT NULL REFERENCES monsters(id),
  rank          text NOT NULL,
  condition_id  int NOT NULL REFERENCES reward_conditions(id),
  item_id       int NOT NULL REFERENCES items(id),
  stack         int,
  percentage    numeric
);
CREATE INDEX ON monster_rewards (item_id);
CREATE INDEX ON monster_rewards (monster_id);

-- -------------------------------------------------------------------- skills
CREATE TABLE skills (
  id              serial PRIMARY KEY,
  name_en         text NOT NULL UNIQUE,
  name_es         text,
  description_en  text,
  description_es  text,
  icon_color      text,
  secret          int,
  unlocks         text,
  max_level       int
);

CREATE TABLE skill_levels (
  skill_id        int NOT NULL REFERENCES skills(id),
  level           int NOT NULL,
  description_en  text,
  description_es  text,
  PRIMARY KEY (skill_id, level)
);

-- --------------------------------------------------------------------- armor
CREATE TABLE armor_set_bonuses (
  id       serial PRIMARY KEY,
  name_en  text NOT NULL UNIQUE,
  name_es  text
);

CREATE TABLE armor_set_bonus_ranks (
  bonus_id  int NOT NULL REFERENCES armor_set_bonuses(id),
  skill_id  int NOT NULL REFERENCES skills(id),
  required  int NOT NULL
);

CREATE TABLE armor_sets (
  id          serial PRIMARY KEY,
  name_en     text NOT NULL UNIQUE,
  name_es     text,
  rank        text,             -- LR | HR | MR
  monster_id  int REFERENCES monsters(id),
  bonus_id    int REFERENCES armor_set_bonuses(id)
);

CREATE TABLE armor (
  id                  int PRIMARY KEY,
  name_en             text NOT NULL,
  name_es             text,
  rarity              int,
  type                text,       -- head | chest | arms | waist | legs
  gender              text,
  rank                text,
  armor_set_id        int REFERENCES armor_sets(id),
  slot_1 int, slot_2 int, slot_3 int,
  defense_base int, defense_max int, defense_augment_max int,
  res_fire int, res_water int, res_thunder int, res_ice int, res_dragon int,
  image_male          text,
  image_female        text
);
CREATE INDEX ON armor (armor_set_id);

CREATE TABLE armor_skills (
  armor_id  int NOT NULL REFERENCES armor(id),
  skill_id  int NOT NULL REFERENCES skills(id),
  level     int NOT NULL
);

CREATE TABLE armor_recipes (
  armor_id  int NOT NULL REFERENCES armor(id),
  item_id   int NOT NULL REFERENCES items(id),
  quantity  int NOT NULL
);
CREATE INDEX ON armor_recipes (item_id);

-- ------------------------------------------------------------------- weapons
CREATE TABLE weapons (
  id              int PRIMARY KEY,
  name_en         text NOT NULL,
  name_es         text,
  weapon_type     text NOT NULL,
  previous_id     int,
  category        text,         -- NULL | Kulve | Safi
  rarity          int,
  attack          int,
  affinity        int,
  defense         int,
  element_hidden  boolean,
  element1        text,
  element1_attack int,
  element2        text,
  element2_attack int,
  elderseal       text,
  slot_1 int, slot_2 int, slot_3 int,
  notes           text
);
CREATE INDEX ON weapons (previous_id);

CREATE TABLE weapon_recipes (
  weapon_id  int NOT NULL REFERENCES weapons(id),
  type       text NOT NULL,     -- Create | Upgrade
  item_id    int NOT NULL REFERENCES items(id),
  quantity   int NOT NULL
);
CREATE INDEX ON weapon_recipes (item_id);

-- ------------------------------------------------------ decorations / charms
CREATE TABLE decorations (
  id       int PRIMARY KEY,
  name_en  text NOT NULL,
  name_es  text,
  slot     int,
  rarity   int,
  icon_color text
);

CREATE TABLE decoration_skills (
  decoration_id  int NOT NULL REFERENCES decorations(id),
  skill_id       int NOT NULL REFERENCES skills(id),
  level          int NOT NULL
);

CREATE TABLE decoration_droprates (
  feystone    text NOT NULL,
  rarity      int NOT NULL,
  percentage  numeric NOT NULL
);

CREATE TABLE charms (
  id           int PRIMARY KEY,
  name_en      text NOT NULL,
  name_es      text,
  previous_id  int,
  rarity       int
);

CREATE TABLE charm_skills (
  charm_id  int NOT NULL REFERENCES charms(id),
  skill_id  int NOT NULL REFERENCES skills(id),
  level     int NOT NULL
);

CREATE TABLE charm_recipes (
  charm_id  int NOT NULL REFERENCES charms(id),
  type      text NOT NULL,
  item_id   int NOT NULL REFERENCES items(id),
  quantity  int NOT NULL
);
CREATE INDEX ON charm_recipes (item_id);

-- -------------------------------------------------------------------- quests
CREATE TABLE quests (
  id              int PRIMARY KEY,
  name_en         text NOT NULL,
  name_es         text,
  objective_en    text,
  objective_es    text,
  description_en  text,
  description_es  text,
  category        text,     -- assigned | optional | event | challenge | special | arena
  rank            text,
  stars           int,
  quest_type      text,
  location_id     int REFERENCES locations(id),
  zenny           int,
  pc_available    boolean,
  pc_notes_es     text
);

CREATE TABLE quest_monsters (
  quest_id      int NOT NULL REFERENCES quests(id),
  monster_id    int NOT NULL REFERENCES monsters(id),
  quantity      int,
  is_objective  boolean
);

CREATE TABLE quest_rewards (
  quest_id    int NOT NULL REFERENCES quests(id),
  "group"     text,
  item_id     int NOT NULL REFERENCES items(id),
  stack       int,
  percentage  numeric
);
CREATE INDEX ON quest_rewards (item_id);

-- Event quest schedule snapshot (mhw-db), plus research notes.
CREATE TABLE events (
  id                   serial PRIMARY KEY,
  external_id          int,
  platform             text NOT NULL,
  type                 text,
  name_en              text NOT NULL,
  name_es              text,
  expansion            text,
  quest_rank           int,
  master_rank          boolean,
  requirements         text,
  success_conditions   text,
  description_en       text,
  location_id          int REFERENCES locations(id),
  quest_id             int REFERENCES quests(id),
  start_at             timestamptz,
  end_at               timestamptz,
  source               text NOT NULL DEFAULT 'mhw-db'
);

-- ------------------------------------------------------------------ research
-- Everything below is loaded from research/<topic>/*.json (Gemini Notebook research).

CREATE TABLE layered_armor (
  id            serial PRIMARY KEY,
  slug          text NOT NULL UNIQUE,
  name_en       text NOT NULL,
  name_es       text,
  category      text NOT NULL,   -- monster_mr | event | festival | collab | guild_palace | comic | other
  owner         text NOT NULL DEFAULT 'hunter',   -- hunter | palico | handler
  pieces        jsonb NOT NULL DEFAULT '[]',
  unlock_es     text,
  unlock_en     text,
  steps_es      jsonb NOT NULL DEFAULT '[]',
  materials     jsonb NOT NULL DEFAULT '[]',  -- [{item_en, item_id, qty, per_piece}]
  quests        jsonb NOT NULL DEFAULT '[]',  -- [{name_en, quest_id, kind}]
  pc_available  boolean,
  pc_notes_es   text,
  sources       jsonb NOT NULL DEFAULT '[]',
  needs_review  boolean NOT NULL DEFAULT false
);

CREATE TABLE achievements (
  id              serial PRIMARY KEY,
  slug            text NOT NULL UNIQUE,
  name_en         text NOT NULL,
  name_es         text,
  description_en  text,
  description_es  text,
  category        text,
  hidden          boolean NOT NULL DEFAULT false,
  guide_es        text,
  steps_es        jsonb NOT NULL DEFAULT '[]',
  related         jsonb NOT NULL DEFAULT '[]',  -- [{type, name_en, id}]
  sort_order      int,
  sources         jsonb NOT NULL DEFAULT '[]',
  needs_review    boolean NOT NULL DEFAULT false
);

-- Seasonal fests: Astera fest + Seliana fest of the same season run together, in two-week blocks.
CREATE TABLE festivals (
  slug          text PRIMARY KEY,
  season        text NOT NULL,     -- spring | summer | autumn | winter | appreciation
  name_es       text NOT NULL,
  astera_en     text NOT NULL,
  seliana_en    text NOT NULL,
  theme         text NOT NULL,     -- CSS theme key used by the web
  sort_order    int NOT NULL DEFAULT 0,
  summary_es    text,
  tickets       jsonb NOT NULL DEFAULT '[]',   -- [{item_en, item_id, note_es}]
  layered       jsonb NOT NULL DEFAULT '[]',   -- [{slug, name_es}]
  known_periods jsonb NOT NULL DEFAULT '[]',   -- [{start, end, source}] documented past runs
  sources       jsonb NOT NULL DEFAULT '[]',
  needs_review  boolean NOT NULL DEFAULT false
);

CREATE TABLE guides (
  id            serial PRIMARY KEY,
  slug          text NOT NULL UNIQUE,
  kind          text NOT NULL,   -- progression | unlock | farming | map | event | cooking | gathering | loot
  title_es      text NOT NULL,
  title_en      text,
  summary_es    text,
  body_md_es    text,
  steps_es      jsonb NOT NULL DEFAULT '[]',
  related       jsonb NOT NULL DEFAULT '[]',  -- [{type, name_en, id}]
  videos        jsonb NOT NULL DEFAULT '[]',  -- [{youtube_id, title, channel, lang, views, likes, low_confidence, ...}]
  sources       jsonb NOT NULL DEFAULT '[]',
  needs_review  boolean NOT NULL DEFAULT false
);

-- ------------------------------------------------------------------ canteen
-- Seeds: research/canteen/canteen.json. Rows keep the seed id (ing_* / fs_* / rule_*).
CREATE TABLE canteen_ingredients (
  id              text PRIMARY KEY,
  name_en         text NOT NULL,
  name_es         text,
  category        text NOT NULL,      -- meat | fish | veggie | drink
  category_es     text,
  skill_type      text NOT NULL,      -- Courage | Resilience | Vigor | Acumen | Artillery | (drinks) Perception | Fortune | Preparation | Trailblazer
  skill_type_es   text,
  description_en  text,
  description_es  text,
  unlock_type     text,               -- base | quest | delivery | bounty | gathering
  unlock          jsonb NOT NULL DEFAULT '{}',
  can_be_fresh    boolean,
  aliases         jsonb NOT NULL DEFAULT '[]',
  item_id         int REFERENCES items(id),   -- matched by name_en when the ingredient is also an item (else NULL)
  sort_order      int NOT NULL DEFAULT 0,
  sources         jsonb NOT NULL DEFAULT '[]',
  needs_review    boolean NOT NULL DEFAULT false,
  review_notes    jsonb NOT NULL DEFAULT '[]'
);
CREATE INDEX ON canteen_ingredients (category);

CREATE TABLE canteen_skills (
  id                   text PRIMARY KEY,
  name_en              text NOT NULL,
  name_es              text,
  effect_en            text,
  effect_es            text,
  kind                 text NOT NULL,   -- ingredient | daily | unavailable
  skill_type           text,
  skill_type_es        text,
  tier                 int,             -- 1/2/3 = 2/4/6 ingredients of the type (ingredient skills only)
  ingredients_required int,
  hunter_effect        boolean,
  palico_effect        boolean,
  duration             text,
  pool_note            text,
  note_es              text,
  numeric_details      jsonb,
  sort_order           int NOT NULL DEFAULT 0,
  sources              jsonb NOT NULL DEFAULT '[]',
  needs_review         boolean NOT NULL DEFAULT false,
  review_notes         jsonb NOT NULL DEFAULT '[]'
);

CREATE TABLE canteen_rules (
  id            text PRIMARY KEY,
  topic         text NOT NULL,
  title_es      text NOT NULL,
  text_es       text NOT NULL,
  sort_order    int NOT NULL DEFAULT 0,
  sources       jsonb NOT NULL DEFAULT '[]',
  needs_review  boolean NOT NULL DEFAULT false,
  review_notes  jsonb NOT NULL DEFAULT '[]'
);

-- Loot / gathering rule seeds (research/loot/*.json): one row per entry, free-form data in jsonb.
-- section = skills | tools | palico | tips | combos (loot) or skills | tools | palico_and_meals | tips (gathering).
CREATE TABLE loot_rules (
  id            text NOT NULL,
  section       text NOT NULL,
  name_en       text,
  name_es       text,
  sort_order    int NOT NULL DEFAULT 0,
  data          jsonb NOT NULL,
  sources       jsonb NOT NULL DEFAULT '[]',
  needs_review  boolean NOT NULL DEFAULT false,
  PRIMARY KEY (section, id)
);
CREATE TABLE gathering_rules (LIKE loot_rules INCLUDING ALL);

-- -------------------------------------------------------------- search index
CREATE MATERIALIZED VIEW search_index AS
  SELECT 'item'::text AS type, id::text AS id, name_es, name_en,
         coalesce(category, '') AS subtitle, rarity AS sort_key FROM items WHERE category <> 'hidden'
  UNION ALL
  SELECT 'monster', id::text, name_es, name_en, size, CASE size WHEN 'large' THEN 0 ELSE 1 END FROM monsters
  UNION ALL
  SELECT 'armor', id::text, name_es, name_en, coalesce(rank, '') || ' · ' || coalesce(type, ''), rarity FROM armor
  UNION ALL
  SELECT 'armor_set', id::text, name_es, name_en, coalesce(rank, ''), 0 FROM armor_sets
  UNION ALL
  SELECT 'weapon', id::text, name_es, name_en, weapon_type, rarity FROM weapons
  UNION ALL
  SELECT 'decoration', id::text, name_es, name_en, 'slot ' || slot, rarity FROM decorations
  UNION ALL
  SELECT 'charm', id::text, name_es, name_en, '', rarity FROM charms
  UNION ALL
  SELECT 'skill', id::text, name_es, name_en, '', 0 FROM skills
  UNION ALL
  SELECT 'quest', id::text, name_es, name_en, coalesce(category, '') || ' · ' || coalesce(rank, ''), stars FROM quests
  UNION ALL
  SELECT 'location', id::text, name_es, name_en, kind, 0 FROM locations
  UNION ALL
  SELECT 'layered', slug, name_es, name_en, category, 0 FROM layered_armor
  UNION ALL
  SELECT 'achievement', slug, name_es, name_en, coalesce(category, ''), sort_order FROM achievements
  UNION ALL
  SELECT 'guide', slug, title_es, title_en, kind, 0 FROM guides;

-- -------------------------------------------------------------- progress
-- Lives in public so it survives schema rebuilds.
CREATE TABLE IF NOT EXISTS public.progress (
  entity_type  text NOT NULL,
  entity_id    text NOT NULL,
  done         boolean NOT NULL DEFAULT true,
  notes        text,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_type, entity_id)
);

-- Event calendar entered by the user (also in public, never dropped). Capcom publishes no fixed dates for
-- the PC fest rotation, so periods come from the in-game Notice Board.
CREATE TABLE IF NOT EXISTS public.calendar_periods (
  id            serial PRIMARY KEY,
  kind          text NOT NULL,              -- festival | siege | event | custom
  festival_slug text,                       -- mhw.festivals.slug when kind = festival
  title         text,
  start_at      timestamptz NOT NULL,
  end_at        timestamptz NOT NULL,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (end_at > start_at)
);

CREATE TABLE IF NOT EXISTS public.calendar_settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Hunter profile snapshots parsed from the player's save (public, never dropped). Only the parsed JSON is
-- stored, never the binary save. Written only when the user presses "Actualizar perfil" / "Cargar save".
CREATE TABLE IF NOT EXISTS public.profile_snapshots (
  id       serial PRIMARY KEY,
  taken_at timestamptz NOT NULL DEFAULT now(),
  source   text NOT NULL CHECK (source IN ('steam-local', 'upload')),
  sha256   text NOT NULL,
  slot     int,
  data     jsonb NOT NULL
);
