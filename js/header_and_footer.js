/**
 * PAULINA BODY ART STUDIO - HEADER & FOOTER SCRIPT
 * Handles mobile navbar toggle, backdrop blur / glass effect on scroll,
 * responsive navigation behavior, and account dropdown / logout across all pages.
 */
document.addEventListener('DOMContentLoaded', () => {
  const navbar = document.querySelector('.navbar');
  const navToggle = document.querySelector('.nav-toggle');
  const navMenu = document.getElementById('navMenu');
  const navIcons = document.querySelector('.nav-icons');
  const accountTrigger = document.querySelector('.nav-icons .account-trigger');
  const accountDropdown = document.getElementById('accountDropdown');
  const logoutBtn = document.querySelector('[data-logout-btn]');
  const navAccountLink = document.querySelector('.nav-links .nav-account');

  let currentUser = null;
  let signOutHandler = null;
  // Email-confirmation links land on the home page with a live session, so the
  // profile sync runs here and the users table is written without a second
  // sign-in.
  let syncedUserId = '';

  // Add glass backdrop effect when scrolling past 24px
  const updateNavbarGlass = () => {
    if (navbar) {
      navbar.classList.toggle('is-scrolled', window.scrollY > 24);
    }
  };

  // Toggle mobile navigation menu open/close
  const setMenuState = (isOpen) => {
    if (!navbar || !navToggle || !navMenu) return;
    navbar.classList.toggle('menu-open', isOpen);
    navToggle.setAttribute('aria-expanded', String(isOpen));
  };

  // Desktop account dropdown (manages expanded aria state)
  const setDropdownState = (isOpen) => {
    if (!accountDropdown || !accountTrigger) return;
    accountDropdown.removeAttribute('hidden');
    accountTrigger.setAttribute('aria-expanded', String(isOpen || navIcons?.classList.contains('account-open')));
  };

  // Update account UI based on authentication state
  const updateAccountUI = (user) => {
    currentUser = user;

    if (navAccountLink) {
      if (user) {
        navAccountLink.textContent = 'Log Out';
        navAccountLink.setAttribute('title', 'log out');
        navAccountLink.setAttribute('aria-label', 'log out');
      } else {
        navAccountLink.textContent = 'Account';
        navAccountLink.setAttribute('title', 'account');
        navAccountLink.setAttribute('aria-label', 'account');
      }
    }

    if (accountDropdown) {
      accountDropdown.removeAttribute('hidden');
    }
  };

  // Sign out and redirect to sign-in page
  const handleLogout = async () => {
    if (navIcons) navIcons.classList.remove('account-open');
    setMenuState(false);

    try {
      if (signOutHandler) {
        await signOutHandler();
      }
    } catch (error) {
      console.error('Error signing out:', error);
    } finally {
      try {
        localStorage.removeItem('paulina_user_profile');
      } catch (e) {}

      const currentPath = window.location.pathname.toLowerCase();
      let target = 'sign-in.html';
      if (!currentPath.includes('/user-side/') && !currentPath.includes('user-side') && (currentPath.includes('/html/') || currentPath === '/' || currentPath.endsWith('index.html'))) {
        target = currentPath.includes('/html/') ? '../user-side/sign-in.html' : 'html/user-side/sign-in.html';
      }
      window.location.assign(target);
    }
  };

  // Ensure dropdown is not hidden by attribute so CSS hover works
  if (accountDropdown) {
    accountDropdown.removeAttribute('hidden');
  }

  // Desktop account icon: hover reveals the dropdown (CSS).
  // Click toggles an explicit open class for touch/keyboard devices.
  accountTrigger?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (navIcons) {
      navIcons.classList.toggle('account-open');
      accountTrigger.setAttribute('aria-expanded', String(navIcons.classList.contains('account-open')));
    }
  });

  // Desktop dropdown "Log out" button/link click handler
  logoutBtn?.addEventListener('click', (event) => {
    event.preventDefault();
    handleLogout();
  });

  // Smaller screen "Account" / "Log Out" link click handler
  navAccountLink?.addEventListener('click', (event) => {
    if (currentUser) {
      event.preventDefault();
      handleLogout();
    }
  });

  // Close desktop account dropdown when clicking outside
  document.addEventListener('click', (event) => {
    if (accountDropdown && !accountDropdown.hidden && navIcons && !navIcons.contains(event.target)) {
      if (navIcons) navIcons.classList.remove('account-open');
      accountTrigger?.blur();
    }
  });

  // Close desktop account dropdown on Escape key
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && accountDropdown && !accountDropdown.hidden) {
      if (navIcons) navIcons.classList.remove('account-open');
      accountTrigger?.blur();
    }
  });

  // Click handler for mobile hamburger toggle
  if (navbar && !navbar.dataset.navToggleBound) {
    navbar.dataset.navToggleBound = 'true';

    navToggle?.addEventListener('click', () => {
      const isOpen = navbar.classList.contains('menu-open');
      setMenuState(!isOpen);
    });

    // Close menu when clicking any nav link on smaller screens
    navMenu?.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        if (window.innerWidth <= 980) {
          setMenuState(false);
        }
      });
    });
  }

  // Reset menu and dropdown state when resizing
  window.addEventListener('resize', () => {
    if (window.innerWidth > 980) {
      setMenuState(false);
    } else {
      if (navIcons) navIcons.classList.remove('account-open');
    }
  });

  // Run on load and on scroll
  updateNavbarGlass();
  window.addEventListener('scroll', updateNavbarGlass, { passive: true });

  const syncSignedInProfile = async (user, saveUserProfile) => {
    const userId = user?.id || user?.uid || '';
    if (!userId || userId === syncedUserId) return;
    syncedUserId = userId;

    try {
      await saveUserProfile(user);
    } catch (error) {
      console.warn('Could not sync the signed-in profile:', error);
    }
  };

  // Initialize Supabase authentication listener.
  const initAuthListener = async () => {
    try {
      const { isAuthConfigured, onAuthStateChanged, signOut, saveUserProfile } =
        await import('./services/authService.js');

      if (!isAuthConfigured()) return;

      signOutHandler = signOut;
      await onAuthStateChanged((user) => {
        updateAccountUI(user);
        if (user) syncSignedInProfile(user, saveUserProfile);
      });
    } catch (error) {
      console.error('Failed to initialize Supabase Auth in header:', error);
    }
  };

  initAuthListener();

  // Marks every clickable photo with the shared "can be viewed" badge,
  // including images the dashboard renders after load.
  import('./image-view.js').catch((error) => {
    console.warn('Could not load the photo affordance module:', error);
  });
});
