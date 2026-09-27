# McAlister Storage — Boat Storage App (Phase 1)

A web app for running a boat storage business: customers, boats, spots, billing, and an incident log with photos.
Works in any browser on a computer, and on iPhone/iPad (add it to the home screen and it opens like an app).

The same code can run **any number of storage companies**, each with its own name, colors, database and photos.

---

## What's in Phase 1

| Area | What it does |
|---|---|
| **Sign in & roles** | Admin, Owner and Staff logins. First visit creates the Admin account. |
| **Dashboard** | Occupancy, money collected (month / quarter / year), outstanding and overdue, 12‑month chart, open incidents, insurance expiring, rentals ending, recent activity. Staff see a version without money. |
| **Customers (CRM)** | Contact info, emergency contact, status (active / prospect / inactive), boats with insurance details, notes timeline, photos & documents, history. One-tap Call / Text / Email on phones. |
| **Spots board** | Every building and spot at a glance — who's in each one, what's vacant. Tap a vacant spot to rent it. Notes and photos per spot. |
| **Invoices** | **Run billing** creates draft invoices for every rental due (monthly, quarterly or yearly). Review, then **Send all drafts**: emailed if the customer has an email, the rest combined into one PDF to print and mail. Record payments (check, cash, card, ACH), manual invoices for extra work, void, reprint. |
| **Incident log** | Incidents, equipment and facility issues with photos from the phone camera, notes, and open/resolved status. |
| **Setup** (Admin) | Company details & brand color, buildings & spots (add a whole range like A‑1…A‑40 at once), pricing by spot type, users, **Excel/CSV import** of existing customers, email settings, and a placeholder for online payments. |

Online payments (Stripe) are **not** turned on — Setup → Online payments shows where it will go. It's in Phase 3 of the plan and can be added later without changing anything above.

### Who can do what

| | Admin | Owner | Staff |
|---|:-:|:-:|:-:|
| Customers, boats, notes, photos | ✓ | ✓ | ✓ |
| Spots board, incident log | ✓ | ✓ | ✓ |
| Rentals & rates, invoices, money on dashboard | ✓ | ✓ | |
| Delete customers | ✓ | ✓ | |
| Setup, users, import | ✓ | | |

To change this, edit the one table at the top of `lib/auth.js`.

---

## Running it

Needs **Node.js 20 or newer**.

```bash
npm install
npm start
```

Open http://localhost:3000. The first person to open it creates the Admin account, then goes to **Setup** to:

1. Fill in company details (they print on invoices).
2. **Pricing** → add spot types and prices.
3. **Buildings & spots** → add buildings, then add spots.
4. **Import** → upload the existing customer spreadsheet (or add customers by hand). Download the template to see the columns it understands; it also recognizes most common column names on its own, and you confirm the matches before anything is saved.
5. **Email** → enter the SMTP details so invoices can be emailed (Gmail, Outlook/365, or any provider). Until then everything can be printed.
6. **Users** → add owners and staff.

### Try it with sample data first

```bash
COMPANY=demo-marina npm run seed-demo
COMPANY=demo-marina PORT=3100 npm start
```

Sign in as `admin@demo.test`, `owner@demo.test` or `staff@demo.test` (password `demo1234`) to see each role.

---

## Duplicating for another storage company

Every company is a folder in `companies/`:

```
companies/
  mcalister-storage/
    company.json      ← starting name, invoice prefix, terms, color
    data/             ← created automatically: database + uploaded photos
  harbor-point-storage/
    ...
```

To add one:

```bash
npm run new-company -- "Harbor Point Storage"
COMPANY=harbor-point-storage npm start
```

Each company is completely separate — own logins, customers, invoices, photos and branding. Run one server per company (for example each on its own web address), all from this one copy of the code. Fixes and new features apply to all of them.

---

## Putting it online

It's a standard Node.js app, so it runs on most hosts (Railway, Render, Fly.io, a small VPS).

- Set `COMPANY=mcalister-storage` and `NODE_ENV=production`.
- The database is a single file. Put it on **persistent storage** by pointing `DATA_DIR` at a mounted volume (e.g. `DATA_DIR=/data`), otherwise data is lost when the host restarts.
- Use HTTPS (hosts provide this). Sessions last 30 days so phones stay signed in.
- **Back up** the `data` folder regularly — it holds everything.

Optional environment variables: `PORT` (default 3000), `SESSION_SECRET` (otherwise generated and saved in the data folder), `COMPANIES_DIR`.

---

## How it's built (for a developer)

- **Server:** Node.js + Express 5, SQLite (better-sqlite3), PDFKit for invoices, Nodemailer for email, ExcelJS for import.
- **Front end:** plain JavaScript modules, no build step. Mobile-first CSS, light and dark mode, installable to home screen.
- Money is stored in cents; dates as `YYYY-MM-DD`.

```
server.js            app setup
lib/                 database, billing math, PDF, email, import, permissions
routes/              API: auth, setup, customers, invoices, incidents, files, dashboard
public/              the app screens
scripts/             new-company, seed-demo
companies/           one folder per storage company
```

**Billing rules:** each rental has a cycle (monthly / quarterly / yearly), a rate and a *next bill date*. Run billing invoices every rental whose next period starts within the "bill ahead" window (Setup → Company), then moves its next bill date forward one period. A rental that's behind gets one invoice per missed period. Imported rentals start billing from their next anniversary, so old start dates don't create back-invoices.
