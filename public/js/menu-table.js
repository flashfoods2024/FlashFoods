(function() {
  var searchEl = document.getElementById('import-search');
  var filterBtns = document.querySelectorAll('.filter-btn');
  var catFilter = document.getElementById('cat-filter');

  window.__menuTable = {
    searchEl: searchEl,
    filterBtns: filterBtns,
    catFilter: catFilter,
    reviewMode: false
  };

  function getActiveFilter() {
    var btn = document.querySelector('.filter-btn.is-active');
    return btn ? btn.getAttribute('data-filter') : 'all';
  }

  function getSelectedCategory() {
    return catFilter ? catFilter.value : '';
  }

  window.__menuTable.applyFilters = function() {
    var q = searchEl ? searchEl.value.toLowerCase().trim() : '';
    var filter = getActiveFilter();
    var selectedCat = getSelectedCategory();
    var rows = document.querySelectorAll('#import-table tbody tr');
    var rMode = window.__menuTable.reviewMode;

    rows.forEach(function(row) {
      if (row.classList.contains('row--deleted')) return;
      var show = true;

      if (q) {
        var text = row.textContent.toLowerCase();
        if (text.indexOf(q) === -1) show = false;
      }

      if (show && filter !== 'all') {
        var status = row.getAttribute('data-status');
        var ft = row.getAttribute('data-foodtype');
        var conf = parseFloat(row.getAttribute('data-confidence'));
        if (filter === 'ready')         { if (status !== 'ready') show = false; }
        else if (filter === 'review')   { if (status !== 'review') show = false; }
        else if (filter === 'duplicate'){ if (status !== 'duplicate') show = false; }
        else if (filter === 'noprice')  { if (status !== 'noprice') show = false; }
        else if (filter === 'lowconf')  { if (conf >= 0.7) show = false; }
        else if (filter === 'veg' || filter === 'non-veg' || filter === 'egg') {
          if (ft !== filter) show = false;
        }
      }

      if (show && selectedCat) {
        var rowCat = row.getAttribute('data-category');
        if (rowCat !== selectedCat.toLowerCase()) show = false;
      }

      if (show && rMode && filter !== 'ready') {
        if (row.getAttribute('data-status') === 'ready') show = false;
      }

      row.classList.toggle('is-hidden', !show);
    });
  };

  var applyFilters = window.__menuTable.applyFilters;

  if (searchEl) {
    searchEl.addEventListener('input', applyFilters);
  }

  filterBtns.forEach(function(btn) {
    btn.addEventListener('click', function() {
      filterBtns.forEach(function(b) { b.classList.remove('is-active'); });
      btn.classList.add('is-active');
      window.__menuTable.reviewMode = false;
      applyFilters();
    });
  });

  if (catFilter) {
    catFilter.addEventListener('change', applyFilters);
  }

  document.addEventListener('keydown', function(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === '/') {
      e.preventDefault();
      if (searchEl) searchEl.focus();
    }
  });
})();
