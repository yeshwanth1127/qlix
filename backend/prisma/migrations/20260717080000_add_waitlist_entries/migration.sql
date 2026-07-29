CREATE TABLE "waitlist_entries" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "waitlist_entries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "waitlist_entries_contact_check" CHECK (
        ("email" IS NOT NULL AND "phone" IS NULL) OR
        ("email" IS NULL AND "phone" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "waitlist_entries_email_key" ON "waitlist_entries"("email");
CREATE UNIQUE INDEX "waitlist_entries_phone_key" ON "waitlist_entries"("phone");
