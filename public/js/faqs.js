
/* ==========================================================================
   PARALLAX FLORAL BACKDROP
   Each floral layer declares its own scroll multiplier in data-parallax-speed.
   Lower values drift slower (far away), higher values follow the page more
   closely (near). The foreground accordion always scrolls at 1x.
   ========================================================================== */
const floralLayers = Array.from(document.querySelectorAll('[data-parallax-speed]'));
const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
let parallaxFrame = null;

function paintParallax() {
  parallaxFrame = null;
  const scrollY = window.scrollY || window.pageYOffset || 0;

  floralLayers.forEach(layer => {
    const speed = parseFloat(layer.dataset.parallaxSpeed) || 0;
    layer.style.setProperty('--parallax-y', `${(scrollY * speed).toFixed(2)}px`);
  });
}

function requestParallaxPaint() {
  if (parallaxFrame !== null) return;
  parallaxFrame = requestAnimationFrame(paintParallax);
}

function syncParallax() {
  if (reducedMotionQuery.matches) {
    if (parallaxFrame !== null) cancelAnimationFrame(parallaxFrame);
    parallaxFrame = null;
    floralLayers.forEach(layer => layer.style.removeProperty('--parallax-y'));
    window.removeEventListener('scroll', requestParallaxPaint);
    return;
  }

  window.addEventListener('scroll', requestParallaxPaint, { passive: true });
  paintParallax();
}

if (floralLayers.length) {
  syncParallax();

  if (typeof reducedMotionQuery.addEventListener === 'function') {
    reducedMotionQuery.addEventListener('change', syncParallax);
  } else if (typeof reducedMotionQuery.addListener === 'function') {
    reducedMotionQuery.addListener(syncParallax);
  }
}

// FAQ questions are re-rendered from the dashboard, so listen on the document
// and resolve the clicked item at click time instead of binding each header.
document.addEventListener('click', (event) => {
  const header = event.target.closest('.faq-accordion-list .faq-header');
  if (!header) return;

  const list = header.closest('.faq-accordion-list');
  const currentItem = header.parentElement;
  const isActive = currentItem.classList.contains('active');

  list.querySelectorAll('.faq-item').forEach(item => {
    item.classList.remove('active');
    const btn = item.querySelector('.faq-header');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  });

  if (!isActive) {
    currentItem.classList.add('active');
    header.setAttribute('aria-expanded', 'true');
  }
});
