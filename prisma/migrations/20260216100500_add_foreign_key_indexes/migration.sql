-- CreateIndex
CREATE INDEX "session_userId_idx" ON "session"("userId");

-- CreateIndex
CREATE INDEX "account_userId_idx" ON "account"("userId");

-- CreateIndex
CREATE INDEX "household_member_userId_idx" ON "household_member"("userId");

-- CreateIndex
CREATE INDEX "household_invite_householdId_idx" ON "household_invite"("householdId");

-- CreateIndex
CREATE INDEX "meal_plan_entry_mealId_idx" ON "meal_plan_entry"("mealId");

-- CreateIndex
CREATE INDEX "meal_plan_entry_date_idx" ON "meal_plan_entry"("date");

-- CreateIndex
CREATE INDEX "meal_householdId_idx" ON "meal"("householdId");

-- CreateIndex
CREATE INDEX "meal_component_ingredientId_idx" ON "meal_component"("ingredientId");

-- CreateIndex
CREATE INDEX "pantry_item_ingredientId_idx" ON "pantry_item"("ingredientId");

-- CreateIndex
CREATE INDEX "favorite_meal_mealId_idx" ON "favorite_meal"("mealId");
