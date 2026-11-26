// ========================================
// Bookmark rendering
// ========================================
const ITEMS_PER_SECTION = 5;

// ---- Build a single bookmark <li> element ----
function _buildBookmarkLi(bookmark) {
  const li = document.createElement('li');
  li.innerHTML = `<a href="${bookmark.href}" class="bookmark-link"><span>${bookmark.title}</span></a>`;
  return li;
}

// ---- Swap an <li>'s anchor to a new bookmark ----
function _swapLiBookmark(li, bm) {
  const a = li.querySelector('a');
  a.href = bm.href;
  a.querySelector('span').textContent = bm.title;
}

// Track original upfront bookmarks per slot for reset
let _upfrontSlots = []; // Array of { li, bookmark }

// Cache the last computed best match so handleEnterKey can reuse it
// without re-scanning the DOM (which would pick the wrong shelf-swapped anchor).
let _lastBookmarkMatch = null;

function getLastBookmarkMatch() {
  return _lastBookmarkMatch;
}

function _appendBookmarkSection(container, title, bookmarks) {
  const section = document.createElement('div');
  section.className = 'bookmark-section';
  const ul = document.createElement('ul');

  if (title) {
    section.dataset.category = title;
    const heading = document.createElement('h2');
    heading.className = 'bookmark-section-title';
    heading.textContent = title;
    section.appendChild(heading);
  }

  bookmarks.forEach(bookmark => {
    if (!bookmark.href || !bookmark.title) return;
    const li = _buildBookmarkLi(bookmark);
    ul.appendChild(li);
    _upfrontSlots.push({ li, bookmark });
  });

  section.appendChild(ul);
  container.appendChild(section);
}

function _getBookmarkCategoryGroups(bookmarks) {
  if (!bookmarks.some(bookmark => bookmark.category)) return [];

  const groups = [];
  const groupByTitle = new Map();

  bookmarks.forEach(bookmark => {
    const title = String(bookmark.category || 'other').trim() || 'other';
    if (!groupByTitle.has(title)) {
      const group = { title, bookmarks: [] };
      groupByTitle.set(title, group);
      groups.push(group);
    }
    groupByTitle.get(title).bookmarks.push(bookmark);
  });

  return groups;
}

// ========================================
// Bookmark pages (up to SECTIONS_PER_PAGE categories each)
// ========================================
const SECTIONS_PER_PAGE = 8; // 4 columns x 2 rows

let _bookmarkPages = []; // page elements, in order
let _homePage = 0;       // page the user picked (click / Alt+arrows)

function _pageIndexOf(el) {
  return _bookmarkPages.findIndex(page => page.contains(el));
}

function _renderBookmarkPager(shownIndex) {
  const pager = document.getElementById('bookmark-pager');
  if (!pager) return;
  pager.innerHTML = '';
  pager.hidden = _bookmarkPages.length < 2;
  if (pager.hidden) return;

  _bookmarkPages.forEach((_, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'bookmark-pager-btn';
    // Same width active or not, so the row never shifts: "[1]" vs " 2 "
    btn.textContent = i === shownIndex ? `[${i + 1}]` : `\u00a0${i + 1}\u00a0`;
    btn.setAttribute('aria-label', `Bookmark page ${i + 1}`);
    if (i === shownIndex) btn.setAttribute('aria-current', 'page');
    btn.addEventListener('click', () => setBookmarkPage(i));
    pager.appendChild(btn);
  });
}

// Show a page without changing the user's chosen page (used by filtering).
function _showBookmarkPage(index) {
  _bookmarkPages.forEach((page, i) => {
    const active = i === index;
    page.classList.toggle('is-active', active);
    page.inert = !active;
    page.setAttribute('aria-hidden', String(!active));
  });
  _renderBookmarkPager(index);
}

function setBookmarkPage(index) {
  const count = _bookmarkPages.length;
  if (!count) return;
  _homePage = ((index % count) + count) % count;
  _showBookmarkPage(_homePage);
}

function changeBookmarkPage(delta) {
  setBookmarkPage(_homePage + delta);
}

// Alt+Left / Alt+Right switch pages (capture phase, so the terminal input's
// ArrowRight autocomplete doesn't also fire).
document.addEventListener('keydown', (e) => {
  if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  if (_bookmarkPages.length < 2) return;
  if (document.querySelector('.config-modal.active, #sp-modal-overlay')) return;
  e.preventDefault();
  e.stopPropagation();
  changeBookmarkPage(e.key === 'ArrowRight' ? 1 : -1);
}, { capture: true });

function generateBookmarks() {
  const container = document.getElementById('bookmarks');
  container.innerHTML = '';
  _upfrontSlots = [];
  _bookmarkPages = [];

  const bookmarks = getStoredBookmarks();
  let groups = _getBookmarkCategoryGroups(bookmarks);

  if (!groups.length) {
    const numSections = Math.ceil(bookmarks.length / ITEMS_PER_SECTION);
    groups = Array.from({ length: numSections }, (_, i) => ({
      title: null,
      bookmarks: bookmarks.slice(i * ITEMS_PER_SECTION, (i + 1) * ITEMS_PER_SECTION),
    }));
  }

  for (let i = 0; i < groups.length; i += SECTIONS_PER_PAGE) {
    const page = document.createElement('div');
    page.className = 'bookmark-page';
    groups.slice(i, i + SECTIONS_PER_PAGE)
      .forEach(group => _appendBookmarkSection(page, group.title, group.bookmarks));
    container.appendChild(page);
    _bookmarkPages.push(page);
  }

  setBookmarkPage(Math.min(_homePage, Math.max(0, _bookmarkPages.length - 1)));
}

// ---- Score a bookmark against a query ----
// Priority (highest to lowest):
//   upfront startsWith = 4
//   upfront includes   = 3
//   shelf   startsWith = 2
//   shelf   includes   = 1
function _scoreUpfront(title, value) {
  if (title.startsWith(value)) return 4;
  if (title.includes(value)) return 3;
  return 0;
}

function _scoreShelf(title, value) {
  if (title.startsWith(value)) return 2;
  if (title.includes(value)) return 1;
  return 0;
}

// ---- Main filter function — called from handleInput in terminal.js ----
// Returns best match { href, title } or null (used by AI badge in terminal.js).
function filterBookmarksWithShelf(rawValue) {
  const value = (rawValue || '').trim().toLowerCase();

  // Reset all classes first
  _upfrontSlots.forEach(({ li }) => {
    li.classList.remove('bookmark-match', 'bookmark-nomatch', 'primary-match', 'shelf-swapped');
  });

  // Empty input or command/dir prefix → restore everything to default
  if (!value || rawValue.startsWith(':') || /^dir/i.test(rawValue)) {
    _upfrontSlots.forEach(({ li, bookmark }) => {
      if (li._shelfBookmark) {
        _swapLiBookmark(li, bookmark);
        delete li._shelfBookmark;
      }
    });
    _showBookmarkPage(_homePage);
    _lastBookmarkMatch = null;
    return null;
  }

  const shelfBookmarks = getStoredShelfBookmarks();

  // Score upfront slots
  const upfrontScores = _upfrontSlots.map(({ bookmark }) =>
    _scoreUpfront(bookmark.title.toLowerCase(), value)
  );

  // Score + sort shelf bookmarks by title only, best first
  const scoredShelf = shelfBookmarks
    .map(bm => ({ bm, score: _scoreShelf(bm.title.toLowerCase(), value) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);

  let shelfIdx = 0;
  let bestMatchLi = null;
  let bestMatchScore = 0;
  let bestMatch = null;

  _upfrontSlots.forEach(({ li, bookmark }, i) => {
    const upfrontScore = upfrontScores[i];

    if (upfrontScore > 0) {
      // Upfront matches — restore if was swapped, mark as match
      if (li._shelfBookmark) {
        _swapLiBookmark(li, bookmark);
        delete li._shelfBookmark;
        li.classList.remove('shelf-swapped');
      }
      li.classList.add('bookmark-match');
      if (upfrontScore > bestMatchScore) {
        bestMatchScore = upfrontScore;
        bestMatchLi = li;
        bestMatch = { href: bookmark.href, title: bookmark.title };
      }
    } else {
      // Upfront doesn't match — try shelf
      if (shelfIdx < scoredShelf.length) {
        const { bm, score } = scoredShelf[shelfIdx++];
        _swapLiBookmark(li, bm);
        li._shelfBookmark = bm;
        li.classList.add('bookmark-match', 'shelf-swapped');
        if (score > bestMatchScore) {
          bestMatchScore = score;
          bestMatchLi = li;
          bestMatch = { href: bm.href, title: bm.title };
        }
      } else {
        // No shelf item available — restore upfront and fade out
        if (li._shelfBookmark) {
          _swapLiBookmark(li, bookmark);
          delete li._shelfBookmark;
          li.classList.remove('shelf-swapped');
        }
        li.classList.add('bookmark-nomatch');
      }
    }
  });

  // Best match gets primary highlight; show its page even if it isn't the
  // one the user picked, otherwise stay on the user's page.
  if (bestMatchLi) bestMatchLi.classList.add('primary-match');
  const matchPage = bestMatchLi ? _pageIndexOf(bestMatchLi) : -1;
  _showBookmarkPage(matchPage >= 0 ? matchPage : _homePage);

  _lastBookmarkMatch = bestMatch;
  return bestMatch;
}
