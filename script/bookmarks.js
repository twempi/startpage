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

function generateBookmarks() {
  const container = document.getElementById('bookmarks');
  container.innerHTML = '';
  _upfrontSlots = [];

  const bookmarks = getStoredBookmarks();
  const categoryGroups = _getBookmarkCategoryGroups(bookmarks);

  if (categoryGroups.length) {
    categoryGroups.forEach(group => _appendBookmarkSection(container, group.title, group.bookmarks));
    return;
  }

  const numSections = Math.ceil(bookmarks.length / ITEMS_PER_SECTION);
  for (let i = 0; i < numSections; i++) {
    const slice = bookmarks.slice(i * ITEMS_PER_SECTION, (i + 1) * ITEMS_PER_SECTION);
    _appendBookmarkSection(container, null, slice);
  }
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

  // Best match gets primary highlight
  if (bestMatchLi) bestMatchLi.classList.add('primary-match');

  _lastBookmarkMatch = bestMatch;
  return bestMatch;
}
