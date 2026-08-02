// ── Profile View ──────────────────────────────────────────────

async function renderProfileView() {
  hideAllViews();
  const profileView = document.getElementById('profileView');
  profileView.style.display = 'block';

  const tbKey = App.keys.torboxKey;
  const rdKey = App.keys.rdKey;
  const adKey = App.keys.adKey;
  const pmKey = App.keys.pmKey;

  profileView.innerHTML = `
    <div class="browse-header"><h2>${icon('user', 18)} Profile</h2></div>
    <div class="profile-section" id="profileContent">
      <div class="loading-area"><div class="spinner"></div><p>Loading account info...</p></div>
    </div>
  `;

  addBackBtn(profileView);

  const container = document.getElementById('profileContent');
  let html = '';

  // TorBox card placeholder
  if (tbKey) {
    html += `<div class="profile-card"><h3>${icon('cloud', 16)} TorBox Account</h3><div id="tbProfileInfo">
      <div class="skelly-row" style="margin-bottom:8px"></div>
      <div class="skelly-row" style="margin-bottom:8px"></div>
      <div class="skelly-row" style="width:60%"></div>
    </div></div>`;
  }

  // RD card placeholder
  if (rdKey) {
    html += `<div class="profile-card"><h3>${icon('cloud', 16)} Real-Debrid Account</h3><div id="rdProfileInfo">
      <div class="skelly-row" style="margin-bottom:8px"></div>
      <div class="skelly-row" style="margin-bottom:8px"></div>
      <div class="skelly-row" style="width:60%"></div>
    </div></div>`;
  }

  // AllDebrid card placeholder
  if (adKey) {
    html += `<div class="profile-card"><h3>${icon('cloud', 16)} AllDebrid Account</h3><div id="adProfileInfo">
      <div class="skelly-row" style="margin-bottom:8px"></div>
      <div class="skelly-row" style="margin-bottom:8px"></div>
      <div class="skelly-row" style="width:60%"></div>
    </div></div>`;
  }

  // Premiumize card placeholder
  if (pmKey) {
    html += `<div class="profile-card"><h3>${icon('cloud', 16)} Premiumize Account</h3><div id="pmProfileInfo">
      <div class="skelly-row" style="margin-bottom:8px"></div>
      <div class="skelly-row" style="margin-bottom:8px"></div>
      <div class="skelly-row" style="width:60%"></div>
    </div></div>`;
  }

  html += `<div class="profile-note">${icon('shield', 14)} All account data is fetched client-side only. Your API keys are never sent to our server — they are encrypted and stored in your browser's localStorage.</div>`;
  container.innerHTML = html;

  // Fetch TorBox profile
  if (tbKey) {
    fetch('/api/torbox/user/me', { headers: { 'Authorization': 'Bearer ' + tbKey } })
      .then(r => r.json())
      .then(d => {
        const info = document.getElementById('tbProfileInfo');
        if (!info) return;
        if (!d.success || d.error) {
          info.innerHTML = renderProfileError('TorBox: ' + escHtml(d.error || d.detail || 'Unknown error'));
          return;
        }
        const data = d.data || {};
        const planMap = { 0: 'Free', 1: 'Essential', 2: 'Pro', 3: 'Standard' };
        const planName = escHtml(planMap[data.plan] || 'Plan ' + data.plan);
        let statusHtml = '';
        if (data.premium_expires_at && new Date(data.premium_expires_at) > new Date()) {
          statusHtml = '<span class="profile-badge badge-valid">Active</span>';
        } else if (data.premium_expires_at) {
          statusHtml = '<span class="profile-badge badge-expired">Expired</span>';
        } else {
          statusHtml = '<span class="profile-badge badge-valid">Free</span>';
        }
        info.innerHTML = renderProfileInfo([
          { label: 'Email', value: escHtml(data.email || 'N/A') },
          { label: 'Plan', value: planName + ' ' + statusHtml },
          { label: 'Premium Expires', value: escHtml(data.premium_expires_at ? new Date(data.premium_expires_at).toLocaleDateString() : 'N/A') },
          { label: 'Cooldown Until', value: escHtml(data.cooldown_until ? new Date(data.cooldown_until).toLocaleString() : 'None') },
          { label: 'API Key', value: escHtml(tbKey.slice(0, 12) + '...' + tbKey.slice(-4)) },
        ]);
      })
      .catch(() => {
        const info = document.getElementById('tbProfileInfo');
        if (info) info.innerHTML = renderProfileError('Failed to connect to TorBox.');
      });

    // Fetch subscription
    fetch('/api/torbox/user/subscriptions', { headers: { 'Authorization': 'Bearer ' + tbKey } })
      .then(r => r.json())
      .then(subData => {
        if (!subData.success || !subData.data) return;
        const subs = Array.isArray(subData.data) ? subData.data : [subData.data];
        if (!subs.length) return;
        const info = document.getElementById('tbProfileInfo');
        if (!info) return;
        const subHtml = subs.map(s => renderProfileInfo([
          { label: 'Plan Name', value: escHtml(s.name || s.plan_name || 'N/A') },
          { label: 'Status', value: escHtml(s.status || s.state || 'N/A') },
          { label: 'Next Billing', value: escHtml(s.next_billing_at ? new Date(s.next_billing_at).toLocaleDateString() : 'N/A') },
          { label: 'Expires', value: escHtml(s.expires_at ? new Date(s.expires_at).toLocaleDateString() : 'N/A') },
          { label: 'Price', value: escHtml(s.amount ? '\u00A3' + (s.amount / 100).toFixed(2) : 'N/A') },
        ])).join('');
        info.innerHTML += `<div style="margin-top:12px;border-top:1px solid var(--border);padding-top:12px"><div style="font-size:12px;font-weight:600;color:var(--muted);margin-bottom:6px">Subscription</div>${subHtml}</div>`;
      })
      .catch(() => {});
  }

  // Fetch RD profile
  if (rdKey) {
    fetch('/api/realdebrid/user', { headers: { 'Authorization': 'Bearer ' + rdKey } })
      .then(r => r.json())
      .then(d => {
        const info = document.getElementById('rdProfileInfo');
        if (!info) return;
        if (d.error || d.error_code) {
          info.innerHTML = renderProfileError('Real-Debrid: ' + escHtml(d.error || 'Invalid API key'));
          return;
        }
        const expired = d.premium === 0;
        const expDate = d.expiration ? new Date(d.expiration).toLocaleDateString() : 'N/A';
        info.innerHTML = renderProfileInfo([
          { label: 'Username', value: escHtml(d.username || 'N/A') },
          { label: 'Email', value: escHtml(d.email || 'N/A') },
          { label: 'Type', value: escHtml(d.type || 'N/A') },
          { label: 'Status', value: expired ? '<span class="profile-badge badge-expired">Expired</span>' : '<span class="profile-badge badge-valid">Active</span>' },
          { label: 'Expiry', value: escHtml(expDate) },
          { label: 'Points', value: escHtml(String(d.points || 0)) },
          { label: 'API Key', value: escHtml(rdKey.slice(0, 12) + '...' + rdKey.slice(-4)) },
        ]);
      })
      .catch(() => {
        const info = document.getElementById('rdProfileInfo');
        if (info) info.innerHTML = renderProfileError('Failed to connect to Real-Debrid.');
      });
  }

  // Fetch AllDebrid profile
  if (adKey) {
    adGet('/user', adKey).then(d => {
      const info = document.getElementById('adProfileInfo');
      if (!info) return;
      const u = d.data?.user;
      if (!u) { info.innerHTML = renderProfileError('AllDebrid: ' + escHtml(d.error?.message || 'Invalid API key')); return; }
      const premiumUntil = u.premiumUntil ? new Date(u.premiumUntil * 1000).toLocaleDateString() : 'N/A';
      const active = u.isPremium && u.premiumUntil && u.premiumUntil * 1000 > Date.now();
      info.innerHTML = renderProfileInfo([
        { label: 'Username', value: escHtml(u.username || 'N/A') },
        { label: 'Email', value: escHtml(u.email || 'N/A') },
        { label: 'Status', value: active ? '<span class="profile-badge badge-valid">Premium</span>' : '<span class="profile-badge badge-expired">Not premium</span>' },
        { label: 'Premium Until', value: escHtml(premiumUntil) },
      ]);
    }).catch(() => {
      const info = document.getElementById('adProfileInfo');
      if (info) info.innerHTML = renderProfileError('Failed to connect to AllDebrid.');
    });
  }

  // Fetch Premiumize profile
  if (pmKey) {
    pmGet('/account/info', pmKey).then(d => {
      const info = document.getElementById('pmProfileInfo');
      if (!info) return;
      const data = d.data || {};
      const premiumUntil = data.premium_until ? new Date(data.premium_until * 1000).toLocaleDateString() : 'N/A';
      const active = data.premium_until && data.premium_until * 1000 > Date.now();
      info.innerHTML = renderProfileInfo([
        { label: 'Customer ID', value: escHtml(String(data.customer_id || 'N/A')) },
        { label: 'Status', value: active ? '<span class="profile-badge badge-valid">Premium</span>' : '<span class="profile-badge badge-expired">Free / Expired</span>' },
        { label: 'Premium Until', value: escHtml(premiumUntil) },
      ]);
    }).catch(() => {
      const info = document.getElementById('pmProfileInfo');
      if (info) info.innerHTML = renderProfileError('Failed to connect to Premiumize.');
    });
  }

  updateBottomNav('profile');
}

function renderProfileInfo(rows) {
  return rows.map(r => `<div class="profile-row"><span class="profile-label">${r.label}</span><span class="profile-value">${r.value}</span></div>`).join('');
}

function renderProfileError(msg) {
  return `<div style="padding:12px;color:var(--error);font-size:13px">${msg}</div>`;
}
