#!/usr/bin/env node
// Fills a company with realistic sample data for trying the app out.
// Usage: COMPANY=demo-marina npm run seed-demo
// Refuses to run if the company already has customers.
const bcrypt = require('bcryptjs');
const { companySlug, companyPaths, loadCompanyDefaults, ensureDirs } = require('../lib/company');
const { openDb } = require('../lib/db');
const { today, addMonths, addDays, invoiceContract } = require('../lib/billing');

const slug = companySlug();
const paths = companyPaths(slug);
ensureDirs(paths);
const db = openDb(paths.dbFile, loadCompanyDefaults(slug));
if (db.prepare('SELECT COUNT(*) AS n FROM customers').get().n > 0) {
  console.error(`${slug} already has customers — not adding demo data.`);
  process.exit(1);
}

const pw = bcrypt.hashSync('demo1234', 10);
const addUser = db.prepare('INSERT OR IGNORE INTO users (email, name, role, password_hash) VALUES (?, ?, ?, ?)');
addUser.run('admin@demo.test', 'Alex Admin', 'admin', pw);
addUser.run('owner@demo.test', 'Olivia Owner', 'owner', pw);
addUser.run('staff@demo.test', 'Sam Staff', 'user', pw);
const adminId = db.prepare(`SELECT id FROM users WHERE email = 'admin@demo.test'`).get().id;
const staffId = db.prepare(`SELECT id FROM users WHERE email = 'staff@demo.test'`).get().id;

const types = [
  ['Indoor — up to 24 ft', 'Heated building, rack or floor', 17500, 49500, 180000],
  ['Indoor — 25 to 32 ft', 'Heated building, floor', 24500, 69500, 252000],
  ['Covered outdoor', 'Roofed canopy, gravel', 11000, 31500, 114000],
  ['Open lot', 'Fenced gravel lot', 7500, 21000, 78000],
].map((t) => db.prepare('INSERT INTO spot_types (name, description, monthly_cents, quarterly_cents, yearly_cents) VALUES (?, ?, ?, ?, ?)').run(...t).lastInsertRowid);

const buildings = [
  ['Building A', 'Heated storage, north side', [['A-', 1, 16, 0], ['A-', 17, 24, 1]]],
  ['Building B', 'Covered canopy', [['B-', 1, 14, 2]]],
  ['Open Lot', 'Fenced lot by the gate', [['L-', 1, 16, 3]]],
];
const spotIds = [];
buildings.forEach(([name, loc, ranges], i) => {
  const bid = db.prepare('INSERT INTO buildings (name, location, sort) VALUES (?, ?, ?)').run(name, loc, i).lastInsertRowid;
  for (const [prefix, from, to, ti] of ranges) {
    for (let n = from; n <= to; n++) {
      spotIds.push({ id: db.prepare('INSERT INTO spots (building_id, label, spot_type_id) VALUES (?, ?, ?)').run(bid, prefix + n, types[ti]).lastInsertRowid, type: ti });
    }
  }
});

const people = [
  ['Mike', 'Harmon', 'Sea Ray', 'Sundancer 290', 29], ['Linda', 'Kessler', 'Bayliner', 'VR5', 21], ['Tom', 'Reyes', 'Boston Whaler', 'Montauk 170', 17],
  ['Karen', 'Olsen', 'Malibu', 'Wakesetter 23', 23], ['Dave', 'Pruitt', 'Tracker', 'Pro Team 175', 17], ['Jen', 'Walsh', 'Bennington', '22 SX', 22],
  ['Greg', 'Tanner', 'Chaparral', '267 SSX', 27], ['Amy', 'Lindqvist', 'Yamaha', 'AR210', 21], ['Rob', 'Castillo', 'Grady-White', 'Freedom 235', 23],
  ['Sue', 'Barnett', 'Lund', '1875 Crossover', 19], ['Paul', 'Nakamura', 'Cobalt', 'R7', 27], ['Tina', 'Moreau', 'Sun Tracker', 'Party Barge 20', 20],
  ['Jim', 'Delaney', 'Ranger', 'Z520R', 21], ['Beth', 'Carver', 'MasterCraft', 'X24', 24], ['Carl', 'Jensen', 'Crestliner', '1750 Fish Hawk', 17],
  ['Nina', 'Patel', 'Formula', '270 Bowrider', 27], ['Ed', 'Sullivan', 'Alumacraft', 'Competitor 185', 18], ['Rita', 'Gomez', 'Regal', '2500 Bowrider', 25],
  ['Hank', 'Ferris', 'Starcraft', 'SVX 191', 19], ['Joan', 'Albright', 'Crownline', 'E235', 23], ['Luke', 'Brandt', 'Nitro', 'Z19', 19],
  ['Maria', 'Santos', 'Four Winns', 'H260', 26], ['Sean', 'Kelly', 'Tahoe', 'T16', 16], ['Diane', 'Hollis', 'Harris', 'Solstice 250', 25],
];
const cycles = ['monthly', 'monthly', 'monthly', 'quarterly', 'yearly'];
const t = today();
const usable = [...spotIds];
const custIds = [];
people.forEach(([f, l, make, model, len], i) => {
  const cid = db.prepare(`INSERT INTO customers (first_name, last_name, email, phone, address, city, state, zip, emergency_name, emergency_phone, status)
    VALUES (?, ?, ?, ?, ?, 'Lake Ozark', 'MO', '65049', ?, ?, ?)`).run(f, l, `${f}.${l}@example.com`.toLowerCase(),
    `573-555-${String(1000 + i * 37).slice(-4)}`, `${100 + i * 12} Lakeview Dr`, `${f === 'Mike' ? 'Cathy' : 'Pat'} ${l}`, `573-555-${String(2000 + i * 29).slice(-4)}`,
    i >= 22 ? 'prospect' : 'active').lastInsertRowid;
  custIds.push(cid);
  const ins = addDays(t, i % 5 === 0 ? 12 + i : 120 + i * 9);
  const boatId = db.prepare(`INSERT INTO boats (customer_id, name, make, model, year, length_ft, registration, insurance_carrier, insurance_policy, insurance_expires)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(cid, ['Reel Time', 'Knot Working', 'Sea Esta', 'Lake Life', 'Aqua Holic', ''][i % 6] || null,
    make, model, String(2012 + (i % 12)), len, `MO${4100 + i * 13}AB`, ['Progressive', 'State Farm', 'BoatUS', 'Geico'][i % 4], `POL-${88000 + i * 7}`, ins).lastInsertRowid;
  if (i >= 22) return;
  // pick a spot type that fits the boat
  const want = len >= 25 ? 1 : i % 3 === 0 ? 0 : i % 3 === 1 ? 2 : 3;
  const si = usable.findIndex((s) => s.type === want);
  const spot = usable.splice(si >= 0 ? si : 0, 1)[0];
  const cycle = cycles[i % cycles.length];
  const tp = db.prepare('SELECT * FROM spot_types WHERE id = ?').get(types[spot.type]);
  const start = addMonths(t.slice(0, 8) + '01', -(14 + (i % 6)));
  const kid = db.prepare(`INSERT INTO contracts (customer_id, spot_id, boat_id, billing_cycle, rate_cents, start_date, next_bill_date, end_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(cid, spot.id, boatId, cycle, tp[`${cycle}_cents`], start, start, i === 7 ? addDays(t, 40) : null).lastInsertRowid;

  // Generate the billing history up to now, then mark older invoices paid.
  for (let g = 0; g < 40; g++) {
    const k = db.prepare('SELECT * FROM contracts WHERE id = ?').get(kid);
    if (k.next_bill_date > t) break;
    const invId = invoiceContract(db, k, { userId: adminId });
    const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invId);
    // backdate issue/due to the period start
    const due = addDays(inv.period_start, 15);
    db.prepare('UPDATE invoices SET issue_date = ?, due_date = ?, sent_at = ?, sent_via = ? WHERE id = ?').run(inv.period_start, due, inv.period_start, 'email', invId);
    const late = (i % 7 === 3 && due >= addDays(t, -50)) || due >= t;
    if (late) db.prepare(`UPDATE invoices SET status = 'sent' WHERE id = ?`).run(invId);
    else db.prepare(`UPDATE invoices SET status = 'paid', paid_at = ?, paid_method = ? WHERE id = ?`).run(addDays(inv.period_start, 3 + (i % 9)), ['Check', 'Card', 'Cash', 'ACH'][i % 4], invId);
  }
});
db.prepare(`UPDATE activity SET created_at = datetime('now', '-' || (1000 - id) || ' minutes')`).run();

const notes = [
  [0, 'Prefers text over calls. Boat comes out Memorial Day weekend.'],
  [1, 'Asked about moving to indoor next season — call in February.'],
  [3, 'Paid late twice; set a reminder for the 1st.'],
  [5, 'Has a second boat; may want another spot in spring.'],
];
for (const [ci, body] of notes) db.prepare(`INSERT INTO notes (entity_type, entity_id, body, author_id) VALUES ('customer', ?, ?, ?)`).run(custIds[ci], body, staffId);

const inc = [
  ['Scratch on starboard hull', 'Noticed during forklift move. Photos taken, owner notified by phone.', 'incident', custIds[2], 'open'],
  ['Forklift hydraulic leak', 'Small leak at the mast cylinder. Service scheduled.', 'equipment', null, 'open'],
  ['North gate keypad sticking', 'Replaced battery; still intermittent.', 'facility', null, 'open'],
  ['Cover blew off in storm', 'Re-secured cover and checked for water.', 'incident', custIds[9], 'resolved'],
];
inc.forEach(([title, desc, cat, cid, st], i) => {
  db.prepare(`INSERT INTO incidents (title, description, occurred_on, category, customer_id, status, resolution, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(title, desc, addDays(t, -3 - i * 9), cat, cid, st, st === 'resolved' ? 'No damage found.' : '', staffId);
});

console.log(`Demo data added to ${slug}.`);
console.log('Sign in with admin@demo.test / owner@demo.test / staff@demo.test — password: demo1234');
