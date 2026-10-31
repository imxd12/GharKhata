/**
 * GharKhata – Theme Management
 * Dark & Light mode toggle with persistent localStorage preference
 */

(function () {
  const THEME_KEY = 'gharkhata_theme';

  function getPreferredTheme() {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === 'dark' || saved === 'light') return saved;
    } catch (e) {}
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function applyTheme(theme) {
    const targetTheme = (theme === 'dark') ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', targetTheme);
    try {
      localStorage.setItem(THEME_KEY, targetTheme);
    } catch (e) {}

    // Update toggle icons on all theme buttons currently in DOM
    const toggleBtns = document.querySelectorAll('.theme-toggle-btn');
    toggleBtns.forEach(btn => {
      btn.innerHTML = targetTheme === 'dark' ? '☀️' : '🌙';
      btn.setAttribute('title', targetTheme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode');
    });
  }

  // Apply immediately before DOM renders to prevent flicker
  const initialTheme = getPreferredTheme();
  applyTheme(initialTheme);

  window.GharKhataTheme = {
    get: () => document.documentElement.getAttribute('data-theme') || getPreferredTheme(),
    toggle: () => {
      const current = document.documentElement.getAttribute('data-theme') || getPreferredTheme();
      const next = current === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      return next;
    },
    set: applyTheme
  };

  // Delegated global click listener so dynamically rendered buttons (topbar, modals) always work
  document.addEventListener('click', (e) => {
    const toggleBtn = e.target.closest('.theme-toggle-btn');
    if (toggleBtn) {
      e.preventDefault();
      window.GharKhataTheme.toggle();
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    applyTheme(getPreferredTheme());
  });
})();

