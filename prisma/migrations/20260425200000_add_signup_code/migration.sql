-- CreateTable: single-use sign-up codes that gate /sign-up while the launch is invite-only.
CREATE TABLE "signup_code" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedById" TEXT,
    "usedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "signup_code_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: unique code is the load-bearing constraint for the atomic claim
-- (UPDATE ... WHERE code = $1 AND usedAt IS NULL).
CREATE UNIQUE INDEX "signup_code_code_key" ON "signup_code"("code");

-- CreateIndex: at most one user per code.
CREATE UNIQUE INDEX "signup_code_usedById_key" ON "signup_code"("usedById");

-- CreateIndex: foreign-key index for the createdById lookup path.
CREATE INDEX "signup_code_createdById_idx" ON "signup_code"("createdById");

-- AddForeignKey: nullable so the first code can be seeded before any admin exists,
-- and so deleting an admin user does not delete their issued codes (audit trail).
ALTER TABLE "signup_code" ADD CONSTRAINT "signup_code_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: nullable; deleting the user that claimed a code keeps the historical
-- record of the code being used while clearing the relationship.
ALTER TABLE "signup_code" ADD CONSTRAINT "signup_code_usedById_fkey" FOREIGN KEY ("usedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
