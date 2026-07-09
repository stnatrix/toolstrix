// ============================================================
// natrix — section switcher
// ============================================================
(function () {
  const switcher = document.getElementById('switcher');
  const logoSuffix = document.getElementById('logo-suffix');
  const sections = {
    dlp: document.getElementById('section-dlp'),
    mpeg: document.getElementById('section-mpeg'),
    pass: document.getElementById('section-pass'),
  };

  function activate(tab) {
    switcher.dataset.active = tab;
    Object.entries(sections).forEach(([key, el]) => {
      el.classList.toggle('active', key === tab);
    });
    logoSuffix.textContent = '/ ' + tab;
    logoSuffix.style.color = 'var(--' + tab + ')';
    history.replaceState(null, '', '#' + tab);
  }

  switcher.querySelectorAll('button[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => activate(btn.dataset.tab));
  });

  // deep-link support: natrix.example.com/#mpeg
  const initial = location.hash.replace('#', '');
  if (sections[initial]) activate(initial);
})();
