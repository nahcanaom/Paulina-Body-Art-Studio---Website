/**
 * PAULINA BODY ART STUDIO — SHARED ADMIN SIDEBAR
 * Accessible disclosure behaviour for the Edit Website section menu.
 */

(function () {
  'use strict';

  const dropdown = document.querySelector('.nav-dropdown');
  if (!dropdown) return;

  const toggle = dropdown.querySelector('.nav-dropdown-toggle');
  const menu = dropdown.querySelector('.nav-dropdown-menu');
  if (!toggle || !menu) return;

  const menuItems = () => Array.from(menu.querySelectorAll('[role="menuitem"]'));
  const isOpen = () => dropdown.classList.contains('is-open');
  let closeTimer = 0;
  let openedByHover = false;
  let keepOpenOnClick = false;

  function setOpen(open) {
    dropdown.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
  }

  function open(viaHover = false) {
    window.clearTimeout(closeTimer);
    openedByHover = viaHover;
    setOpen(true);
  }

  function close() {
    window.clearTimeout(closeTimer);
    setOpen(false);
  }

  function scheduleClose() {
    window.clearTimeout(closeTimer);
    closeTimer = window.setTimeout(close, 140);
  }

  /* Hover opens the menu; the first click on the caret keeps it open instead
     of immediately closing what the pointer just revealed. */
  toggle.addEventListener('pointerdown', () => {
    keepOpenOnClick = openedByHover;
    openedByHover = false;
  });

  toggle.addEventListener('click', () => {
    if (keepOpenOnClick) {
      keepOpenOnClick = false;
      return;
    }
    setOpen(!isOpen());
  });

  dropdown.addEventListener('pointerenter', (event) => {
    if (event.pointerType === 'mouse') open(true);
  });

  dropdown.addEventListener('pointerleave', (event) => {
    if (event.pointerType === 'mouse') scheduleClose();
  });

  dropdown.addEventListener('focusout', (event) => {
    if (!dropdown.contains(event.relatedTarget)) scheduleClose();
  });

  document.addEventListener('pointerdown', (event) => {
    if (!dropdown.contains(event.target)) close();
  });

  dropdown.addEventListener('keydown', (event) => {
    const items = menuItems();
    const index = items.indexOf(document.activeElement);

    if (event.key === 'Escape' && isOpen()) {
      event.preventDefault();
      close();
      toggle.focus();
      return;
    }

    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    if (!isOpen()) open();
    event.preventDefault();

    if (event.key === 'Home') {
      items[0]?.focus();
      return;
    }
    if (event.key === 'End') {
      items[items.length - 1]?.focus();
      return;
    }

    const step = event.key === 'ArrowDown' ? 1 : -1;
    const next =
      index === -1 ? (step === 1 ? 0 : items.length - 1) : (index + step + items.length) % items.length;
    items[next]?.focus();
  });

  menu.addEventListener('click', (event) => {
    if (event.target.closest('[role="menuitem"]')) close();
  });
})();
