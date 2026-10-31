/**
 * GharKhata – WhatsApp Click-to-Chat Integration
 * Generates pre-filled WhatsApp messages using registered family member phone numbers.
 */

(function () {
  let partnerCache = null;

  const WhatsApp = {
    async getPartner() {
      if (partnerCache) return partnerCache;
      try {
        const res = await window.GharKhataDB.request('/api/household/partner');
        partnerCache = res.partner;
        return partnerCache;
      } catch (e) {
        console.warn('Could not fetch partner for WhatsApp:', e);
        return null;
      }
    },

    formatPhoneNumber(phone) {
      if (!phone) return '';
      // Remove all non-digits
      let clean = phone.replace(/\D/g, '');
      // If 10 digits (common in India), prepend 91
      if (clean.length === 10) {
        clean = '91' + clean;
      }
      return clean;
    },

    openChat(phone, text) {
      const cleanPhone = this.formatPhoneNumber(phone);
      if (!cleanPhone) {
        if (window.GharKhataNotifications) {
          window.GharKhataNotifications.toast('Partner phone number is missing or invalid.', 'warning');
        }
        return;
      }

      const encoded = encodeURIComponent(text);
      const url = `https://wa.me/${cleanPhone}?text=${encoded}`;
      window.open(url, '_blank');
    },

    async askAboutExpense(expense, optionalRemark = '') {
      const partner = await this.getPartner();
      if (!partner) {
        if (window.GharKhataNotifications) {
          window.GharKhataNotifications.toast('Your partner has not joined this household yet.', 'info');
        }
        return;
      }

      const user = window.GharKhataAuth ? window.GharKhataAuth.getUser() : null;
      const myRole = user ? user.role : 'Dad';
      const partnerRole = partner.role || (myRole === 'Dad' ? 'Mom' : 'Dad');

      let message = `Hi ${partnerRole}, regarding the expense of ₹${Number(expense.amount).toLocaleString()} for "${expense.description}" (${expense.category}) on ${expense.date}:\n`;
      if (optionalRemark && optionalRemark.trim()) {
        message += `\n"${optionalRemark.trim()}"\n`;
      } else {
        message += `\nCould you please check this expense on GharKhata?\n`;
      }
      message += `\nView on GharKhata: ${window.location.origin}/expenses.html`;

      this.openChat(partner.phone, message);
    },

    async replyAboutExpense(expense, replyText) {
      const partner = await this.getPartner();
      if (!partner) return;

      const user = window.GharKhataAuth ? window.GharKhataAuth.getUser() : null;
      const myRole = user ? user.role : 'Mom';
      const partnerRole = partner.role || (myRole === 'Mom' ? 'Dad' : 'Mom');

      let message = `Hi ${partnerRole}, regarding your question on ₹${Number(expense.amount).toLocaleString()} for "${expense.description}":\n\n`;
      message += `"${replyText.trim()}"\n`;
      if (expense.receipt_url) {
        message += `\n(Receipt attached on GharKhata)\n`;
      }
      message += `\nView discussion on GharKhata: ${window.location.origin}/discussions.html?expenseId=${expense.id}`;

      this.openChat(partner.phone, message);
    },

    async shareIncomeUpdate(income) {
      const partner = await this.getPartner();
      if (!partner) return;

      const message = `Hi Mom, I have just recorded income of ₹${Number(income.amount).toLocaleString()} (${income.description}) in our GharKhata!\n\nCheck updated balance: ${window.location.origin}/dashboard.html`;
      this.openChat(partner.phone, message);
    },

    async chatWithPartner() {
      const partner = await this.getPartner();
      if (!partner) {
        if (window.GharKhataNotifications) {
          window.GharKhataNotifications.toast('Your family member has not joined the household yet.', 'info');
        }
        return;
      }

      const message = `Hi ${partner.full_name}, checking in regarding our GharKhata finances!`;
      this.openChat(partner.phone, message);
    }
  };

  window.GharKhataWhatsApp = WhatsApp;
})();

