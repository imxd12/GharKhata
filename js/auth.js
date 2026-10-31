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

    getApiBase() {
      if (window.location.protocol === 'file:') {
        return 'http://localhost:3000';
      }
      if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        if (window.location.port && !['3000', '80', '443'].includes(window.location.port)) {
          return 'http://localhost:3000';
        }
      }
      return '';
    },

    async safeFetch(endpoint, options = {}) {
      const fullUrl = endpoint.startsWith('http') ? endpoint : (this.getApiBase() + endpoint);
      try {
        const response = await fetch(fullUrl, options);
        let data = {};
        const text = await response.text();
        try {
          data = JSON.parse(text);
        } catch (e) {
          data = { success: false, message: response.statusText || 'Unexpected server response.' };
        }
        return { response, data };
      } catch (err) {
        if (err.name === 'TypeError' || err.message.toLowerCase().includes('fetch')) {
          throw new Error('Cannot connect to the GharKhata server. Please verify the backend server is running (e.g. run "npm start" on port 3000) or check your connection.');
        }
        throw err;
      }
    },

    async login(email, password) {
      const { response, data } = await this.safeFetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      if (!response.ok || !data.success) {
        throw new Error(data.message || 'Login failed. Please check your credentials.');
      }

      this.setSession(data.token, data.user);
      return data;
    },

    async register(registrationData) {
      const { response, data } = await this.safeFetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(registrationData)
      });

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
      const { response, data } = await this.safeFetch('/api/auth/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ current_password, new_password, confirm_new_password })
      });

      if (!response.ok || !data.success) {
        throw new Error(data.message || 'Failed to update password.');
      }
      return data;
    },

    async fetchCurrentProfile() {
      const token = this.getToken();
      if (!token) return null;

      try {
        const { data } = await this.safeFetch('/api/auth/me', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
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

