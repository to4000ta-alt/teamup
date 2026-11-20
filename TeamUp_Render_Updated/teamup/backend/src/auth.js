const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET;
if (!SECRET || SECRET.length < 32) {
  throw new Error('JWT_SECRET must be set to a random value of at least 32 characters.');
}

const sign = user => jwt.sign({ id: user.id }, SECRET, { expiresIn: '12h' });
const verify = token => jwt.verify(token, SECRET);

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  try {
    const payload = verify(token);
    if (!Number.isInteger(Number(payload.id))) throw new Error('Invalid token');
    req.userId = Number(payload.id);
    next();
  } catch {
    res.status(401).json({ error: 'Please sign in again.' });
  }
}

module.exports = { sign, verify, requireAuth };
