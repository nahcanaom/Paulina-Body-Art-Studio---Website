(function () {
  'use strict';

  var SAME_ORIGIN_PORTS = ['', '80', '443', '3000'];
  var PRIVATE_HOST =
    /^(localhost|127(?:\.\d{1,3}){3}|::1|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})$/i;

  function resolveApiBase() {
    if (typeof window === 'undefined' || !window.location) return '';

    var location = window.location;

    if (location.protocol === 'file:') {
      return 'http://localhost:3000';
    }

    if (location.protocol !== 'http:' && location.protocol !== 'https:') {
      return '';
    }

    if (SAME_ORIGIN_PORTS.indexOf(location.port) !== -1) {
      return '';
    }

    if (!PRIVATE_HOST.test(location.hostname || '')) {
      return '';
    }

    return 'http://' + location.hostname + ':3000';
  }

  var API_BASE = resolveApiBase();

  function apiUrl(path) {
    if (!path) return path;
    if (/^https?:\/\//i.test(path)) return path;
    return API_BASE + path;
  }

  function mediaUrl(url) {
    if (!url || typeof url !== 'string') return '';
    if (/^(https?:)?\/\//i.test(url) || /^data:/i.test(url) || /^blob:/i.test(url)) {
      return url;
    }
    if (url.indexOf('/uploads/') === 0) {
      return API_BASE + url;
    }
    return url;
  }

  window.PAULINA_API_BASE = API_BASE;
  window.paulinaApiUrl = apiUrl;
  window.paulinaMediaUrl = mediaUrl;
  window.paulinaAdminFetch = async function (input, options) {
    var url = new URL(input, window.location.href);
    var origin = new URL(API_BASE || window.location.origin).origin;
    if (url.origin !== origin || !url.pathname.startsWith('/api/')) {
      throw new Error('Admin requests must target the studio API.');
    }
    var client = window.paulinaSupabase || (await import('./supabase-config.js')).supabase;
    var sessionTimer;
    var result;
    try {
      result = await Promise.race([
        client.auth.getSession(),
        new Promise((_, reject) => { sessionTimer = setTimeout(() => reject(new Error('Sign-in verification timed out. Please retry.')), 10000); })
      ]);
    } finally { clearTimeout(sessionTimer); }
    var token = result.data?.session?.access_token;
    if (!token) {
      window.location.assign('/sign-in.html');
      throw new Error('Sign in to the studio admin account.');
    }
    var headers = new Headers(options?.headers);
    headers.set('Authorization', 'Bearer ' + token);
    var timeout = AbortSignal.timeout(12000);
    var signal = options?.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    return fetch(input, { ...options, headers, signal });
  };
})();
