// Location filter helper. ?location=<id> limits results to one location.
// Returns a SQL fragment for a buildings alias (default "b") and its value.
function locationId(req) {
  const n = parseInt(req.query.location, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function locSql(req, alias = 'b') {
  const id = locationId(req);
  return id ? { sql: ` AND ${alias}.location_id = ${id}`, id } : { sql: '', id: null };
}

module.exports = { locationId, locSql };

// SQL expressions giving the location of a record (used for filtering).
const SQL = {
  // spot alias -> location
  spot: (s = 's') => `(SELECT location_id FROM buildings WHERE id = ${s}.building_id)`,
  // contract alias -> location
  contract: (k = 'k') => `(SELECT b.location_id FROM spots sp JOIN buildings b ON b.id = sp.building_id WHERE sp.id = ${k}.spot_id)`,
  // customer id expression -> true if they rent (or last rented) in location
  customerIn: (cid, locId) => `EXISTS (SELECT 1 FROM contracts kk JOIN spots sp ON sp.id = kk.spot_id JOIN buildings b ON b.id = sp.building_id
      WHERE kk.customer_id = ${cid} AND b.location_id = ${Number(locId)})`,
  // invoice alias -> location (its rental's spot; for one-off invoices, the customer's latest rental)
  invoice: (i = 'i') => `COALESCE(
      (SELECT b.location_id FROM contracts kk JOIN spots sp ON sp.id = kk.spot_id JOIN buildings b ON b.id = sp.building_id WHERE kk.id = ${i}.contract_id),
      (SELECT b.location_id FROM contracts kk JOIN spots sp ON sp.id = kk.spot_id JOIN buildings b ON b.id = sp.building_id
        WHERE kk.customer_id = ${i}.customer_id ORDER BY kk.status = 'active' DESC, kk.id DESC LIMIT 1))`,
};

module.exports.SQL = SQL;
