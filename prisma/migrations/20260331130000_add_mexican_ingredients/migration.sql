-- Add Mexican dried chilies and specialty ingredients (HON-418)
-- Adds 6 new ingredients for Mexican cuisine coverage.
-- Uses ON CONFLICT DO NOTHING for idempotency.

-- Dried Chilies
INSERT INTO "ingredient" ("id", "name", "category", "subcategory", "defaultUnit", "allergens", "calories", "protein", "carbs", "fat", "fiber")
VALUES
  (gen_random_uuid()::text, 'guajillo chili', 'spice', 'dried chili', 'g', '{}', 324, 11, 56, 6, 29),
  (gen_random_uuid()::text, 'pasilla chili', 'spice', 'dried chili', 'g', '{}', 324, 11, 56, 6, 29),
  (gen_random_uuid()::text, 'arbol chili', 'spice', 'dried chili', 'g', '{}', 324, 11, 56, 6, 29)
ON CONFLICT ("name") DO NOTHING;

-- Dairy
INSERT INTO "ingredient" ("id", "name", "category", "subcategory", "defaultUnit", "allergens", "calories", "protein", "carbs", "fat", "fiber")
VALUES
  (gen_random_uuid()::text, 'queso oaxaca', 'dairy', 'cheese', 'g', '{dairy}', 316, 25, 2, 23, 0)
ON CONFLICT ("name") DO NOTHING;

-- Vegetables / Fungi
INSERT INTO "ingredient" ("id", "name", "category", "subcategory", "defaultUnit", "allergens", "calories", "protein", "carbs", "fat", "fiber")
VALUES
  (gen_random_uuid()::text, 'huitlacoche', 'vegetable', 'fungus', 'g', '{}', 35, 3.5, 4, 0.7, 2)
ON CONFLICT ("name") DO NOTHING;

-- Sweeteners
INSERT INTO "ingredient" ("id", "name", "category", "subcategory", "defaultUnit", "allergens", "calories", "protein", "carbs", "fat", "fiber")
VALUES
  (gen_random_uuid()::text, 'piloncillo', 'condiment', 'sweetener', 'g', '{}', 375, 0.4, 93, 0.1, 0)
ON CONFLICT ("name") DO NOTHING;
