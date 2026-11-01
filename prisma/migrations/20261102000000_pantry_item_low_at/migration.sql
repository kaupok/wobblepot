-- HON-1586: a pantry row can be marked running low. Null means not low.
ALTER TABLE "pantry_item" ADD COLUMN "lowAt" TIMESTAMP(3);
