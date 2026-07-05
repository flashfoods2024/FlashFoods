// ── Shared Menu Table JS ─────────────────────────────────────
// Handles search + filter for both vendor and student modes.
// Vendor-specific JS (variant editing, status tracking, batch ops, etc.)
// should be in a separate inline script loaded AFTER this file.

(function() {
  var searchEl = document.getElementById('import-search');
  var filterBtns = document.querySelectorAll('.filter-btn');

  // Expose shared state via a namespace object so vendor-specific JS
  // can read/write reviewMode and call applyFilters by reference.
  window.__menuTable = {
    searchEl: searchEl,
    filterBtns: filterBtns,
    reviewMode: false
  };

  window.__menuTable.applyFilters = function() {
    var q = searchEl ? searchEl.value.toLowerCase().trim() : '';
    var activeBtn = document.querySelector('.filter-btn.is-active');
    var filter = activeBtn ? activeBtn.getAttribute('data-filter') : 'all';
    var rows = document.querySelectorAll('#import-table tbody tr');
    var rMode = window.__menuTable.reviewMode;

    rows.forEach(function(row) {
      // skip deleted rows (vendor mode)
      if (row.classList.contains('row--deleted')) return;
      var show = true;

      // text search: case-insensitive partial match against all row text
      if (q) {
        var text = row.textContent.toLowerCase();
        if (text.indexOf(q) === -1) show = false;
      }

      // status / food-type filter
      if (show && filter !== 'all') {
        var status = row.getAttribute('data-status');
        var ft = row.getAttribute('data-foodtype');
        var conf = parseFloat(row.getAttribute('data-confidence'));
        if (filter === 'ready')         { if (status !== 'ready') show = false; }
        else if (filter === 'review')   { if (status !== 'review') show = false; }
        else if (filter === 'duplicate'){ if (status !== 'duplicate') show = false; }
        else if (filter === 'noprice')  { if (status !== 'noprice') show = false; }
        else if (filter === 'lowconf')  { if (conf >= 0.7) show = false; }
        else if (filter === 'veg' || filter === 'non-veg' || filter === 'egg' || filter === 'unknown') {
          if (ft !== filter) show = false;
        }
      }

      // review mode: hide ready rows (vendor only)
      if (show && rMode && filter !== 'ready') {
        if (row.getAttribute('data-status') === 'ready') show = false;
      }

      row.classList.toggle('is-hidden', !show);
    });
  };

  var applyFilters = window.__menuTable.applyFilters;

  // Search input → immediate live filtering
  if (searchEl) {
    searchEl.addEventListener('input', applyFilters);
  }

  // Filter tabs → update active state then re-filter
  filterBtns.forEach(function(btn) {
    btn.addEventListener('click', function() {
      filterBtns.forEach(function(b) { b.classList.remove('is-active'); });
      btn.classList.add('is-active');
      window.__menuTable.reviewMode = false;
      applyFilters();
    });
  });

  // Keyboard shortcut: Ctrl+/ or Cmd+/ to focus search
  document.addEventListener('keydown', function(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === '/') {
      e.preventDefault();
      if (searchEl) searchEl.focus();
    }
  });
})();
