// Dashboard stats. Money figures only go to roles with dashboard.financial.
const express = require('express');
const { requireLogin, can } = require('../lib/auth');
const { today, addDays, addMonths } = require('../lib/billing');

module.exports = ({ db }) => {
  const r = express.Router();

  r.get('/dashboard', requireLogin, (req, res) => {
    const t = today();
    const [y, m] = t.split('-').map(Number);
    const monthStart = `${y}-${String(m).padStart(2, '0')}-01`;
    const qStartMonth = Math.floor((m - 1) / 3) * 3 + 1;
    const quarterStart = `${y}-${String(qStartMonth).padStart(2, '0')}-01`;
    const yearStart = `${y}-01-01`;

    const occ = db.prepare(`SELECT COUNT(*) AS total,
        SUM(CASE WHEN EXISTS (SELECT 1 FROM contracts c WHERE c.spot_id = s.id AND c.status = 'active') THEN 1 ELSE 0 END) AS rented
      FROM spots s WHERE s.active = 1`).get();
    const byBuilding = db.prepare(`SELECT b.name, COUNT(s.id) AS total,
        SUM(CASE WHEN EXISTS (SELECT 1 FROM contracts c WHERE c.spot_id = s.id AND c.status = 'active') THEN 1 ELSE 0 END) AS rented
      FROM buildings b LEFT JOIN spots s ON s.building_id = b.id AND s.active = 1 GROUP BY b.id ORDER BY b.sort, b.name`).all();

    const out = {
      today: t,
      occupancy: { total: occ.total || 0, rented: occ.rented || 0, byBuilding },
      customers: db.prepare(`SELECT COUNT(*) AS n FROM customers WHERE status = 'active'`).get().n,
      openIncidents: db.prepare(`SELECT i.id, i.title, i.occurred_on, i.category, s.label AS spot_label FROM incidents i
        LEFT JOIN spots s ON s.id = i.spot_id WHERE i.status = 'open' ORDER BY i.occurred_on DESC LIMIT 8`).all(),
      openIncidentCount: db.prepare(`SELECT COUNT(*) AS n FROM incidents WHERE status = 'open'`).get().n,
      insuranceExpiring: db.prepare(`SELECT b.id, b.name, b.make, b.insurance_expires, b.customer_id, TRIM(c.first_name || ' ' || c.last_name) AS customer_name
        FROM boats b JOIN customers c ON c.id = b.customer_id
        WHERE c.status = 'active' AND b.insurance_expires IS NOT NULL AND b.insurance_expires != '' AND b.insurance_expires <= ?
        ORDER BY b.insurance_expires LIMIT 10`).all(addDays(t, 30)),
      endingSoon: db.prepare(`SELECT k.id, k.end_date, k.customer_id, TRIM(c.first_name || ' ' || c.last_name) AS customer_name, s.label AS spot_label
        FROM contracts k JOIN customers c ON c.id = k.customer_id LEFT JOIN spots s ON s.id = k.spot_id
        WHERE k.status = 'active' AND k.end_date IS NOT NULL AND k.end_date != '' AND k.end_date <= ? ORDER BY k.end_date LIMIT 10`).all(addDays(t, 60)),
      activity: db.prepare(`SELECT a.*, u.name AS user_name, TRIM(c.first_name || ' ' || c.last_name) AS customer_name FROM activity a
        LEFT JOIN users u ON u.id = a.user_id LEFT JOIN customers c ON c.id = a.customer_id
        ${can(req.user, 'dashboard.financial') ? '' : `WHERE a.kind NOT IN ('invoice','payment')`}
        ORDER BY a.id DESC LIMIT 12`).all(),
    };

    if (can(req.user, 'dashboard.financial')) {
      const paidSince = db.prepare(`SELECT COALESCE(SUM(total_cents),0) AS c FROM invoices WHERE status = 'paid' AND paid_at >= ?`);
      const monthly = db.prepare(`SELECT COALESCE(SUM(CASE billing_cycle WHEN 'monthly' THEN rate_cents WHEN 'quarterly' THEN rate_cents / 3.0 ELSE rate_cents / 12.0 END),0) AS c
        FROM contracts WHERE status = 'active'`).get().c;
      const open = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(total_cents),0) AS c FROM invoices WHERE status = 'sent'`).get();
      const overdue = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(total_cents),0) AS c FROM invoices WHERE status = 'sent' AND due_date < ?`).get(t);
      const drafts = db.prepare(`SELECT COUNT(*) AS n FROM invoices WHERE status = 'draft'`).get().n;

      // Paid revenue per month, last 12 months.
      const months = [];
      for (let i = 11; i >= 0; i--) months.push(addMonths(monthStart, -i).slice(0, 7));
      const rows = db.prepare(`SELECT substr(paid_at, 1, 7) AS ym, SUM(total_cents) AS c FROM invoices WHERE status = 'paid' AND paid_at >= ? GROUP BY ym`)
        .all(`${months[0]}-01`);
      const map = Object.fromEntries(rows.map((x) => [x.ym, x.c]));

      out.financial = {
        revenueMonth: paidSince.get(monthStart).c,
        revenueQuarter: paidSince.get(quarterStart).c,
        revenueYear: paidSince.get(yearStart).c,
        recurringMonthly: Math.round(monthly),
        outstanding: open,
        overdue,
        drafts,
        revenueByMonth: months.map((ym) => ({ month: ym, cents: map[ym] || 0 })),
        overdueList: db.prepare(`SELECT i.id, i.number, i.due_date, i.total_cents, TRIM(c.first_name || ' ' || c.last_name) AS customer_name
          FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.status = 'sent' AND i.due_date < ? ORDER BY i.due_date LIMIT 8`).all(t),
        upcomingBilling: db.prepare(`SELECT COUNT(*) AS n FROM contracts WHERE status = 'active' AND next_bill_date <= ?`).get(addDays(t, 30)).n,
      };
    }
    res.json(out);
  });

  return r;
};
