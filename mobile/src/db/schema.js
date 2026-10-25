// Schéma du carnet local (SQLite). Miroir des tables métier de Supabase SANS
// user_id ni RLS : le carnet appartient au téléphone. Règles (cadrage §4) :
// identifiants UUID en texte, dates ISO 8601 UTC en texte, tableaux et
// instantanés en JSON valide, clés étrangères actives par connexion.
//
// Chaque entrée de MIGRATIONS est appliquée dans UNE transaction avec son
// enregistrement dans schema_migrations : soit tout, soit rien.

export const SCHEMA_VERSION = 2;

export const MIGRATIONS = [
  {
    version: 1,
    name: "carnet_recettes",
    sql: `
create table recipes (
  id text primary key,
  title text not null,
  type text not null default 'hybride',
  source_type text not null default 'manual',
  is_ai_generated integer not null default 0,
  instructions text,
  batch_size_ref real,
  style text,
  boil_time real,
  expected_og real,
  expected_fg real,
  expected_abv real,
  expected_ibu real,
  expected_ebc real,
  current_version integer not null default 1,
  tags text not null default '[]',
  created_at text not null,
  updated_at text not null
);

create table recipe_phases (
  id text primary key,
  recipe_id text not null references recipes(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  duration_value real,
  duration_unit text,
  temperature_target real,
  notes text
);
create index recipe_phases_recipe on recipe_phases(recipe_id, sort_order);

create table recipe_ingredients (
  id text primary key,
  recipe_id text not null references recipes(id) on delete cascade,
  phase_id text references recipe_phases(id) on delete set null,
  category text not null default 'autre',
  name text not null,
  amount real not null default 0,
  unit text not null default 'g',
  sub_type text,
  alpha_acid_pct real,
  timing text,
  notes text,
  sort_order integer not null default 0,
  is_starter integer not null default 0
);
create index recipe_ingredients_recipe on recipe_ingredients(recipe_id, sort_order);

create table recipe_versions (
  id text primary key,
  recipe_id text not null references recipes(id) on delete cascade,
  version integer not null,
  snapshot text not null,
  created_at text not null
);
create index recipe_versions_recipe on recipe_versions(recipe_id, version);
`,
  },
  {
    // L2 : stock, brassins, journal, courses et le journal des mouvements de
    // stock (miroir des migrations Supabase 0001, 0005, 0008, 0010,
    // 20260706 shopping_list, 20260731 split, 20260816 rolling, 20260908
    // split_history, 20260909 stock_operations). Les colonnes stock_revision
    // portent la détection de conflit (une opération refuse une révision
    // périmée) ; stock_movements est le journal en ajout seul des prélèvements,
    // restitutions, achats et corrections ; stock_operation_requests mémorise
    // chaque opération (rejeu à l'identique = même résultat).
    version: 2,
    name: "carnet_complet",
    sql: `
create table ingredients (
  id text primary key,
  name text not null,
  quantity real not null default 0,
  unit text not null default 'g',
  category text not null default 'autre',
  expiry_date text,
  supplier text,
  low_stock_threshold real,
  stock_revision integer not null default 0,
  created_at text not null,
  updated_at text not null
);

create table ingredient_aliases (
  id text primary key,
  alias text not null unique,
  stock_name text not null,
  created_at text not null
);

create table batches (
  id text primary key,
  recipe_id text references recipes(id) on delete set null,
  title text not null,
  status text not null default 'planifie',
  current_phase_id text references recipe_phases(id) on delete set null,
  volume real,
  rating integer,
  notes text,
  created_at text not null,
  phase_started_at text,
  completed_at text,
  reminded_at text,
  parent_batch_id text references batches(id) on delete set null,
  starter_batch_id text references batches(id) on delete set null,
  starter_volume real,
  culture_generation integer,
  has_been_split integer not null default 0,
  stock_revision integer not null default 0
);
create index batches_recipe on batches(recipe_id);
create index batches_parent on batches(parent_batch_id);
create index batches_starter on batches(starter_batch_id);

create table batch_ingredients (
  id text primary key,
  batch_id text not null references batches(id) on delete cascade,
  phase_id text references recipe_phases(id) on delete set null,
  category text not null default 'autre',
  name text not null,
  amount real not null default 0,
  unit text not null default 'g',
  deducted integer not null default 0,
  deducted_at text,
  is_starter integer not null default 0,
  stock_movement_id text,
  stock_revision integer not null default 0
);
create index batch_ingredients_batch on batch_ingredients(batch_id);

create table batch_phase_log (
  id text primary key,
  batch_id text not null references batches(id) on delete cascade,
  stage text not null,
  phase_id text references recipe_phases(id) on delete set null,
  entered_at text not null
);
create index batch_phase_log_batch on batch_phase_log(batch_id, entered_at);

create table batch_journal (
  id text primary key,
  batch_id text not null references batches(id) on delete cascade,
  phase_id text references recipe_phases(id) on delete set null,
  timestamp text not null,
  content text not null,
  category text not null default 'observation'
);
create index batch_journal_batch on batch_journal(batch_id, timestamp);

create table shopping_list (
  id text primary key,
  name text not null,
  amount real,
  unit text not null default 'g',
  category text not null default 'autre',
  source text not null default 'manual',
  recipe_title text,
  checked integer not null default 0,
  checked_at text,
  stock_revision integer not null default 0,
  created_at text not null
);

create table stock_movements (
  id text primary key,
  request_id text not null,
  action text not null,
  batch_id text,
  line_id text,
  shopping_id text,
  stock_id text,
  amount real not null default 0,
  delta real not null default 0,
  unit text,
  reason text,
  reverses text unique,
  quantity_before real,
  quantity_after real,
  unit_before text,
  line_snapshot text,
  created_at text not null
);
create index stock_movements_request on stock_movements(request_id);
create index stock_movements_line on stock_movements(line_id);

create table stock_operation_requests (
  request_id text primary key,
  kind text not null,
  payload text not null,
  result text not null,
  created_at text not null
);
`,
  },
];

// Tables de données du carnet, dans l'ordre d'insertion (parents d'abord ;
// `batches` se référence lui-même : l'import trie parents avant enfants).
// Sert à l'export, à la restauration et aux contrôles d'intégrité.
export const DATA_TABLES = [
  "recipes",
  "recipe_phases",
  "recipe_ingredients",
  "recipe_versions",
  "ingredients",
  "ingredient_aliases",
  "batches",
  "batch_ingredients",
  "batch_phase_log",
  "batch_journal",
  "shopping_list",
  "stock_movements",
  "stock_operation_requests",
];
