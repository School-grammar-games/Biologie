(function () {
  if (window.__eduBioSimLanguageToggle) return;
  window.__eduBioSimLanguageToggle = true;

  var fileName = decodeURIComponent(window.location.pathname.split('/').pop() || '');
  if (!/\.html?$/i.test(fileName)) return;

  var explicitTargets = {
    'Offizielle Webseite.html': 'Offizielle_Webseite_EN.html',
    'Offizielle_Webseite_EN.html': 'Offizielle Webseite.html'
  };

  var isEnglish = /_EN\.html?$/i.test(fileName);
  var targetFile = explicitTargets[fileName] || (isEnglish
    ? fileName.replace(/_EN\.html?$/i, '.html')
    : fileName.replace(/\.html?$/i, '_EN.html'));

  var targetUrl = new URL(encodeURIComponent(targetFile).replace(/%2F/g, '/'), window.location.href);
  targetUrl.search = window.location.search;
  targetUrl.hash = window.location.hash;

  var style = document.createElement('style');
  style.textContent = [
    '.edu-language-toggle{position:fixed;top:12px;right:12px;z-index:2147483000;display:flex;gap:4px;align-items:center;padding:4px;border-radius:999px;background:rgba(255,255,255,.92);box-shadow:0 10px 24px rgba(15,23,42,.18);border:1px solid rgba(15,23,42,.14);backdrop-filter:blur(10px);font:700 12px/1 system-ui,-apple-system,Segoe UI,sans-serif}',
    '.edu-language-toggle a,.edu-language-toggle span{display:inline-flex;align-items:center;gap:5px;padding:7px 9px;border-radius:999px;text-decoration:none;color:#1f2937;white-space:nowrap}',
    '.edu-language-toggle .active{background:#2e7d32;color:white;box-shadow:inset 0 0 0 1px rgba(255,255,255,.25)}',
    '.edu-language-toggle a:not(.active):hover{background:#e8f5e9;color:#1b5e20}',
    '.edu-language-toggle .flag{width:18px;height:12px;display:inline-block;flex:0 0 auto;padding:0;border-radius:2px;box-shadow:0 0 0 1px rgba(15,23,42,.22);overflow:hidden}',
    '.edu-language-toggle .flag-de{background:linear-gradient(to bottom,#000 0 33.333%,#dd0000 33.333% 66.666%,#ffce00 66.666% 100%)}',
    '.edu-language-toggle .flag-gb{background-image:url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 60 36\'%3E%3Cpath fill=\'%23012169\' d=\'M0 0h60v36H0z\'/%3E%3Cpath stroke=\'%23fff\' stroke-width=\'7.2\' d=\'m0 0 60 36M60 0 0 36\'/%3E%3Cpath stroke=\'%23C8102E\' stroke-width=\'4.8\' d=\'m0 0 60 36M60 0 0 36\'/%3E%3Cpath stroke=\'%23fff\' stroke-width=\'12\' d=\'M30 0v36M0 18h60\'/%3E%3Cpath stroke=\'%23C8102E\' stroke-width=\'7.2\' d=\'M30 0v36M0 18h60\'/%3E%3C/svg%3E");background-size:100% 100%;background-position:center;background-repeat:no-repeat}',
    '@media(max-width:640px){.edu-language-toggle{top:8px;right:8px}.edu-language-toggle a,.edu-language-toggle span{padding:6px 8px;font-size:11px}}'
  ].join('\n');
  document.head.appendChild(style);

  var toggle = document.createElement('nav');
  toggle.className = 'edu-language-toggle';
  toggle.setAttribute('aria-label', 'Language switcher');

  var de = document.createElement(isEnglish ? 'a' : 'span');
  de.className = isEnglish ? '' : 'active';
  de.innerHTML = '<span class="flag flag-de" aria-hidden="true"></span><span>DE</span>';
  if (isEnglish) de.href = targetUrl.href;

  var en = document.createElement(isEnglish ? 'span' : 'a');
  en.className = isEnglish ? 'active' : '';
  en.innerHTML = '<span class="flag flag-gb" aria-hidden="true"></span><span>EN</span>';
  if (!isEnglish) en.href = targetUrl.href;

  toggle.appendChild(de);
  toggle.appendChild(en);

  function mount() {
    if (!document.body || document.querySelector('.edu-language-toggle')) return;
    document.body.appendChild(toggle);
  }

  if (document.body) {
    mount();
  } else {
    var mountAttempts = 0;
    var mountTimer = window.setInterval(function () {
      mountAttempts += 1;
      if (document.body || mountAttempts > 500) {
        window.clearInterval(mountTimer);
        mount();
      }
    }, 20);
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  }
})();
