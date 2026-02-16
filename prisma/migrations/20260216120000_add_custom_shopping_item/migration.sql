-- CreateTable
CREATE TABLE "custom_shopping_item" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ingredientId" TEXT,
    "checked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "custom_shopping_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "custom_shopping_item_ingredientId_idx" ON "custom_shopping_item"("ingredientId");

-- CreateIndex
CREATE UNIQUE INDEX "custom_shopping_item_householdId_name_key" ON "custom_shopping_item"("householdId", "name");

-- AddForeignKey
ALTER TABLE "custom_shopping_item" ADD CONSTRAINT "custom_shopping_item_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_shopping_item" ADD CONSTRAINT "custom_shopping_item_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "ingredient"("id") ON DELETE SET NULL ON UPDATE CASCADE;
