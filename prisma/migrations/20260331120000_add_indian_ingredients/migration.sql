-- Add Indian flours, spices, and condiments (HON-414)
-- Adds 7 new ingredients for Indian cuisine coverage.
-- Uses ON CONFLICT DO NOTHING for idempotency.

-- Spices & Spice Blends
INSERT INTO "ingredient" ("id", "name", "category", "subcategory", "defaultUnit", "allergens", "calories", "protein", "carbs", "fat", "fiber")
VALUES
  (gen_random_uuid()::text, 'kasuri methi', 'spice', 'dried herb', 'g', '{}', 323, 23, 58, 6, 25),
  (gen_random_uuid()::text, 'tandoori masala', 'spice', 'spice blend', 'g', '{}', 250, 10, 45, 5, 15),
  (gen_random_uuid()::text, 'chaat masala', 'spice', 'spice blend', 'g', '{}', 230, 8, 42, 4, 10)
ON CONFLICT ("name") DO NOTHING;

-- Flours
INSERT INTO "ingredient" ("id", "name", "category", "subcategory", "defaultUnit", "allergens", "calories", "protein", "carbs", "fat", "fiber")
VALUES
  (gen_random_uuid()::text, 'chapati flour', 'carb', 'flour', 'g', '{gluten}', 340, 12, 72, 1.5, 11)
ON CONFLICT ("name") DO NOTHING;

-- Flatbreads
INSERT INTO "ingredient" ("id", "name", "category", "subcategory", "defaultUnit", "allergens", "calories", "protein", "carbs", "fat", "fiber", "gramsPerPiece")
VALUES
  (gen_random_uuid()::text, 'papadum', 'carb', 'flatbread', 'piece', '{gluten}', 371, 25, 53, 6, 15, 10)
ON CONFLICT ("name") DO NOTHING;

-- Condiments
INSERT INTO "ingredient" ("id", "name", "category", "subcategory", "defaultUnit", "allergens", "calories", "protein", "carbs", "fat", "fiber")
VALUES
  (gen_random_uuid()::text, 'Indian pickle', 'condiment', 'pickle', 'g', '{}', 150, 2, 10, 12, 3)
ON CONFLICT ("name") DO NOTHING;

-- Dairy
INSERT INTO "ingredient" ("id", "name", "category", "subcategory", "defaultUnit", "allergens", "calories", "protein", "carbs", "fat", "fiber")
VALUES
  (gen_random_uuid()::text, 'raita', 'dairy', 'sauce', 'g', '{dairy}', 55, 3, 5, 2.5, 0.5)
ON CONFLICT ("name") DO NOTHING;
