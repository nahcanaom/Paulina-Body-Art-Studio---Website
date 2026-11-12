'use strict';

/**
 * Vercel entrypoint.
 *
 * Vercel's Express preset looks for app.js / index.js / server.js at the
 * project root and deploys the exported Express app as a single Vercel
 * Function. `npm start` still runs js/server.js directly.
 */
module.exports = require('./js/server');
