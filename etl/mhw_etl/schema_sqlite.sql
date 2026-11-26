-- MHW Iceborne (PC) catalog schema for SQLite. Port of schema.sql (Postgres schema `mhw`).
-- Conventions: JSON columns hold JSON text (arrays included); TIMESTAMPTZ columns hold fixed-width UTC text
-- 'YYYY-MM-DDTHH:MM:SS.ffffffZ'; BOOLEAN is 0/1. Ids come from insertion order and match the Postgres ids.
-- The user's personal tables (progress, calendar, profile snapshots...) are NOT part of the catalog (user.db).
-- The `meta` table and PRAGMA user_version are written by the loader after the data is in.

-- Insertion order of the tables whose explicit ids are not monotonic in the source CSV (SQLite stores those
-- by id, Postgres kept heap order). Only used to build search_index in the same row order; dropped afterwards.
CREATE TABLE _load_order (tbl TEXT NOT NULL, seq INTEGER NOT NULL, id INTEGER NOT NULL);

CREATE TABLE meta (
  key    TEXT PRIMARY KEY,
  value  TEXT
);

-- ---------------------------------------------------------------- locations
CREATE TABLE locations (
  id                INTEGER PRIMARY KEY,
  name_en           TEXT NOT NULL UNIQUE,
  name_es           TEXT,
  zone_count        INTEGER,
  kind              TEXT NOT NULL DEFAULT 'map',        -- map | arena | special | siege
  expansion         TEXT,                                -- base | iceborne
  external_map_url  TEXT,
  notes_es          TEXT
);

CREATE TABLE location_camps (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  location_id  INTEGER NOT NULL REFERENCES locations(id),
  name_en      TEXT NOT NULL,
  name_es      TEXT,
  area         INTEGER,
  unlock_es    TEXT,
  source       TEXT NOT NULL DEFAULT 'mhworlddata'
);

-- --------------------------------------------------------------------- items
CREATE TABLE items (
  id              INTEGER PRIMARY KEY,
  name_en         TEXT NOT NULL,
  name_es         TEXT,
  description_en  TEXT,
  description_es  TEXT,
  category        TEXT,       -- material | item | misc | ammo | hidden
  subcategory     TEXT,       -- account | trade | supply | appraisal
  rarity          INTEGER,
  buy_price       INTEGER,
  sell_price      INTEGER,
  carry_limit     INTEGER,
  points          INTEGER,
  icon_name       TEXT,
  icon_color      TEXT
);
CREATE INDEX idx_items_name_en ON items (name_en);

CREATE TABLE item_combinations (
  id              INTEGER PRIMARY KEY,
  result_item_id  INTEGER NOT NULL REFERENCES items(id),
  first_item_id   INTEGER REFERENCES items(id),
  second_item_id  INTEGER REFERENCES items(id),
  quantity        INTEGER
);

CREATE TABLE location_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  location_id  INTEGER NOT NULL REFERENCES locations(id),
  area         INTEGER,
  rank         TEXT,           -- LR | HR | MR | NULL = LR and HR
  item_id      INTEGER NOT NULL REFERENCES items(id),
  stack        INTEGER,
  percentage   NUMERIC,
  nodes        INTEGER,
  notes_es     TEXT,
  source       TEXT NOT NULL DEFAULT 'mhworlddata'
);
CREATE INDEX idx_location_items_item_id ON location_items (item_id);
CREATE INDEX idx_location_items_location_id ON location_items (location_id);

-- ------------------------------------------------------------------ monsters
CREATE TABLE monsters (
  id              INTEGER PRIMARY KEY,
  name_en         TEXT NOT NULL UNIQUE,
  name_es         TEXT,
  description_en  TEXT,
  description_es  TEXT,
  ecology_en      TEXT,
  size            TEXT,       -- large | small
  pitfall_trap    BOOLEAN,
  shock_trap      BOOLEAN,
  vine_trap       BOOLEAN
);

CREATE TABLE monster_weaknesses (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  monster_id       INTEGER NOT NULL REFERENCES monsters(id),
  form             TEXT,
  alt_description  TEXT,
  fire INTEGER, water INTEGER, thunder INTEGER, ice INTEGER, dragon INTEGER,
  poison INTEGER, sleep INTEGER, paralysis INTEGER, blast INTEGER, stun INTEGER
);

CREATE TABLE monster_hitzones (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  monster_id  INTEGER NOT NULL REFERENCES monsters(id),
  hitzone_en  TEXT,
  hitzone_es  TEXT,
  cut INTEGER, impact INTEGER, shot INTEGER, fire INTEGER, water INTEGER, thunder INTEGER, ice INTEGER, dragon INTEGER, ko INTEGER
);

CREATE TABLE monster_breaks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  monster_id  INTEGER NOT NULL REFERENCES monsters(id),
  part_en     TEXT,
  part_es     TEXT,
  flinch      INTEGER,
  wound       INTEGER,
  sever       INTEGER,
  extract     TEXT
);

CREATE TABLE monster_ailments (
  monster_id  INTEGER PRIMARY KEY REFERENCES monsters(id),
  data        JSON NOT NULL
);

CREATE TABLE monster_habitats (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  monster_id   INTEGER NOT NULL REFERENCES monsters(id),
  location_id  INTEGER NOT NULL REFERENCES locations(id),
  start_area   TEXT,
  move_area    TEXT,
  rest_area    TEXT,
  rank         TEXT,
  notes_es     TEXT,
  source       TEXT NOT NULL DEFAULT 'mhworlddata'
);

CREATE TABLE reward_conditions (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  name_en  TEXT NOT NULL UNIQUE,
  name_es  TEXT NOT NULL,
  kind     TEXT NOT NULL          -- carve | capture | break | wound | reward | track | drop | palico | gl | other
);

CREATE TABLE monster_rewards (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  monster_id    INTEGER NOT NULL REFERENCES monsters(id),
  rank          TEXT NOT NULL,
  condition_id  INTEGER NOT NULL REFERENCES reward_conditions(id),
  item_id       INTEGER NOT NULL REFERENCES items(id),
  stack         INTEGER,
  percentage    NUMERIC
);
CREATE INDEX idx_monster_rewards_item_id ON monster_rewards (item_id);
CREATE INDEX idx_monster_rewards_monster_id ON monster_rewards (monster_id);

-- -------------------------------------------------------------------- skills
CREATE TABLE skills (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name_en         TEXT NOT NULL UNIQUE,
  name_es         TEXT,
  description_en  TEXT,
  description_es  TEXT,
  icon_color      TEXT,
  secret          INTEGER,
  unlocks         TEXT,
  max_level       INTEGER
);

CREATE TABLE skill_levels (
  skill_id        INTEGER NOT NULL REFERENCES skills(id),
  level           INTEGER NOT NULL,
  description_en  TEXT,
  description_es  TEXT,
  PRIMARY KEY (skill_id, level)
);

-- --------------------------------------------------------------------- armor
CREATE TABLE armor_set_bonuses (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  name_en  TEXT NOT NULL UNIQUE,
  name_es  TEXT
);

CREATE TABLE armor_set_bonus_ranks (
  bonus_id  INTEGER NOT NULL REFERENCES armor_set_bonuses(id),
  skill_id  INTEGER NOT NULL REFERENCES skills(id),
  required  INTEGER NOT NULL
);

CREATE TABLE armor_sets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name_en     TEXT NOT NULL UNIQUE,
  name_es     TEXT,
  rank        TEXT,             -- LR | HR | MR
  monster_id  INTEGER REFERENCES monsters(id),
  bonus_id    INTEGER REFERENCES armor_set_bonuses(id)
);

CREATE TABLE armor (
  id                  INTEGER PRIMARY KEY,
  name_en             TEXT NOT NULL,
  name_es             TEXT,
  rarity              INTEGER,
  type                TEXT,       -- head | chest | arms | waist | legs
  gender              TEXT,
  rank                TEXT,
  armor_set_id        INTEGER REFERENCES armor_sets(id),
  slot_1 INTEGER, slot_2 INTEGER, slot_3 INTEGER,
  defense_base INTEGER, defense_max INTEGER, defense_augment_max INTEGER,
  res_fire INTEGER, res_water INTEGER, res_thunder INTEGER, res_ice INTEGER, res_dragon INTEGER,
  image_male          TEXT,
  image_female        TEXT
);
CREATE INDEX idx_armor_armor_set_id ON armor (armor_set_id);

CREATE TABLE armor_skills (
  armor_id  INTEGER NOT NULL REFERENCES armor(id),
  skill_id  INTEGER NOT NULL REFERENCES skills(id),
  level     INTEGER NOT NULL
);

CREATE TABLE armor_recipes (
  armor_id  INTEGER NOT NULL REFERENCES armor(id),
  item_id   INTEGER NOT NULL REFERENCES items(id),
  quantity  INTEGER NOT NULL
);
CREATE INDEX idx_armor_recipes_item_id ON armor_recipes (item_id);

-- ------------------------------------------------------------------- weapons
CREATE TABLE weapons (
  id              INTEGER PRIMARY KEY,
  name_en         TEXT NOT NULL,
  name_es         TEXT,
  weapon_type     TEXT NOT NULL,
  previous_id     INTEGER,
  category        TEXT,         -- NULL | Kulve | Safi
  rarity          INTEGER,
  attack          INTEGER,
  affinity        INTEGER,
  defense         INTEGER,
  element_hidden  BOOLEAN,
  element1        TEXT,
  element1_attack INTEGER,
  element2        TEXT,
  element2_attack INTEGER,
  elderseal       TEXT,
  slot_1 INTEGER, slot_2 INTEGER, slot_3 INTEGER,
  notes           TEXT
);
CREATE INDEX idx_weapons_previous_id ON weapons (previous_id);

CREATE TABLE weapon_recipes (
  weapon_id  INTEGER NOT NULL REFERENCES weapons(id),
  type       TEXT NOT NULL,     -- Create | Upgrade
  item_id    INTEGER NOT NULL REFERENCES items(id),
  quantity   INTEGER NOT NULL
);
CREATE INDEX idx_weapon_recipes_item_id ON weapon_recipes (item_id);

-- ------------------------------------------------------ decorations / charms
CREATE TABLE decorations (
  id       INTEGER PRIMARY KEY,
  name_en  TEXT NOT NULL,
  name_es  TEXT,
  slot     INTEGER,
  rarity   INTEGER,
  icon_color TEXT
);

CREATE TABLE decoration_skills (
  decoration_id  INTEGER NOT NULL REFERENCES decorations(id),
  skill_id       INTEGER NOT NULL REFERENCES skills(id),
  level          INTEGER NOT NULL
);

CREATE TABLE decoration_droprates (
  feystone    TEXT NOT NULL,
  rarity      INTEGER NOT NULL,
  percentage  NUMERIC NOT NULL
);

CREATE TABLE charms (
  id           INTEGER PRIMARY KEY,
  name_en      TEXT NOT NULL,
  name_es      TEXT,
  previous_id  INTEGER,
  rarity       INTEGER
);

CREATE TABLE charm_skills (
  charm_id  INTEGER NOT NULL REFERENCES charms(id),
  skill_id  INTEGER NOT NULL REFERENCES skills(id),
  level     INTEGER NOT NULL
);

CREATE TABLE charm_recipes (
  charm_id  INTEGER NOT NULL REFERENCES charms(id),
  type      TEXT NOT NULL,
  item_id   INTEGER NOT NULL REFERENCES items(id),
  quantity  INTEGER NOT NULL
);
CREATE INDEX idx_charm_recipes_item_id ON charm_recipes (item_id);

-- -------------------------------------------------------------------- quests
CREATE TABLE quests (
  id              INTEGER PRIMARY KEY,
  name_en         TEXT NOT NULL,
  name_es         TEXT,
  objective_en    TEXT,
  objective_es    TEXT,
  description_en  TEXT,
  description_es  TEXT,
  category        TEXT,     -- assigned | optional | event | challenge | special | arena
  rank            TEXT,
  stars           INTEGER,
  quest_type      TEXT,
  location_id     INTEGER REFERENCES locations(id),
  zenny           INTEGER,
  pc_available    BOOLEAN,
  pc_notes_es     TEXT
);

CREATE TABLE quest_monsters (
  quest_id      INTEGER NOT NULL REFERENCES quests(id),
  monster_id    INTEGER NOT NULL REFERENCES monsters(id),
  quantity      INTEGER,
  is_objective  BOOLEAN
);

CREATE TABLE quest_rewards (
  quest_id    INTEGER NOT NULL REFERENCES quests(id),
  "group"     TEXT,
  item_id     INTEGER NOT NULL REFERENCES items(id),
  stack       INTEGER,
  percentage  NUMERIC
);
CREATE INDEX idx_quest_rewards_item_id ON quest_rewards (item_id);

-- Event quest schedule snapshot (mhw-db), plus research notes.
CREATE TABLE events (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  external_id          INTEGER,
  platform             TEXT NOT NULL,
  type                 TEXT,
  name_en              TEXT NOT NULL,
  name_es              TEXT,
  expansion            TEXT,
  quest_rank           INTEGER,
  master_rank          BOOLEAN,
  requirements         TEXT,
  success_conditions   TEXT,
  description_en       TEXT,
  location_id          INTEGER REFERENCES locations(id),
  quest_id             INTEGER REFERENCES quests(id),
  start_at             TIMESTAMPTZ,
  end_at               TIMESTAMPTZ,
  source               TEXT NOT NULL DEFAULT 'mhw-db'
);

-- ------------------------------------------------------------------ research
-- Everything below is loaded from research/<topic>/*.json (Gemini Notebook research).

CREATE TABLE layered_armor (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  slug          TEXT NOT NULL UNIQUE,
  name_en       TEXT NOT NULL,
  name_es       TEXT,
  category      TEXT NOT NULL,   -- monster_mr | event | festival | collab | guild_palace | comic | other
  owner         TEXT NOT NULL DEFAULT 'hunter',   -- hunter | palico | handler
  pieces        JSON NOT NULL DEFAULT '[]',
  unlock_es     TEXT,
  unlock_en     TEXT,
  steps_es      JSON NOT NULL DEFAULT '[]',
  materials     JSON NOT NULL DEFAULT '[]',  -- [{item_en, item_id, qty, per_piece}]
  quests        JSON NOT NULL DEFAULT '[]',  -- [{name_en, quest_id, kind}]
  pc_available  BOOLEAN,
  pc_notes_es   TEXT,
  sources       JSON NOT NULL DEFAULT '[]',
  needs_review  BOOLEAN NOT NULL DEFAULT 0
);

CREATE TABLE achievements (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  slug            TEXT NOT NULL UNIQUE,
  name_en         TEXT NOT NULL,
  name_es         TEXT,
  description_en  TEXT,
  description_es  TEXT,
  category        TEXT,
  hidden          BOOLEAN NOT NULL DEFAULT 0,
  guide_es        TEXT,
  steps_es        JSON NOT NULL DEFAULT '[]',
  related         JSON NOT NULL DEFAULT '[]',  -- [{type, name_en, id}]
  sort_order      INTEGER,
  sources         JSON NOT NULL DEFAULT '[]',
  needs_review    BOOLEAN NOT NULL DEFAULT 0
);

-- Seasonal fests: Astera fest + Seliana fest of the same season run together, in two-week blocks.
CREATE TABLE festivals (
  slug          TEXT PRIMARY KEY,
  season        TEXT NOT NULL,     -- spring | summer | autumn | winter | appreciation
  name_es       TEXT NOT NULL,
  astera_en     TEXT NOT NULL,
  seliana_en    TEXT NOT NULL,
  theme         TEXT NOT NULL,     -- CSS theme key used by the web
  sort_order    INTEGER NOT NULL DEFAULT 0,
  summary_es    TEXT,
  tickets       JSON NOT NULL DEFAULT '[]',   -- [{item_en, item_id, note_es}]
  layered       JSON NOT NULL DEFAULT '[]',   -- [{slug, name_es}]
  known_periods JSON NOT NULL DEFAULT '[]',   -- [{start, end, source}] documented past runs
  sources       JSON NOT NULL DEFAULT '[]',
  needs_review  BOOLEAN NOT NULL DEFAULT 0
);

CREATE TABLE guides (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  slug          TEXT NOT NULL UNIQUE,
  kind          TEXT NOT NULL,   -- progression | unlock | farming | map | event | cooking | gathering | loot
  title_es      TEXT NOT NULL,
  title_en      TEXT,
  summary_es    TEXT,
  body_md_es    TEXT,
  steps_es      JSON NOT NULL DEFAULT '[]',
  related       JSON NOT NULL DEFAULT '[]',  -- [{type, name_en, id}]
  videos        JSON NOT NULL DEFAULT '[]',  -- [{youtube_id, title, channel, lang, views, likes, low_confidence, ...}]
  sources       JSON NOT NULL DEFAULT '[]',
  needs_review  BOOLEAN NOT NULL DEFAULT 0
);

-- ------------------------------------------------------------------ canteen
-- Seeds: research/canteen/canteen.json. Rows keep the seed id (ing_* / fs_* / rule_*).
CREATE TABLE canteen_ingredients (
  id              TEXT PRIMARY KEY,
  name_en         TEXT NOT NULL,
  name_es         TEXT,
  category        TEXT NOT NULL,      -- meat | fish | veggie | drink
  category_es     TEXT,
  skill_type      TEXT NOT NULL,      -- Courage | Resilience | Vigor | Acumen | Artillery | (drinks) Perception | Fortune | Preparation | Trailblazer
  skill_type_es   TEXT,
  description_en  TEXT,
  description_es  TEXT,
  unlock_type     TEXT,               -- base | quest | delivery | bounty | gathering
  unlock          JSON NOT NULL DEFAULT '{}',
  can_be_fresh    BOOLEAN,
  aliases         JSON NOT NULL DEFAULT '[]',
  item_id         INTEGER REFERENCES items(id),   -- matched by name_en when the ingredient is also an item (else NULL)
  doc_id          TEXT,               -- code of the user's workbook (C01/P01/V01/B01)
  unlock_es       TEXT,               -- unlock requirement as written in the workbook (Spanish)
  sort_order      INTEGER NOT NULL DEFAULT 0,
  sources         JSON NOT NULL DEFAULT '[]',
  needs_review    BOOLEAN NOT NULL DEFAULT 0,
  review_notes    JSON NOT NULL DEFAULT '[]'
);
CREATE INDEX idx_canteen_ingredients_category ON canteen_ingredients (category);

CREATE TABLE canteen_skills (
  id                   TEXT PRIMARY KEY,
  name_en              TEXT NOT NULL,
  name_es              TEXT,
  effect_en            TEXT,
  effect_es            TEXT,
  kind                 TEXT NOT NULL,   -- ingredient | daily | unavailable
  skill_type           TEXT,
  skill_type_es        TEXT,
  tier                 INTEGER,             -- 1/2/3 = 2/4/6 ingredients of the type (ingredient skills only)
  ingredients_required INTEGER,
  hunter_effect        BOOLEAN,
  palico_effect        BOOLEAN,
  duration             TEXT,
  pool_note            TEXT,
  note_es              TEXT,
  numeric_details      JSON,
  synergy_es           TEXT,            -- workbook 'Sinergia y Uso Recomendado' (branch and daily skills only)
  sort_order           INTEGER NOT NULL DEFAULT 0,
  sources              JSON NOT NULL DEFAULT '[]',
  needs_review         BOOLEAN NOT NULL DEFAULT 0,
  review_notes         JSON NOT NULL DEFAULT '[]'
);

CREATE TABLE canteen_rules (
  id            TEXT PRIMARY KEY,
  topic         TEXT NOT NULL,
  title_es      TEXT NOT NULL,
  text_es       TEXT NOT NULL,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  sources       JSON NOT NULL DEFAULT '[]',
  needs_review  BOOLEAN NOT NULL DEFAULT 0,
  review_notes  JSON NOT NULL DEFAULT '[]'
);

-- Branches = the 9 colour families of ingredient skills (3 tiers each). skill_ids = [tier1, tier2, tier3].
CREATE TABLE canteen_branches (
  id              TEXT PRIMARY KEY,   -- = skill_type (Courage | Resilience | ... | Trailblazer)
  name_es         TEXT,
  name_en         TEXT NOT NULL,
  color_name_es   TEXT,
  color_hex       TEXT,
  glyph           TEXT,
  branch_group    TEXT NOT NULL,      -- food | drink
  categories      JSON NOT NULL DEFAULT '[]',
  skill_ids       JSON NOT NULL DEFAULT '[]',
  sort_order      INTEGER NOT NULL DEFAULT 0,
  sources         JSON NOT NULL DEFAULT '[]',
  needs_review    BOOLEAN NOT NULL DEFAULT 0,
  review_notes    JSON NOT NULL DEFAULT '[]'
);

-- Recipes from the user's workbook (sheet 4) plus R17-R19. composition = [{count, category, branch}].
CREATE TABLE canteen_recipes (
  id                TEXT PRIMARY KEY,   -- R01..R19
  name_es           TEXT NOT NULL,
  plate_type_es     TEXT,
  composition       JSON NOT NULL DEFAULT '[]',
  variants_es       TEXT,
  target_skill_ids  JSON NOT NULL DEFAULT '[]',
  needs_daily       TEXT,               -- daily skill id needed on top of the plate (or NULL)
  voucher_es        TEXT,
  use_es            TEXT,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  sources           JSON NOT NULL DEFAULT '[]',
  needs_review      BOOLEAN NOT NULL DEFAULT 0,
  review_notes      JSON NOT NULL DEFAULT '[]'
);

-- Loot / gathering rule seeds (research/loot/*.json): one row per entry, free-form data in JSON.
-- section = skills | tools | palico | tips | combos (loot) or skills | tools | palico_and_meals | tips (gathering).
CREATE TABLE loot_rules (
  id            TEXT NOT NULL,
  section       TEXT NOT NULL,
  name_en       TEXT,
  name_es       TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  data          JSON NOT NULL,
  sources       JSON NOT NULL DEFAULT '[]',
  needs_review  BOOLEAN NOT NULL DEFAULT 0,
  PRIMARY KEY (section, id)
);
CREATE TABLE gathering_rules (
  id            TEXT NOT NULL,
  section       TEXT NOT NULL,
  name_en       TEXT,
  name_es       TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  data          JSON NOT NULL,
  sources       JSON NOT NULL DEFAULT '[]',
  needs_review  BOOLEAN NOT NULL DEFAULT 0,
  PRIMARY KEY (section, id)
);

-- -------------------------------------------------------------- search index
-- @@POST_LOAD@@ (everything below runs after all data is loaded: the loader splits the file here)
-- Plain table replacing the Postgres materialized view: same columns, same UNION ALL branches, same row order.
-- The API searches in memory, so there is no trigram index and no f_norm().
CREATE TABLE search_index (
  type      TEXT,
  id        TEXT,
  name_es   TEXT,
  name_en   TEXT,
  subtitle  TEXT,
  sort_key
);

INSERT INTO search_index
  SELECT 'item', CAST(items.id AS TEXT), name_es, name_en, coalesce(category, ''), rarity
  FROM items JOIN _load_order o ON o.tbl = 'items' AND o.id = items.id WHERE category <> 'hidden'
  ORDER BY o.seq;

INSERT INTO search_index
  SELECT 'monster', CAST(monsters.id AS TEXT), name_es, name_en, size, CASE size WHEN 'large' THEN 0 ELSE 1 END
  FROM monsters JOIN _load_order o ON o.tbl = 'monsters' AND o.id = monsters.id 
  ORDER BY o.seq;

INSERT INTO search_index
  SELECT 'armor', CAST(armor.id AS TEXT), name_es, name_en, coalesce(rank, '') || ' · ' || coalesce(type, ''), rarity
  FROM armor JOIN _load_order o ON o.tbl = 'armor' AND o.id = armor.id 
  ORDER BY o.seq;

INSERT INTO search_index
  SELECT 'armor_set', CAST(id AS TEXT), name_es, name_en, coalesce(rank, ''), 0
  FROM armor_sets 
  ORDER BY rowid;

INSERT INTO search_index
  SELECT 'weapon', CAST(weapons.id AS TEXT), name_es, name_en, weapon_type, rarity
  FROM weapons JOIN _load_order o ON o.tbl = 'weapons' AND o.id = weapons.id 
  ORDER BY o.seq;

INSERT INTO search_index
  SELECT 'decoration', CAST(decorations.id AS TEXT), name_es, name_en, 'slot ' || slot, rarity
  FROM decorations JOIN _load_order o ON o.tbl = 'decorations' AND o.id = decorations.id 
  ORDER BY o.seq;

INSERT INTO search_index
  SELECT 'charm', CAST(charms.id AS TEXT), name_es, name_en, '', rarity
  FROM charms JOIN _load_order o ON o.tbl = 'charms' AND o.id = charms.id 
  ORDER BY o.seq;

INSERT INTO search_index
  SELECT 'skill', CAST(id AS TEXT), name_es, name_en, '', 0
  FROM skills 
  ORDER BY rowid;

INSERT INTO search_index
  SELECT 'quest', CAST(quests.id AS TEXT), name_es, name_en, coalesce(category, '') || ' · ' || coalesce(rank, ''), stars
  FROM quests JOIN _load_order o ON o.tbl = 'quests' AND o.id = quests.id 
  ORDER BY o.seq;

INSERT INTO search_index
  SELECT 'location', CAST(locations.id AS TEXT), name_es, name_en, kind, 0
  FROM locations JOIN _load_order o ON o.tbl = 'locations' AND o.id = locations.id 
  ORDER BY o.seq;

INSERT INTO search_index
  SELECT 'layered', slug, name_es, name_en, category, 0
  FROM layered_armor 
  ORDER BY rowid;

INSERT INTO search_index
  SELECT 'achievement', slug, name_es, name_en, coalesce(category, ''), sort_order
  FROM achievements 
  ORDER BY rowid;

INSERT INTO search_index
  SELECT 'guide', slug, title_es, title_en, kind, 0
  FROM guides 
  ORDER BY rowid;

DROP TABLE _load_order;
