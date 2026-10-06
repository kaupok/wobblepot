-- HON-1083: British English names for the seeded ingredients and recipes a
-- household meets in a plan. `pnpm db:seed` finds a global row by its name, so
-- the seed rename needs each row renamed in place first
-- (docs/RUNBOOKS/translation-maintenance.md → "Renaming a seeded ingredient or
-- meal"). Same id, so meal components, pantry rows, shopping items, plan
-- entries, favourites and the et translations follow it. Every new name was
-- free in the global pool, so no statement can collide with
-- `ingredient_global_name_key`.
--
-- Only global rows (householdId IS NULL) are touched: a household's copy is the
-- household's own data. Matching on the old name makes a second run, or a fresh
-- database that never had the row, change nothing; the seed then creates the
-- row under its new name.

-- Ingredients

UPDATE "ingredient"
SET "name" = 'passata'
WHERE "name" = 'tomato sauce'
  AND "householdId" IS NULL;

UPDATE "ingredient"
SET "name" = 'beef mince'
WHERE "name" = 'ground beef'
  AND "householdId" IS NULL;

UPDATE "ingredient"
SET "name" = 'soured cream'
WHERE "name" = 'sour cream'
  AND "householdId" IS NULL;

UPDATE "ingredient"
SET "name" = 'pitta bread'
WHERE "name" = 'pita bread'
  AND "householdId" IS NULL;

UPDATE "ingredient"
SET "name" = 'chilli flakes'
WHERE "name" = 'chili flakes'
  AND "householdId" IS NULL;

UPDATE "ingredient"
SET "name" = 'courgette'
WHERE "name" = 'zucchini'
  AND "householdId" IS NULL;

UPDATE "ingredient"
SET "name" = 'pak choi'
WHERE "name" = 'bok choy'
  AND "householdId" IS NULL;

UPDATE "ingredient"
SET "name" = 'sweetcorn'
WHERE "name" = 'corn'
  AND "householdId" IS NULL;

UPDATE "ingredient"
SET "name" = 'aubergine'
WHERE "name" = 'eggplant'
  AND "householdId" IS NULL;

UPDATE "ingredient"
SET "name" = 'rocket'
WHERE "name" = 'arugula'
  AND "householdId" IS NULL;

UPDATE "ingredient"
SET "name" = 'chilli powder'
WHERE "name" = 'chili powder'
  AND "householdId" IS NULL;

UPDATE "ingredient"
SET "name" = 'lasagne sheets'
WHERE "name" = 'lasagna sheets'
  AND "householdId" IS NULL;

UPDATE "ingredient"
SET "name" = 'haricot beans'
WHERE "name" = 'navy beans'
  AND "householdId" IS NULL;

UPDATE "ingredient"
SET "name" = 'tinned tuna'
WHERE "name" = 'canned tuna'
  AND "householdId" IS NULL;

UPDATE "ingredient"
SET "name" = 'goat''s cheese'
WHERE "name" = 'goat cheese'
  AND "householdId" IS NULL;

-- Recipes. The description is set here too, not left to the seed: `seedMeals`
-- clears a meal's image when the stored description differs from the seed's
-- (HON-734), and this wording change does not change the dish the image shows.
-- Migrations run before the seed in every environment, so the seed then finds
-- the description already matching and keeps the image. The image columns are
-- left alone.

UPDATE "meal"
SET "name" = 'Prawn Stir-Fry',
    "description" = 'Quick prawn stir-fry with vegetables',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "name" = 'Shrimp Stir-Fry'
  AND "householdId" IS NULL;

UPDATE "meal"
SET "name" = 'Garlic Butter Prawns',
    "description" = 'Pan-seared prawns in garlic butter',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "name" = 'Garlic Butter Shrimp'
  AND "householdId" IS NULL;

UPDATE "meal"
SET "name" = 'Prawn Pad Thai',
    "description" = 'Thai stir-fried noodles with prawns',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "name" = 'Shrimp Pad Thai'
  AND "householdId" IS NULL;

UPDATE "meal"
SET "name" = 'Prawn Laksa',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "name" = 'Shrimp Laksa'
  AND "householdId" IS NULL;

UPDATE "meal"
SET "name" = 'Coconut Prawns',
    "description" = 'Crispy coconut-crusted prawns',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "name" = 'Coconut Shrimp'
  AND "householdId" IS NULL;

UPDATE "meal"
SET "name" = 'Pork Fillet with Vegetables',
    "description" = 'Roasted pork fillet with seasonal vegetables',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "name" = 'Pork Tenderloin with Vegetables'
  AND "householdId" IS NULL;

UPDATE "meal"
SET "name" = 'Stuffed Peppers',
    "description" = 'Peppers stuffed with rice and vegetables',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "name" = 'Stuffed Bell Peppers'
  AND "householdId" IS NULL;

UPDATE "meal"
SET "name" = 'Haricot Bean Stew',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "name" = 'Navy Bean Stew'
  AND "householdId" IS NULL;

UPDATE "meal"
SET "name" = 'Apple Cinnamon Porridge',
    "description" = 'Warm porridge with apple and cinnamon',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "name" = 'Apple Cinnamon Oatmeal'
  AND "householdId" IS NULL;

UPDATE "meal"
SET "name" = 'Three Bean Chilli',
    "description" = 'Hearty vegetarian bean chilli',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "name" = 'Three Bean Chili'
  AND "householdId" IS NULL;

UPDATE "meal"
SET "name" = 'Beef Chilli',
    "description" = 'Hearty chilli with beef mince',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "name" = 'Beef Chili'
  AND "householdId" IS NULL;

UPDATE "meal"
SET "name" = 'Aubergine Parmigiana',
    "description" = 'Breaded aubergine with tomato sauce and cheese',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "name" = 'Eggplant Parmesan'
  AND "householdId" IS NULL;

UPDATE "meal"
SET "name" = 'Goat''s Cheese and Beetroot Salad',
    "description" = 'Roasted beetroot with goat''s cheese and walnuts',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "name" = 'Goat Cheese Beet Salad'
  AND "householdId" IS NULL;

UPDATE "meal"
SET "name" = 'Lamb Pitta Pockets',
    "description" = 'Spiced lamb in warm pitta',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "name" = 'Lamb Pita Pockets'
  AND "householdId" IS NULL;

UPDATE "meal"
SET "name" = 'Classic Lasagne',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "name" = 'Classic Lasagna'
  AND "householdId" IS NULL;

UPDATE "meal"
SET "name" = 'Vegetable Lasagne',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "name" = 'Vegetable Lasagna'
  AND "householdId" IS NULL;

UPDATE "meal"
SET "name" = 'Cheese Toastie',
    "description" = 'Crispy, buttery cheese toastie',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "name" = 'Grilled Cheese Sandwich'
  AND "householdId" IS NULL;

UPDATE "meal"
SET "description" = 'Quick chicken stir-fry with colourful vegetables',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "name" = 'Chicken Stir-Fry'
  AND "householdId" IS NULL;

UPDATE "meal"
SET "description" = 'Seasoned beef mince in corn tortillas',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "name" = 'Beef Tacos'
  AND "householdId" IS NULL;

UPDATE "meal"
SET "description" = 'Spiced chicken with garlic sauce and pitta',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "name" = 'Chicken Shawarma'
  AND "householdId" IS NULL;

UPDATE "meal"
SET "description" = 'Spiced lamb in pitta with tahini',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "name" = 'Lamb Shawarma'
  AND "householdId" IS NULL;

UPDATE "meal"
SET "description" = 'Crispy falafel in pitta with tahini',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "name" = 'Falafel Wrap'
  AND "householdId" IS NULL;

UPDATE "meal"
SET "description" = 'Creamy hummus with vegetables and pitta',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "name" = 'Hummus Bowl'
  AND "householdId" IS NULL;

UPDATE "meal"
SET "description" = 'Lebanese salad with crispy pitta',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "name" = 'Fattoush Salad'
  AND "householdId" IS NULL;

UPDATE "meal"
SET "description" = 'Marinated sliced beef with sesame and spring onions',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "name" = 'Korean Beef Bulgogi'
  AND "householdId" IS NULL;

UPDATE "meal"
SET "description" = 'Greek layered lamb and aubergine bake',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "name" = 'Lamb Moussaka'
  AND "householdId" IS NULL;

UPDATE "meal"
SET "description" = 'Fresh rice paper rolls with prawns',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "name" = 'Vietnamese Spring Rolls'
  AND "householdId" IS NULL;

UPDATE "meal"
SET "description" = 'Breaded pork cutlet with rocket',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "name" = 'Pork Milanese'
  AND "householdId" IS NULL;
