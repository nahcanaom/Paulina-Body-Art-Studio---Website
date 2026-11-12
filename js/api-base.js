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
})();
