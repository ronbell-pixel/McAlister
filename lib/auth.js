// Roles and permissions. Change who can do what in this one table.
const PERMISSIONS = {
  'dashboard.financial': ['admin', 'owner'],
  'customers.view': ['admin', 'owner', 'user'],
  'customers.edit': ['admin', 'owner', 'user'],
  'customers.delete': ['admin', 'owner'],
  'contracts.edit': ['admin', 'owner'],
  'rates.view': ['admin', 'owner'],
  'invoices': ['admin', 'owner'],
  'letters': ['admin', 'owner'],
  'incidents': ['admin', 'owner', 'user'],
  'spots.view': ['admin', 'owner', 'user'],
  'setup': ['admin'],
  'import': ['admin'],
  'users': ['admin'],
};

function can(user, perm) {
  return Boolean(user && PERMISSIONS[perm] && PERMISSIONS[perm].includes(user.role));
}

function permissionsFor(role) {
  return Object.keys(PERMISSIONS).filter((p) => PERMISSIONS[p].includes(role));
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

// Loads the signed-in user on every API request.
function loadUser(db) {
  const q = db.prepare('SELECT id, email, name, role, active FROM users WHERE id = ?');
  return (req, res, next) => {
    const id = req.session && req.session.uid;
    const u = id ? q.get(id) : null;
    req.user = u && u.active ? u : null;
    next();
  };
}

function requireLogin(req, res, next) {
  if (!req.user) return next(httpError(401, 'Please sign in.'));
  next();
}

function requirePerm(perm) {
  return (req, res, next) => {
    if (!req.user) return next(httpError(401, 'Please sign in.'));
    if (!can(req.user, perm)) return next(httpError(403, "You don't have access to that."));
    next();
  };
}

// Wraps async handlers so thrown errors reach the error middleware.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { PERMISSIONS, can, permissionsFor, loadUser, requireLogin, requirePerm, httpError, wrap };
