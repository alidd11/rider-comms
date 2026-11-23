// Public seller/advertiser application. No account needed; the backend
// validates everything again, rate-limits by address and queues it for staff.
(() => {
  const API = 'https://backend-production-7fa0.up.railway.app';
  const form = document.getElementById('partnerForm');
  const error = document.getElementById('partnerError');
  const submit = document.getElementById('partnerSubmit');
  const MESSAGES = {
    invalid_business_name: 'Enter your business name (2 to 120 characters).',
    invalid_contact_name: 'Enter your name.',
    invalid_email: 'Enter a valid email address.',
    invalid_website: 'Check the website link, or leave it empty.',
    invalid_country: 'Choose your country.',
    invalid_category: 'Say what you sell or promote.',
    invalid_description: 'Tell us a little more about your business (at least 20 characters).',
    terms_not_accepted: 'Agree to the Terms to send your application.',
    rate_limited: 'Too many applications from this connection. Try again in an hour.',
  };
  const show = (text) => { error.textContent = text; error.hidden = false; };
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.hidden = true;
    const data = Object.fromEntries(new FormData(form).entries());
    const body = { ...data, acceptTerms: form.elements.acceptTerms.checked };
    if (!body.acceptTerms) { show(MESSAGES.terms_not_accepted); return; }
    submit.disabled = true;
    submit.textContent = 'Sending…';
    try {
      const response = await fetch(API + '/partners/apply', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        credentials: 'omit', redirect: 'error', cache: 'no-store',
      });
      const result = await response.json().catch(() => ({}));
      if (response.status === 429) { show(MESSAGES.rate_limited); return; }
      if (!response.ok) { show(MESSAGES[result.error] || 'We couldn’t send your application. Check the form and try again.'); return; }
      document.getElementById('partnerReference').textContent = result.reference || 'sent';
      form.hidden = true;
      const done = document.getElementById('partnerDone');
      done.hidden = false;
      done.focus();
    } catch {
      show('We couldn’t reach Rider Comms. Check your connection and try again.');
    } finally {
      submit.disabled = false;
      submit.textContent = 'Send application';
    }
  });
})();
