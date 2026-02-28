-- AlterTable
ALTER TABLE "meal" ADD COLUMN "sourceUrl" TEXT;

-- DataMigration: Extract "Source: <url>" from preparationNotes into sourceUrl
UPDATE "meal"
SET
  "sourceUrl" = substring("preparationNotes" FROM '^Source: (.+?)(\n|$)'),
  "preparationNotes" = CASE
    WHEN "preparationNotes" ~ '^Source: .+?\n\n'
      THEN substring("preparationNotes" FROM '^Source: .+?\n\n([\s\S]*)$')
    WHEN "preparationNotes" ~ '^Source: .+$'
      THEN NULL
    ELSE "preparationNotes"
  END
WHERE "preparationNotes" LIKE 'Source: %';
