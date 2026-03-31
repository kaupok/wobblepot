-- Add Ethiopian spices and staples (HON-415)
-- Adds 9 new ingredients for Ethiopian cuisine coverage.
-- Uses ON CONFLICT DO NOTHING for idempotency.

-- Spices & Spice Blends
INSERT INTO "ingredient" ("id", "name", "category", "subcategory", "defaultUnit", "allergens", "calories", "protein", "carbs", "fat", "fiber")
VALUES
  (gen_random_uuid()::text, 'berbere', 'spice', 'spice blend', 'g', '{}', 340, 12, 50, 8, 20),
  (gen_random_uuid()::text, 'mitmita', 'spice', 'spice blend', 'g', '{}', 330, 11, 48, 10, 18),
  (gen_random_uuid()::text, 'korarima', 'spice', 'whole spice', 'g', '{}', 311, 11, 68, 7, 28),
  (gen_random_uuid()::text, 'besobela', 'spice', 'dried herb', 'g', '{}', 233, 14, 48, 4, 26)
ON CONFLICT ("name") DO NOTHING;

-- Fats
INSERT INTO "ingredient" ("id", "name", "category", "subcategory", "defaultUnit", "allergens", "calories", "protein", "carbs", "fat", "fiber")
VALUES
  (gen_random_uuid()::text, 'niter kibbeh', 'fat', 'flavored butter', 'g', '{dairy}', 876, 0.3, 0, 99, 0)
ON CONFLICT ("name") DO NOTHING;

-- Carbs / Grains
INSERT INTO "ingredient" ("id", "name", "category", "subcategory", "defaultUnit", "allergens", "calories", "protein", "carbs", "fat", "fiber")
VALUES
  (gen_random_uuid()::text, 'teff flour', 'carb', 'flour', 'g', '{}', 367, 13, 73, 2.4, 8)
ON CONFLICT ("name") DO NOTHING;

INSERT INTO "ingredient" ("id", "name", "category", "subcategory", "defaultUnit", "allergens", "calories", "protein", "carbs", "fat", "fiber", "gramsPerPiece")
VALUES
  (gen_random_uuid()::text, 'injera', 'carb', 'flatbread', 'piece', '{}', 145, 5.5, 27, 1.2, 2.8, 70)
ON CONFLICT ("name") DO NOTHING;

-- Legumes
INSERT INTO "ingredient" ("id", "name", "category", "subcategory", "defaultUnit", "allergens", "calories", "protein", "carbs", "fat", "fiber")
VALUES
  (gen_random_uuid()::text, 'shiro powder', 'legume', 'flour blend', 'g', '{}', 364, 22, 58, 5, 10)
ON CONFLICT ("name") DO NOTHING;

-- Condiments / Pastes
INSERT INTO "ingredient" ("id", "name", "category", "subcategory", "defaultUnit", "allergens", "calories", "protein", "carbs", "fat", "fiber")
VALUES
  (gen_random_uuid()::text, 'awaze paste', 'condiment', 'paste', 'g', '{}', 150, 3, 18, 7, 5)
ON CONFLICT ("name") DO NOTHING;
