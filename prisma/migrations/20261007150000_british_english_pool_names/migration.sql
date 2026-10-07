-- HON-1099: British English names for the rest of the global ingredient pool,
-- the rows no seeded recipe uses (HON-1083 renamed the ones a plan shows,
-- HON-1097 merged the ones with a British twin). `pnpm db:seed` finds a global
-- row by its name, so the seed rename needs each row renamed in place first
-- (docs/RUNBOOKS/translation-maintenance.md → "Renaming a seeded ingredient or
-- meal"). Same id, so meal components, pantry rows, shopping items, excluded
-- ingredients and the et translations follow it. Every new name was free in
-- the global pool, so no row can collide with `ingredient_global_name_key`.
--
-- Only global rows (householdId IS NULL) are touched: a household's copy is the
-- household's own data. Matching on the old name makes a second run, or a fresh
-- database that never had the row, change nothing; the seed then creates the
-- row under its new name.

UPDATE "ingredient" AS i
SET "name" = r.new_name
FROM (
  VALUES
    ('red bell pepper',              'red pepper'),
    ('green bell pepper',            'green pepper'),
    ('yellow bell pepper',           'yellow pepper'),
    ('all-purpose flour',            'plain flour'),
    ('whole wheat flour',            'wholemeal flour'),
    ('whole wheat pasta',            'wholewheat pasta'),
    ('powdered sugar',               'icing sugar'),
    ('cornstarch',                   'cornflour'),
    ('corn meal',                    'cornmeal'),
    ('corn flakes',                  'cornflakes'),
    ('baking soda',                  'bicarbonate of soda'),
    ('phyllo dough',                 'filo pastry'),
    ('papadum',                      'poppadom'),
    ('gelatin',                      'gelatine'),
    ('half and half',                'single cream'),
    ('plain yogurt',                 'natural yogurt'),
    ('canola oil',                   'rapeseed oil'),
    ('pepitas',                      'pumpkin seeds'),
    ('fava beans',                   'broad beans'),
    ('black-eyed peas',              'black-eyed beans'),
    ('cranberry beans',              'borlotti beans'),
    ('cremini mushroom',             'chestnut mushroom'),
    ('napa cabbage',                 'chinese leaf'),
    ('rutabaga',                     'swede'),
    ('roma tomato',                  'plum tomato'),
    ('sunchoke',                     'jerusalem artichoke'),
    ('grape leaves',                 'vine leaves'),
    ('ramp',                         'wild garlic'),
    ('vanilla bean',                 'vanilla pod'),
    ('anise seed',                   'aniseed'),
    ('cornish hen',                  'poussin'),
    ('ham steak',                    'gammon steak'),
    ('baby shrimp',                  'small prawns'),
    ('cooked shrimp',                'cooked prawns'),
    ('shrimp peeled',                'peeled prawns'),
    ('canned anchovies',             'tinned anchovies'),
    ('canned mackerel',              'tinned mackerel'),
    ('canned salmon',                'tinned salmon'),
    ('canned sardines',              'tinned sardines'),
    ('canned pumpkin',               'tinned pumpkin'),
    ('canned diced tomatoes',        'tinned chopped tomatoes'),
    ('canned whole peeled tomatoes', 'tinned plum tomatoes'),
    ('canned green chiles',          'tinned green chillies'),
    ('coconut milk canned',          'tinned coconut milk'),
    ('chili oil',                    'chilli oil'),
    ('chili garlic sauce',           'chilli garlic sauce'),
    ('sweet chili sauce',            'sweet chilli sauce'),
    ('thai chili',                   'thai chilli'),
    ('ancho chili powder',           'ancho chilli powder'),
    ('kashmiri chili powder',        'kashmiri chilli powder'),
    ('arbol chili',                  'arbol chilli'),
    ('calabrian chili',              'calabrian chilli'),
    ('guajillo chili',               'guajillo chilli'),
    ('pasilla chili',                'pasilla chilli')
) AS r(old_name, new_name)
WHERE i."name" = r.old_name
  AND i."householdId" IS NULL;
