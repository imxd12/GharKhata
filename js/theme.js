/**
 * GharKhata – Theme Management
 * Dark & Light mode toggle with persistent localStorage preference
 */

(function () {
  const THEME_KEY = 'gharkhata_theme';

  function getPreferredTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved) return saved;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_KEY, theme);

    // Update toggle icons if present on page
    const toggleBtns = document.querySelectorAll('.theme-toggle-btn');
    toggleBtns.forEach(btn => {
      btn.innerHTML = theme === 'dark' ? '☀️' : '🌙';
      btn.setAttribute('title', theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode');
    });
  }

  // Apply immediately before DOM renders to prevent flicker
  const initialTheme = getPreferredTheme();
  applyTheme(initialTheme);

  window.GharKhataTheme = {
    get: () => document.documentElement.getAttribute('data-theme') || 'light',
    toggle: () => {
      const current = document.documentElement.getAttribute('data-theme') || 'light';
      const next = current === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      return next;
    },
    set: applyTheme
  };

  document.addEventListener('DOMContentLoaded', () => {
    applyTheme(getPreferredTheme());
    document.querySelectorAll('.theme-toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => window.GharKhataTheme.toggle());
    });
  });
})();

