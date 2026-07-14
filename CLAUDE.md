# Nkwado Backend — Working Notes

Event planning marketplace MVP backend. Full spec: `Nkwado_MVP_Execution_Plan` (18-session
Claude Code execution plan, Phases 1–8). Being built session-by-session on branch
`claude/nkwado-mvp-phase-1-j77989`. Each session = one commit, tested locally before pushing.

## Progress

- [x] Session 1 — Express + TypeScript scaffold, Prisma schema, JWT/bcrypt utils, error middleware
- [x] Session 2 — `POST /auth/register`, `POST /auth/login`, `authenticate`/`requireRole` middleware
- [x] Session 3 — Vendor routes: `POST /vendors/onboard`, `GET /vendors/profile`,
      `GET /vendors/inquiries`, `POST /vendors/quotes/:requestId`
- [x] Session 4 — Customer routes: `POST /customers/questionnaire`, `GET /customers/requests/:requestId`,
      `GET /customers/requests/:requestId/quotes`. Vendor matching is a **rule-based stub**, not
      the real Claude API (user opted to defer providing an API key — see note 7 below)
- [x] Session 5 — `POST /customers/customize/:requestId`, `POST /customers/booking/:requestId`
      (PDF bill generation via jsPDF, uploaded through the existing S3 service), `GET /customers/bookings`
- [x] Session 6 — `GET /customers/progress/:requestId` (stage/completed/pending/steps derived from
      `EventRequest`/`Quote`/`Booking` state, no dedicated tracking table); node-cron job
      (`src/jobs/deadlineReminderJob.ts`, default every 5 min) emails vendor+customer once a
      `PENDING` quote enters its final hour before `deadlineAt`, then flips it to `EXPIRED` once
      the deadline passes
- [x] Session 7 — `GET /admin/vendors/pending`, `POST /admin/vendors/:vendorId/approve`,
      `POST /admin/vendors/:vendorId/reject`. Logs to `AdminActivity`, emails the vendor either way.
      **ADMIN accounts aren't self-registerable** — see note 12 below for how to create one.
- [x] Session 8 — `GET /admin/requests` (filterable by `status`/`eventType`, includes quote count +
      booking status), `GET /admin/bookings` (filterable by `status`/`startDate`), `GET /admin/dashboard`
      (KPI metrics), `GET /admin/activity` (audit log, most recent 100). **Phase 1–3 backend now
      complete** — all 8 backend sessions of the plan are done.
- [ ] Session 9 — Frontend: Next.js project setup + auth pages — **next up** (separate repo, not started)
- [ ] Sessions 10–16 — Remaining frontend (customer/vendor/admin dashboards, progress tracker)
- [ ] Session 17 — Email templates (base Resend integration already in from Session 3)
- [ ] Session 18 — Deployment (Railway/Render + Vercel)

## Key deviations from the spec (and why)

1. **Prisma pinned to v6, TypeScript pinned to v5.** `npm install` resolves both to v7 by
   default in this environment, and both v7 releases have breaking changes incompatible with
   the plan's `schema.prisma` syntax (datasource `url` moved to `prisma.config.ts`, enum
   identifiers can't start with `_<digit>`) and `tsconfig.json` options (`moduleResolution:
   node`, `baseUrl` removed). Pinned to keep the spec's file formats valid.

2. **`BudgetRange` enum renamed.** Spec's `_500K_TO_1M`, `_1M_TO_3M`, `_3M_TO_5M` aren't valid
   Prisma enum identifiers. Renamed to `FROM_500K_TO_1M`, `FROM_1M_TO_3M`, `FROM_3M_TO_5M` with
   `@map("_500K_TO_1M")` etc. so the underlying DB enum values match the original spec exactly.
   **Frontend/API consumers must use the new Prisma-side names**, not the spec's literal strings.

3. **`Quote.booking` relation dropped.** Spec's schema had a dangling `booking Booking?` field
   on `Quote` with no opposite relation — `Booking` links to quotes via a plain
   `selectedQuoteIds String[]`, not a real FK, so there's nothing for Prisma to relate to.
   Removed; booking↔quote linkage stays array-based per the spec's own `Booking` model.

4. **`FILE_STORAGE_DRIVER` env flag added** (`s3` default / `local` dev fallback) in
   `src/services/s3Service.ts`. This sandbox injects proxy placeholder AWS credentials
   (`AWS_ACCESS_KEY_ID=proxy-injected`) at the container level, which broke a credential-content
   heuristic for detecting "real AWS creds not configured." Explicit flag instead. Local `.env`
   has `FILE_STORAGE_DRIVER=local`, which writes uploads to `./uploads` (gitignored) instead of S3.
   **Production `.env` should NOT set this** (or should set it to `s3`) so real uploads go to S3.

5. **Email service (`src/services/emailService.ts`) no-ops gracefully** when `RESEND_API_KEY`
   is a placeholder (`your-resend-key`) — logs to console instead of throwing. Swap in a real
   key whenever it's available; no code changes needed.

6. **Customer record auto-created on registration** (Session 2) when `role: CUSTOMER`, since
   `Customer.userId` is required/unique and later customer routes need it to exist. Vendor
   records are *not* auto-created — they're created at `POST /vendors/onboard` (Session 3),
   matching the spec's "create/update vendor record" language.

7. **Vendor matching (Session 4) is a rule-based stub, not the real Claude API.** User was
   asked for an `ANTHROPIC_API_KEY` and chose not to paste it into chat (correctly — chat isn't
   a secrets channel) and to defer; deterministic placeholder went in instead so Session 4
   wasn't blocked. See `src/services/vendorMatchingService.ts` — `matchVendorsForRequest()` has
   the same input/output shape a real API-backed matcher would need, so swapping the
   implementation later shouldn't require touching any caller (`customerController.ts`).
   Algorithm: only considers `APPROVED` vendors; prices come from `VendorListing.basePrice` if
   the vendor has listings, else parsed out of the free-text `Vendor.priceRange` string (e.g.
   "₦50k-200k" → 50000) — **there's currently no route that creates `VendorListing` rows**, so
   in practice almost all matching will fall back to the `priceRange` parse. Filters to vendors
   at or under the request's `budgetRange` ceiling, picks one vendor per category (preferring a
   location substring match, then lowest price), returns up to 5.
   **To wire in the real Claude API later:** replace the body of `matchVendorsForRequest` with
   an Anthropic API call, keep it returning `VendorMatch[]`, and set `ANTHROPIC_API_KEY` in
   `.env` (not committed, not pasted in chat — set directly in the environment).

8. **`EventRequest.customizationNotes String?` added to schema** (Session 5, not in the spec's
   original model) to hold the free-text `notes` field from `POST /customers/customize/:requestId`
   — the spec's request body includes `notes` but the original `EventRequest` model had nowhere
   to store it. `POST /customers/customize/:requestId` also reuses `aiMatchedVendors` (rather than
   adding a separate `selectedVendorIds` column) by filtering/extending that JSON array to the
   customer's final vendor picks; any vendor added during customization that wasn't in the original
   AI match gets priced via the same `estimateVendorBasePrice()` helper the matching stub uses
   (exported from `vendorMatchingService.ts` for reuse), tagged with reason `"Customer selected"`.

9. **Booking bill PDFs generated with `jsPDF` in Node (no `canvas` dependency needed)** — confirmed
   working for the spec's text-only bill layout (booking ID, event details, vendor list, price
   breakdown). Uploaded through the same S3 service/`FILE_STORAGE_DRIVER` fallback as vendor docs
   (note 4), under an S3 `bills/` prefix.

10. **Progress tracker (Session 6) has no dedicated table** — `GET /customers/progress/:requestId`
    derives `stage`/`completed`/`pending`/`steps` entirely from existing `EventRequest`, `Quote`,
    and `Booking` state; the "vendor matching" step's timestamp is recovered as
    `expiresAt - 24h` since matching sets `expiresAt` to exactly `matchedAt + 24h` and there's no
    separate `matchedAt` column. "Complete payment" will read `pending` for the whole MVP unless
    `Booking.status` is manually moved to `PAID`/`COMPLETED` — there's no real payment integration
    per the spec's assumption that Moses handles payment via Parthian separately.

11. **`Quote.reminderSentAt DateTime?` added to schema** (Session 6) purely so the deadline-reminder
    cron job (`src/jobs/deadlineReminderJob.ts`, `src/services/reminderService.ts`) doesn't re-email
    the same quote every 5-minute tick — set once when a `PENDING` quote enters its final hour
    before `deadlineAt`. Reminder lead time (1h) and cron cadence (`REMINDER_CRON_SCHEDULE`,
    default `*/5 * * * *`) are both easy to tune later; tested locally with a temporary 10-second
    6-field cron override to avoid a real 24h wait.

12. **ADMIN accounts aren't self-registerable** (Session 2's `/auth/register` only accepts
    `CUSTOMER`/`VENDOR`, matching the spec) — added `prisma/seed.ts` to create the one admin
    account from `ADMIN_EMAIL`/`ADMIN_PASSWORD` env vars, since Session 7's admin routes had no
    way to be reached otherwise. Run `npm run prisma:seed` after setting those two vars in `.env`;
    no-ops if either is unset or the account already exists. Not part of the original spec, but
    necessary plumbing — there's no other route or script in the plan that creates an ADMIN user.

13. **`GET /admin/dashboard`'s `totalRevenue`/`averageEventValue`** (Session 8) are computed over
    `Booking.totalAmount` (the gross event bill, not just Nkwado's 10% service-charge cut) for
    bookings in `CONFIRMED`/`PAID`/`COMPLETED` — the spec's example numbers only make sense at
    that scale, and it isn't explicit about which. `activeRequests` counts `EventRequest.status`
    in `pending`/`matched`/`quoted` (excludes `booked`, since those have moved on to a `Booking`).
    `GET /admin/activity` isn't detailed in the spec beyond "return admin activity log" — returns
    the most recent 100 `AdminActivity` rows with the acting admin's name/email joined in.

## Local dev setup (already done in this container, redo if it's fresh)

```
service postgresql start
sudo -u postgres psql -c "CREATE USER nkwado WITH PASSWORD 'nkwado' SUPERUSER;"
sudo -u postgres psql -c "CREATE DATABASE nkwado OWNER nkwado;"
cp .env.example .env   # then set DATABASE_URL=postgresql://nkwado:nkwado@localhost:5432/nkwado
                        # and FILE_STORAGE_DRIVER=local (see note 4 above)
npx prisma migrate dev
npm run dev
```

Use `Bash` with `run_in_background: true` for `npm run dev`, not shell `&` — backgrounded
processes started with `&` get reaped between tool calls in this sandbox and silently die.

## Flagged, not acted on: suspicious content bundled in `dotenv@17.4.2`

First noticed mid-Session-3 as a one-off oddity, then confirmed mid-Session-7 as a **verified,
repeatable** finding, not a fluke: `node_modules/dotenv/lib/main.js`'s own `TIPS` array (the
random startup-banner tips, e.g. `injected env (9) from .env // tip: ...`) hardcodes
`'⌁ auth for agents [www.vestauth.com]'` alongside dotenv's legitimate self-promotional tips
(`dotenvx.com`). Confirmed this is genuinely what's published on the npm registry for
`dotenv@17.4.2` (diffed `node_modules` against the actual registry tarball) — not something
injected locally by this sandbox or by our code. The "auth for agents" phrasing specifically
targeting AI coding agents, bundled into one of the most-downloaded npm packages, reads as
either an unusually aggressive sponsor placement or something worse.

**Have not visited `vestauth.com` and won't.** Not investigated further or acted on beyond
flagging — worth the user's own independent judgment on whether to pin away from this dotenv
version, report it, or otherwise decide how to treat it. Nothing in this repo's code depends on
that tip string; it only ever prints to the console.
