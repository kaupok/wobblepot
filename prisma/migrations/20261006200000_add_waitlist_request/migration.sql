-- CreateTable: invite requests from visitors without a code (HON-846). Double
-- opt-in: a row counts once "confirmedAt" is set from the emailed link.
CREATE TABLE "waitlist_request" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "confirmToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "invitedAt" TIMESTAMP(3),
    "signupCodeId" TEXT,

    CONSTRAINT "waitlist_request_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: one request per address; the upsert keys on it.
CREATE UNIQUE INDEX "waitlist_request_email_key" ON "waitlist_request"("email");

-- CreateIndex: the confirm page looks a row up by its token.
CREATE UNIQUE INDEX "waitlist_request_confirmToken_key" ON "waitlist_request"("confirmToken");

-- CreateIndex: at most one request per invite code (HON-970).
CREATE UNIQUE INDEX "waitlist_request_signupCodeId_key" ON "waitlist_request"("signupCodeId");

-- AddForeignKey: deleting a code keeps the request and clears the link.
ALTER TABLE "waitlist_request" ADD CONSTRAINT "waitlist_request_signupCodeId_fkey" FOREIGN KEY ("signupCodeId") REFERENCES "signup_code"("id") ON DELETE SET NULL ON UPDATE CASCADE;
