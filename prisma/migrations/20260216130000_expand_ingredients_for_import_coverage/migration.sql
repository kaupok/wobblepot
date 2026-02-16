-- Expand ingredient database for recipe import coverage (HON-320)
-- Adds ~60 commonly used recipe ingredients that were causing "unmatched" results
-- during recipe imports. Uses ON CONFLICT DO NOTHING for idempotency.

-- Spices & Seasonings
INSERT INTO "ingredient" ("id", "name", "category", "defaultUnit", "allergens", "calories", "protein", "carbs", "fat", "fiber")
VALUES
  (gen_random_uuid()::text, 'cayenne pepper', 'spice', 'g', '{}', 318, 12, 57, 17, 27),
  (gen_random_uuid()::text, 'fajita seasoning', 'spice', 'g', '{}', 310, 10, 55, 5, 12),
  (gen_random_uuid()::text, 'lemon pepper seasoning', 'spice', 'g', '{}', 270, 11, 58, 3, 26),
  (gen_random_uuid()::text, 'garlic salt', 'spice', 'g', '{}', 100, 2, 23, 0.5, 1),
  (gen_random_uuid()::text, 'mustard powder', 'spice', 'g', '{}', 508, 26, 28, 36, 12),
  (gen_random_uuid()::text, 'dried basil', 'spice', 'g', '{}', 233, 23, 48, 4, 38),
  (gen_random_uuid()::text, 'dried oregano', 'spice', 'g', '{}', 265, 9, 69, 4, 43),
  (gen_random_uuid()::text, 'dried parsley', 'spice', 'g', '{}', 292, 27, 50, 5, 27),
  (gen_random_uuid()::text, 'dried dill', 'spice', 'g', '{}', 253, 20, 56, 4, 12),
  (gen_random_uuid()::text, 'pumpkin pie spice', 'spice', 'g', '{}', 342, 7, 69, 9, 21),
  (gen_random_uuid()::text, 'seasoning salt', 'spice', 'g', '{}', 5, 0, 1, 0, 0),
  (gen_random_uuid()::text, 'celery seed', 'spice', 'g', '{}', 392, 18, 42, 25, 12)
ON CONFLICT ("name") DO NOTHING;

-- Chillies
INSERT INTO "ingredient" ("id", "name", "category", "defaultUnit", "allergens", "calories", "protein", "carbs", "fat", "fiber", "gramsPerPiece")
VALUES
  (gen_random_uuid()::text, 'red chilli', 'vegetable', 'piece', '{}', 40, 2, 9, 0.4, 1.5, 15),
  (gen_random_uuid()::text, 'green chilli', 'vegetable', 'piece', '{}', 40, 2, 9, 0.2, 1.5, 15),
  (gen_random_uuid()::text, 'bird''s eye chilli', 'spice', 'piece', '{}', 40, 2, 9, 0.4, 1.5, 5),
  (gen_random_uuid()::text, 'pepperoncini', 'vegetable', 'piece', '{}', 20, 1, 4, 0.3, 2, 15)
ON CONFLICT ("name") DO NOTHING;

-- Olives
INSERT INTO "ingredient" ("id", "name", "category", "defaultUnit", "allergens", "calories", "protein", "carbs", "fat", "fiber")
VALUES
  (gen_random_uuid()::text, 'black olive', 'condiment', 'g', '{}', 115, 0.8, 6, 11, 3.2),
  (gen_random_uuid()::text, 'green olive', 'condiment', 'g', '{}', 145, 1, 4, 15, 3.3),
  (gen_random_uuid()::text, 'kalamata olive', 'condiment', 'g', '{}', 235, 1.4, 4, 24, 2.5)
ON CONFLICT ("name") DO NOTHING;

-- Deli Meats
INSERT INTO "ingredient" ("id", "name", "category", "subcategory", "proteinType", "defaultUnit", "allergens", "calories", "protein", "carbs", "fat", "fiber")
VALUES
  (gen_random_uuid()::text, 'pepperoni', 'protein', 'pork', 'pork', 'g', '{}', 504, 22, 1, 46, 0),
  (gen_random_uuid()::text, 'salami', 'protein', 'pork', 'pork', 'g', '{}', 336, 22, 1, 26, 0)
ON CONFLICT ("name") DO NOTHING;

-- Produce Variants
INSERT INTO "ingredient" ("id", "name", "category", "defaultUnit", "allergens", "calories", "protein", "carbs", "fat", "fiber", "gramsPerPiece")
VALUES
  (gen_random_uuid()::text, 'red onion', 'vegetable', 'piece', '{}', 40, 1.1, 9.3, 0.1, 1.7, 150),
  (gen_random_uuid()::text, 'yellow onion', 'vegetable', 'piece', '{}', 40, 1.1, 9.3, 0.1, 1.7, 150),
  (gen_random_uuid()::text, 'sweet onion', 'vegetable', 'piece', '{}', 32, 0.8, 7.6, 0.1, 0.9, 150),
  (gen_random_uuid()::text, 'green bell pepper', 'vegetable', 'piece', '{}', 20, 0.9, 4.6, 0.2, 1.7, 150),
  (gen_random_uuid()::text, 'yellow bell pepper', 'vegetable', 'piece', '{}', 27, 1, 6.3, 0.2, 0.9, 150),
  (gen_random_uuid()::text, 'roma tomato', 'vegetable', 'piece', '{}', 18, 0.9, 3.9, 0.2, 1.2, 60)
ON CONFLICT ("name") DO NOTHING;

INSERT INTO "ingredient" ("id", "name", "category", "defaultUnit", "allergens", "calories", "protein", "carbs", "fat", "fiber")
VALUES
  (gen_random_uuid()::text, 'grape tomato', 'vegetable', 'g', '{}', 18, 0.9, 3.9, 0.2, 1.2),
  (gen_random_uuid()::text, 'baby spinach', 'vegetable', 'g', '{}', 23, 2.9, 3.6, 0.4, 2.2),
  (gen_random_uuid()::text, 'red cabbage', 'vegetable', 'g', '{}', 31, 1.4, 7.4, 0.2, 2.1),
  (gen_random_uuid()::text, 'green cabbage', 'vegetable', 'g', '{}', 25, 1.3, 5.8, 0.1, 2.5)
ON CONFLICT ("name") DO NOTHING;

-- Canned / Jarred
INSERT INTO "ingredient" ("id", "name", "category", "defaultUnit", "allergens", "calories", "protein", "carbs", "fat", "fiber")
VALUES
  (gen_random_uuid()::text, 'crushed tomatoes', 'condiment', 'g', '{}', 32, 1.6, 6.5, 0.3, 1.5),
  (gen_random_uuid()::text, 'fire-roasted tomatoes', 'condiment', 'g', '{}', 22, 1, 4.5, 0.2, 1),
  (gen_random_uuid()::text, 'canned pumpkin', 'vegetable', 'g', '{}', 34, 1.1, 8.1, 0.3, 2.9),
  (gen_random_uuid()::text, 'canned green chiles', 'vegetable', 'g', '{}', 25, 1, 5, 0.2, 1.5),
  (gen_random_uuid()::text, 'roasted red peppers', 'vegetable', 'g', '{}', 26, 0.9, 5.5, 0.2, 1.2),
  (gen_random_uuid()::text, 'tomato puree', 'condiment', 'g', '{}', 38, 1.6, 8.9, 0.2, 1.5)
ON CONFLICT ("name") DO NOTHING;

-- Sauces & Condiments
INSERT INTO "ingredient" ("id", "name", "category", "defaultUnit", "allergens", "calories", "protein", "carbs", "fat", "fiber", "densityGPerMl")
VALUES
  (gen_random_uuid()::text, 'enchilada sauce', 'condiment', 'g', '{}', 60, 1.5, 9, 2, 1, 1.05),
  (gen_random_uuid()::text, 'marinara sauce', 'condiment', 'g', '{}', 50, 1.5, 8, 1.5, 1.5, 1.05),
  (gen_random_uuid()::text, 'alfredo sauce', 'condiment', 'g', '{dairy}', 160, 4, 5, 14, 0, 1.05),
  (gen_random_uuid()::text, 'buffalo sauce', 'condiment', 'g', '{}', 33, 0.5, 7, 0.5, 0, 1.05),
  (gen_random_uuid()::text, 'ranch dressing', 'condiment', 'g', '{eggs,dairy}', 450, 2, 6, 47, 0, 1.0),
  (gen_random_uuid()::text, 'italian dressing', 'condiment', 'g', '{}', 280, 0.5, 10, 27, 0, 1.0),
  (gen_random_uuid()::text, 'balsamic glaze', 'condiment', 'g', '{}', 170, 0.5, 40, 0.1, 0, 1.3)
ON CONFLICT ("name") DO NOTHING;

-- Cheese
INSERT INTO "ingredient" ("id", "name", "category", "defaultUnit", "allergens", "calories", "protein", "carbs", "fat", "fiber")
VALUES
  (gen_random_uuid()::text, 'pepper jack cheese', 'dairy', 'g', '{dairy}', 370, 24, 1, 30, 0),
  (gen_random_uuid()::text, 'monterey jack cheese', 'dairy', 'g', '{dairy}', 373, 25, 1, 30, 0),
  (gen_random_uuid()::text, 'swiss cheese', 'dairy', 'g', '{dairy}', 380, 27, 5, 28, 0),
  (gen_random_uuid()::text, 'colby jack cheese', 'dairy', 'g', '{dairy}', 394, 24, 2, 32, 0)
ON CONFLICT ("name") DO NOTHING;

-- Dairy
INSERT INTO "ingredient" ("id", "name", "category", "defaultUnit", "allergens", "calories", "protein", "carbs", "fat", "fiber", "densityGPerMl")
VALUES
  (gen_random_uuid()::text, 'half and half', 'dairy', 'g', '{dairy}', 130, 3, 4.3, 12, 0, 1.03)
ON CONFLICT ("name") DO NOTHING;

INSERT INTO "ingredient" ("id", "name", "category", "defaultUnit", "allergens", "calories", "protein", "carbs", "fat", "fiber")
VALUES
  (gen_random_uuid()::text, 'whipped cream', 'dairy', 'g', '{dairy}', 257, 3, 13, 22, 0)
ON CONFLICT ("name") DO NOTHING;

-- Baking / Grains
INSERT INTO "ingredient" ("id", "name", "category", "subcategory", "defaultUnit", "allergens", "calories", "protein", "carbs", "fat", "fiber")
VALUES
  (gen_random_uuid()::text, 'self-raising flour', 'carb', 'flour', 'g', '{gluten}', 349, 9, 74, 1, 2),
  (gen_random_uuid()::text, 'whole wheat pasta', 'carb', NULL, 'g', '{gluten}', 348, 15, 75, 1.4, 8),
  (gen_random_uuid()::text, 'angel hair pasta', 'carb', NULL, 'g', '{gluten}', 371, 13, 75, 1.5, 3.2),
  (gen_random_uuid()::text, 'elbow macaroni', 'carb', NULL, 'g', '{gluten}', 371, 13, 75, 1.5, 3.2)
ON CONFLICT ("name") DO NOTHING;

-- Proteins (sausage types)
INSERT INTO "ingredient" ("id", "name", "category", "subcategory", "proteinType", "defaultUnit", "allergens", "calories", "protein", "carbs", "fat", "fiber")
VALUES
  (gen_random_uuid()::text, 'andouille sausage', 'protein', 'pork', 'pork', 'g', '{}', 231, 14, 2, 18, 0),
  (gen_random_uuid()::text, 'breakfast sausage', 'protein', 'pork', 'pork', 'g', '{}', 339, 14, 1, 31, 0),
  (gen_random_uuid()::text, 'kielbasa', 'protein', 'pork', 'pork', 'g', '{}', 325, 14, 4, 28, 0),
  (gen_random_uuid()::text, 'smoked sausage', 'protein', 'pork', 'pork', 'g', '{}', 295, 12, 2, 27, 0)
ON CONFLICT ("name") DO NOTHING;

-- Miscellaneous
INSERT INTO "ingredient" ("id", "name", "category", "defaultUnit", "allergens", "calories", "protein", "carbs", "fat", "fiber", "densityGPerMl")
VALUES
  (gen_random_uuid()::text, 'canola oil', 'fat', 'g', '{}', 884, 0, 0, 100, 0, 0.92)
ON CONFLICT ("name") DO NOTHING;

INSERT INTO "ingredient" ("id", "name", "category", "defaultUnit", "allergens", "calories", "protein", "carbs", "fat", "fiber", "densityGPerMl")
VALUES
  (gen_random_uuid()::text, 'cooking spray', 'fat', 'g', '{}', 884, 0, 0, 100, 0, NULL),
  (gen_random_uuid()::text, 'liquid honey', 'condiment', 'g', '{}', 304, 0.3, 82, 0, 0.2, 1.42)
ON CONFLICT ("name") DO NOTHING;
