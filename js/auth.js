/**
 * GharKhata – Authentication & Session Manager
 */

(function () {
  const TOKEN_KEY = 'gharkhata_auth_token';
  const USER_KEY = 'gharkhata_user_profile';

  const Auth = {
    getToken() {
      return localStorage.getItem(TOKEN_KEY);
    },

    getUser() {
      const data = localStorage.getItem(USER_KEY);
      try {
        return data ? JSON.parse(data) : null;
      } catch (e) {
        return null;
      }
    },

    getRole() {
      const user = this.getUser();
      return user ? user.role : null;
    },

    getHouseholdId() {
      const user = this.getUser();
      return user ? user.household_id : null;
    },

    isAuthenticated() {
      return !!this.getToken() && !!this.getUser();
    },

    setSession(token, user) {
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    },

    updateUserProfile(partialUser) {
      const current = this.getUser() || {};
      const updated = { ...current, ...partialUser };
      localStorage.setItem(USER_KEY, JSON.stringify(updated));
    },

    clearSession() {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    },

    requireAuth(redirect = 'login.html') {
      if (!this.isAuthenticated()) {
        const currentPage = window.location.pathname.split('/').pop().replace('.html', '') || 'index';
        const publicPages = ['login', 'register', 'index'];
        if (!publicPages.includes(currentPage)) {
          window.location.href = redirect;
          return false;
        }
      }
      return true;
    },

    redirectIfAuthenticated(redirect = 'dashboard.html') {
      if (this.isAuthenticated()) {
        const currentPage = window.location.pathname.split('/').pop().replace('.html', '') || 'index';
        if (currentPage === 'login' || currentPage === 'register') {
          window.location.href = redirect;
          return true;
        }
      }
      return false;
    },

    async login(email, password) {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.message || 'Login failed. Please check your credentials.');
      }

      this.setSession(data.token, data.user);
      return data;
    },

    async register(registrationData) {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(registrationData)
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.message || 'Registration failed.');
      }

      this.setSession(data.token, data.user);
      return data;
    },

    async logout() {
      this.clearSession();
      window.location.href = 'login.html';
    },

    async changePassword(current_password, new_password, confirm_new_password) {
      const token = this.getToken();
      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ current_password, new_password, confirm_new_password })
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.message || 'Failed to update password.');
      }
      return data;
    },

    async fetchCurrentProfile() {
      const token = this.getToken();
      if (!token) return null;

      try {
        const response = await fetch('/api/auth/me', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        if (data.success && data.user) {
          this.updateUserProfile(data.user);
          return data;
        }
      } catch (e) {
        console.warn('Could not refresh profile:', e);
      }
      return null;
    }
  };

  window.GharKhataAuth = Auth;
})();

