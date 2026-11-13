'use strict';

function createAdminAuth(getClient) {
  return async (req, res, next) => {
    const token = /^Bearer (\S+)$/i.exec(req.get('Authorization') || '')?.[1];
    if (!token) return res.status(401).json({ success: false, error: 'Sign in to the studio admin account.' });
    try {
      const { data, error } = await getClient().auth.getUser(token);
      const user = data?.user;
      if (error || !user || !user.email_confirmed_at) {
        return res.status(401).json({ success: false, error: 'Your session expired. Please sign in again.' });
      }
      const emails = (process.env.ADMIN_EMAILS || 'paulinabodyartstudio@gmail.com')
        .split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
      if (user.app_metadata?.role !== 'admin' && !emails.includes(String(user.email || '').toLowerCase())) {
        return res.status(403).json({ success: false, error: 'Studio admin access is required.' });
      }
      req.adminUser = user;
      next();
    } catch (_) {
      res.status(503).json({ success: false, error: 'Sign-in verification is unavailable. Please retry.' });
    }
  };
}

module.exports = { createAdminAuth };
