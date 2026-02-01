// Content script pour E621.net

let settings = {
  favoritesLimit: 100,
  heartColor: '#ff0000',
  iconSize: 20,
  enableAnimations: true,
  enableSounds: true,
  soundOnPopupClick: true,
  soundOnPageClick: true,
  soundOnPageLoad: true,
  soundVolume: 0.3,
  removeAds: false,
  zoomScale: 1.25,
  disableHeartsOnListPage: false
};

let favorites = {
  artist: [],
  tag: [],
  search: []
};

// Load settings and favorites on startup
loadData();

// Listen for popup messages
browser.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  if (message.action === 'favoritesUpdated') {
    await loadFavorites();
    // Update hearts in real time
    updateHearts();
    // Also update the search heart
    updateSearchHeart();
    sendResponse({ success: true });
  } else if (message.action === 'favoriteRemoved') {
    // Immediate update when a favorite is removed
    await loadFavorites();
    updateHearts();
    updateSearchHeart();
    sendResponse({ success: true });
  } else if (message.action === 'settingsUpdated') {
    settings = { ...settings, ...message.settings };
    applyRemoveAds();
    if (settings.disableHeartsOnListPage && isListPage()) {
      removeHeartsFromPage();
    } else {
      addHeartsToTags();
      addHeartToSearchBar();
      updateHearts();
      updateSearchHeart();
    }
    sendResponse({ success: true });
  }
  return true; // Allow async response
});

function isPleaseHelpMePage() {
  const path = (window.location.pathname || '').replace(/^\/+|\/+$/g, '');
  return path.toUpperCase() === 'PLEASEHELPME';
}

function showPleaseHelpMePage() {
  const pageId = 'e621-pleasehelpme-page';
  if (document.getElementById(pageId)) return;
  const fontUrl = browser.runtime.getURL('assets/fonts/OctoberCrow.ttf');
  const fontStyle = document.createElement('style');
  fontStyle.id = 'e621-pleasehelpme-font';
  fontStyle.textContent = `
    @font-face {
      font-family: 'October Crow';
      src: url('${fontUrl}') format('truetype');
      font-weight: normal;
      font-style: normal;
    }
    .e621-pleasehelpme-text { font-family: 'October Crow', sans-serif !important; }
  `;
  document.head.appendChild(fontStyle);
  const wrap = document.createElement('div');
  wrap.id = pageId;
  wrap.className = 'e621-pleasehelpme-wrap';
  const videoBg = document.createElement('iframe');
  videoBg.className = 'e621-pleasehelpme-video';
  videoBg.src = 'https://www.youtube.com/embed/-ZTdb5zCzuI?autoplay=1&mute=1&loop=1&playlist=-ZTdb5zCzuI&controls=0&showinfo=0&rel=0';
  videoBg.setAttribute('allow', 'autoplay');
  const audioTrack = document.createElement('audio');
  audioTrack.className = 'e621-pleasehelpme-audio';
  audioTrack.src = browser.runtime.getURL('assets/Sounds/close.mp3');
  audioTrack.loop = true;
  audioTrack.autoplay = true;
  audioTrack.playsInline = true;
  const textEl = document.createElement('div');
  textEl.className = 'e621-pleasehelpme-text';
  textEl.textContent = 'PLEASE HELP ME';
  wrap.appendChild(videoBg);
  wrap.appendChild(audioTrack);
  wrap.appendChild(textEl);
  document.body.appendChild(wrap);
  audioTrack.play().catch(() => {});
  Array.from(document.body.children).forEach(c => {
    if (c.id !== pageId) c.style.setProperty('display', 'none', 'important');
  });
}

async function loadData() {
  if (isPleaseHelpMePage()) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', showPleaseHelpMePage);
    } else {
      showPleaseHelpMePage();
    }
    return;
  }
  await loadSettings();
  applyRemoveAds();
  await loadFavorites();
  init();
}

async function loadSettings() {
  try {
    const result = await browser.storage.local.get('settings');
    if (result.settings) {
      settings = { ...settings, ...result.settings };
    }
  } catch (error) {
    console.error('Error loading settings:', error);
  }
}

const E621_ADS_STYLE_ID = 'e621-remove-ads-style';

function applyRemoveAds() {
  let styleEl = document.getElementById(E621_ADS_STYLE_ID);
  if (settings.removeAds) {
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = E621_ADS_STYLE_ID;
      styleEl.textContent = '.adzone-wrapper, .adzone { display: none !important; }';
      document.head.appendChild(styleEl);
    }
  } else {
    if (styleEl) styleEl.remove();
  }
}

async function loadFavorites() {
  try {
    // Load favorites from local storage (persists after restart)
    const result = await browser.storage.local.get(['favorites_artist', 'favorites_tag', 'favorites_search']);
    
    // If storage is empty, try loading from last backup
    if ((!result.favorites_artist || result.favorites_artist.length === 0) &&
        (!result.favorites_tag || result.favorites_tag.length === 0) &&
        (!result.favorites_search || result.favorites_search.length === 0)) {
      const backup = await browser.storage.local.get('last_backup');
      if (backup.last_backup && backup.last_backup.data) {
        favorites.artist = backup.last_backup.data.favorites?.artist || [];
        favorites.tag = backup.last_backup.data.favorites?.tag || [];
        favorites.search = backup.last_backup.data.favorites?.search || [];
        
        // Restore to local storage
        await browser.storage.local.set({
          favorites_artist: favorites.artist,
          favorites_tag: favorites.tag,
          favorites_search: favorites.search
        });
      } else {
        favorites.artist = [];
        favorites.tag = [];
        favorites.search = [];
      }
    } else {
      favorites.artist = result.favorites_artist || [];
      favorites.tag = result.favorites_tag || [];
      favorites.search = result.favorites_search || [];
    }
  } catch (error) {
    console.error('Error loading favorites:', error);
    // On error, initialize with empty arrays
    favorites.artist = [];
    favorites.tag = [];
    favorites.search = [];
  }
}

// Check if we're on a list page (not an individual page)
function isListPage() {
  const url = window.location.href;
  const pathname = window.location.pathname;
  
  // Allowed list pages:
  // - e621.net/posts (with or without params)
  // - e621.net/pools/gallery
  // - e621.net/pools/nombre (ex: e621.net/pools/52104)
  
  // Individual pages to exclude:
  // - e621.net/posts/4863849 (individual post page)
  
  if (pathname === '/posts' || pathname.startsWith('/posts?')) {
    return true; // Post list page
  }
  
  if (pathname === '/pools/gallery' || pathname.startsWith('/pools/gallery?')) {
    return true; // Pool gallery page
  }
  
  // Check if it's a pool with a number (not an individual post)
  const poolMatch = pathname.match(/^\/pools\/(\d+)/);
  if (poolMatch) {
    return true; // Pool page with number
  }
  
  // Exclure les pages individuelles de posts
  const postMatch = pathname.match(/^\/posts\/(\d+)/);
  if (postMatch) {
    return false; // Individual post page
  }
  
  return false;
}

function init() {
  // Check if we're on a list page
  const shouldEnableZoom = isListPage();
  
  // Wait for DOM to be ready
  const shouldAddHearts = !settings.disableHeartsOnListPage || !isListPage();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(() => {
        if (shouldAddHearts) {
          addHeartsToTags();
          addHeartToSearchBar();
        }
        if (shouldEnableZoom) {
          setupImageZoom();
          setupDownloadButtons();
        }
      }, 1000);
    });
  } else {
    setTimeout(() => {
      if (shouldAddHearts) {
        addHeartsToTags();
        addHeartToSearchBar();
      }
      if (shouldEnableZoom) {
        setupImageZoom();
        setupDownloadButtons();
      }
    }, 1000);
  }

  // Observe DOM changes for dynamic pages
  const observer = new MutationObserver(() => {
    const addHearts = !settings.disableHeartsOnListPage || !isListPage();
    if (addHearts) {
      addHeartsToTags();
      addHeartToSearchBar();
    } else {
      removeHeartsFromPage();
    }
    if (isListPage()) {
      setupImageZoom();
      setupDownloadButtons();
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
  
  // Vote buttons on individual post page (only when vote UI exists)
  if (!isListPage()) {
    setTimeout(() => setupVoteButtons(), 1500);
    setTimeout(() => setupImageFullscreenOnPostPage(), 1500);
    setTimeout(() => openFullscreenFromPoolParam(), 800);
  }
  const voteObserver = new MutationObserver(() => {
    if (!isListPage()) {
      setupVoteButtons();
      setupImageFullscreenOnPostPage();
    }
  });
  voteObserver.observe(document.body, { childList: true, subtree: true });
  
  // Also observe URL changes to update the search heart and vote buttons
  let lastUrl = window.location.href;
  setInterval(() => {
    const currentUrl = window.location.href;
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      updateSearchHeart();
      const voteContainer = document.getElementById('e621-vote-buttons-container');
      if (isListPage()) {
        if (voteContainer) voteContainer.remove();
      } else {
        setupVoteButtons();
        setupImageFullscreenOnPostPage();
        openFullscreenFromPoolParam();
      }
    }
  }, 500);
}

// Add upvote/downvote buttons on individual post page when .st-button.kinetic.ptbr-vote-button exists
function setupVoteButtons() {
  if (document.getElementById('e621-vote-buttons-container')) return;
  const voteButton = document.querySelector('.st-button.kinetic.ptbr-vote-button');
  if (!voteButton) return;
  
  const container = document.createElement('div');
  container.id = 'e621-vote-buttons-container';
  container.className = 'e621-vote-buttons-container';
  
  const upBtn = document.createElement('button');
  upBtn.type = 'button';
  upBtn.className = 'e621-vote-btn e621-vote-up';
  upBtn.setAttribute('aria-label', 'Upvote');
  const upSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  upSvg.setAttribute('viewBox', '0 0 24 24');
  upSvg.setAttribute('width', '24');
  upSvg.setAttribute('height', '24');
  const upPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  upPath.setAttribute('d', 'm18 15-6-6-6 6');
  upPath.setAttribute('fill', 'currentColor');
  upSvg.appendChild(upPath);
  upBtn.appendChild(upSvg);
  
  const downBtn = document.createElement('button');
  downBtn.type = 'button';
  downBtn.className = 'e621-vote-btn e621-vote-down';
  downBtn.setAttribute('aria-label', 'Downvote');
  const downSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  downSvg.setAttribute('viewBox', '0 0 24 24');
  downSvg.setAttribute('width', '24');
  downSvg.setAttribute('height', '24');
  const downPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  downPath.setAttribute('d', 'm6 9 6 6 6-6');
  downPath.setAttribute('fill', 'currentColor');
  downSvg.appendChild(downPath);
  downBtn.appendChild(downSvg);
  
  upBtn.addEventListener('click', () => {
    const nativeUp = document.querySelector('.st-button.kinetic.ptbr-vote-button[data-direction="up"], .ptbr-vote-button[data-vote-type="up"], a[href*="vote=up"], .post-vote-up, [data-vote="up"]') 
      || document.querySelectorAll('.st-button.kinetic.ptbr-vote-button, .ptbr-vote-button')[0];
    if (nativeUp) nativeUp.click();
    upBtn.classList.toggle('e621-voted-up');
    downBtn.classList.remove('e621-voted-down');
    applyVoteButtonColors(container);
    setTimeout(() => updateVoteScore(container), 500);
  });
  downBtn.addEventListener('click', () => {
    const nativeDown = document.querySelector('.st-button.kinetic.ptbr-vote-button[data-direction="down"], .ptbr-vote-button[data-vote-type="down"], a[href*="vote=down"], .post-vote-down, [data-vote="down"]') 
      || document.querySelectorAll('.st-button.kinetic.ptbr-vote-button, .ptbr-vote-button')[1];
    if (nativeDown) nativeDown.click();
    downBtn.classList.toggle('e621-voted-down');
    upBtn.classList.remove('e621-voted-up');
    applyVoteButtonColors(container);
    setTimeout(() => updateVoteScore(container), 500);
  });
  
  // Score between the two buttons (from .ptbr-score)
  const scoreEl = document.createElement('span');
  scoreEl.className = 'e621-vote-score';
  scoreEl.setAttribute('aria-label', 'Score');
  
  container.appendChild(upBtn);
  container.appendChild(scoreEl);
  container.appendChild(downBtn);
  document.body.appendChild(container);
  updateVoteScore(container);
  syncVoteButtonsState(container);
  applyVoteButtonColors(container);
  // Keep state and score in sync when user votes via native buttons
  const voteArea = voteButton.closest('section, .post-information, [class*="vote"], [class*="score"]') || voteButton.parentElement;
  if (voteArea) {
    const syncObserver = new MutationObserver(() => {
      syncVoteButtonsState(container);
      updateVoteScore(container);
    });
    syncObserver.observe(voteArea, { attributes: true, characterData: true, childList: true, subtree: true });
  }
}

// Update score display from .ptbr-score (text color: green if > 0, red if < 0)
function updateVoteScore(container) {
  if (!container) container = document.getElementById('e621-vote-buttons-container');
  if (!container) return;
  const scoreEl = container.querySelector('.e621-vote-score');
  if (!scoreEl) return;
  const nativeScore = document.querySelector('.ptbr-score');
  const raw = nativeScore ? nativeScore.textContent.trim() : '';
  scoreEl.textContent = raw || '—';
  const num = parseInt(raw.replace(/\s/g, ''), 10);
  scoreEl.classList.remove('e621-score-positive', 'e621-score-negative');
  if (!Number.isNaN(num)) {
    if (num > 0) scoreEl.classList.add('e621-score-positive');
    else if (num < 0) scoreEl.classList.add('e621-score-negative');
  }
}

// Apply background colors to vote buttons via inline style (overrides page CSS)
const E621_VOTE_UP_COLOR = '#227d2a';
const E621_VOTE_DOWN_COLOR = '#4d0000';
const E621_VOTE_DEFAULT_COLOR = 'rgba(1, 46, 87, 0.9)';

function applyVoteButtonColors(container) {
  if (!container) container = document.getElementById('e621-vote-buttons-container');
  if (!container) return;
  const upBtn = container.querySelector('.e621-vote-up');
  const downBtn = container.querySelector('.e621-vote-down');
  if (!upBtn || !downBtn) return;
  const setBg = (el, color) => {
    el.style.setProperty('background', color, 'important');
    el.style.setProperty('background-color', color, 'important');
    el.style.setProperty('background-image', 'none', 'important');
  };
  if (upBtn.classList.contains('e621-voted-up')) {
    setBg(upBtn, E621_VOTE_UP_COLOR);
  } else {
    setBg(upBtn, E621_VOTE_DEFAULT_COLOR);
  }
  if (downBtn.classList.contains('e621-voted-down')) {
    setBg(downBtn, E621_VOTE_DOWN_COLOR);
  } else {
    setBg(downBtn, E621_VOTE_DEFAULT_COLOR);
  }
}

// Sync our vote buttons with native vote state (green when upvoted, red when downvoted)
function syncVoteButtonsState(container) {
  if (!container) container = document.getElementById('e621-vote-buttons-container');
  if (!container) return;
  const upBtn = container.querySelector('.e621-vote-up');
  const downBtn = container.querySelector('.e621-vote-down');
  if (!upBtn || !downBtn) return;
  const nativeButtons = document.querySelectorAll('.st-button.kinetic.ptbr-vote-button, .ptbr-vote-button');
  const isActive = (el) => el && (
    el.classList.contains('active') || el.classList.contains('selected') ||
    el.getAttribute('aria-pressed') === 'true' || el.getAttribute('data-active') === 'true' ||
    el.classList.contains('active-vote') || el.hasAttribute('data-voted')
  );
  const upActive = nativeButtons.length >= 1 && isActive(nativeButtons[0]);
  const downActive = nativeButtons.length >= 2 && isActive(nativeButtons[1]);
  upBtn.classList.toggle('e621-voted-up', !!upActive);
  downBtn.classList.toggle('e621-voted-down', !!downActive);
  applyVoteButtonColors(container);
}

// Get Prev/Next hrefs for pool navigation: only if the nav element is <a>, not <span>.
function getPoolPrevNextHrefs() {
  const poolMatch = location.search.match(/[?&]pool_id=(\d+)/);
  if (!poolMatch) return { prev: null, next: null };
  const poolId = poolMatch[1];
  const navLi = document.getElementById(`nav-link-for-pool-${poolId}`);
  if (!navLi) return { prev: null, next: null };
  const prevEl = navLi.querySelector('.nav-link.prev');
  const nextEl = navLi.querySelector('.nav-link.next');
  const prevHref = prevEl && prevEl.tagName === 'A' && prevEl.getAttribute('href') ? prevEl.getAttribute('href') : null;
  const nextHref = nextEl && nextEl.tagName === 'A' && nextEl.getAttribute('href') ? nextEl.getAttribute('href') : null;
  return { prev: prevHref, next: nextHref };
}

// Open fullscreen overlay for current post image; if pool, add Prev/Next buttons (only when nav is <a>).
function openFullscreenOverlay(img) {
  if (!img || !(img.currentSrc || img.src)) return;
  const { prev: prevHref, next: nextHref } = getPoolPrevNextHrefs();

  const overlay = document.createElement('div');
  overlay.className = 'e621-fullscreen-overlay';
  overlay.setAttribute('aria-label', 'Close fullscreen');

  const navigateTo = (path) => {
    const url = new URL(path, location.origin);
    url.searchParams.set('e621_fullscreen', '1');
    window.location.href = url.toString();
  };

  if (prevHref) {
    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'e621-fullscreen-nav e621-fullscreen-prev';
    prevBtn.setAttribute('aria-label', 'Previous');
    prevBtn.textContent = 'Prev';
    prevBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      navigateTo(prevHref);
    });
    overlay.appendChild(prevBtn);
  }

  const contentDiv = document.createElement('div');
  contentDiv.className = 'e621-fullscreen-content';
  const fullscreenImg = document.createElement('img');
  fullscreenImg.src = img.currentSrc || img.src;
  fullscreenImg.alt = img.alt || '';
  const safeH = Math.min(window.innerHeight, window.visualViewport?.height ?? window.innerHeight) - 80;
  const safeW = Math.min(window.innerWidth, window.visualViewport?.width ?? window.innerWidth) - 160;
  fullscreenImg.style.maxHeight = safeH + 'px';
  fullscreenImg.style.maxWidth = safeW + 'px';
  contentDiv.appendChild(fullscreenImg);
  overlay.appendChild(contentDiv);

  if (nextHref) {
    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'e621-fullscreen-nav e621-fullscreen-next';
    nextBtn.setAttribute('aria-label', 'Next');
    nextBtn.textContent = 'Next';
    nextBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      navigateTo(nextHref);
    });
    overlay.appendChild(nextBtn);
  }

  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };

  const onKey = (ev) => {
    if (ev.key === 'Escape') close();
    if (prevHref && ev.key === 'ArrowLeft') navigateTo(prevHref);
    if (nextHref && ev.key === 'ArrowRight') navigateTo(nextHref);
  };

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.classList.contains('e621-fullscreen-content')) close();
  });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
}

// If URL has e621_fullscreen=1, open fullscreen and remove param.
function openFullscreenFromPoolParam() {
  if (!window.location.search.includes('e621_fullscreen=1')) return;
  if (isListPage()) return;
  const container = document.getElementById('image-container');
  if (!container || container.querySelector('video') && !container.querySelector('img')) return;
  const img = container.querySelector('img');
  if (!img || !(img.currentSrc || img.src)) return;
  const cleanUrl = () => {
    const u = new URL(location.href);
    u.searchParams.delete('e621_fullscreen');
    const q = u.searchParams.toString();
    const newUrl = u.pathname + (q ? '?' + q : '') + u.hash;
    history.replaceState(null, '', newUrl);
  };
  setTimeout(() => {
    openFullscreenOverlay(img);
    cleanUrl();
  }, 600);
}

// On post page only: click on image/gif in #image-container opens fullscreen with black background. Videos are ignored.
function setupImageFullscreenOnPostPage() {
  if (isListPage()) return;
  const container = document.getElementById('image-container');
  if (!container || container.getAttribute('data-e621-fullscreen-bound') === 'true') return;
  // If the main content is a video, do not add click-to-fullscreen (only images/gifs)
  if (container.querySelector('video')) {
    const imgs = container.querySelectorAll('img');
    if (imgs.length === 0) return; // video-only post, nothing to do
  }
  container.setAttribute('data-e621-fullscreen-bound', 'true');
  container.addEventListener('click', (e) => {
    if (e.target.closest('video')) return;
    const img = e.target.tagName === 'IMG' ? e.target : (e.target.closest('a')?.querySelector('img') || e.target.closest('img'));
    if (!img || !(img.currentSrc || img.src)) return;
    e.preventDefault();
    e.stopPropagation();
    openFullscreenOverlay(img);
  }, true);
}

// Add hearts to tags and artists
function addHeartsToTags() {
  // Artist tags - detect by artist-tag-list class
  const artistTags = document.querySelectorAll('.tag-list.artist-tag-list .tag-list-item.tag-artist .tag-list-search .tag-list-name');
  artistTags.forEach(tagEl => {
    if (tagEl.querySelector('.e621-heart') || tagEl.closest('.tag-list-item')?.querySelector('.e621-heart')) return;
    
    // Extract artist name without tag-list-count span and badges
    // Only take direct text from tag-list-name span, not title or other elements
    let artistName = '';
    
    // Method 1: Search for text directly in child text nodes
    const textNodes = Array.from(tagEl.childNodes).filter(node => 
      node.nodeType === Node.TEXT_NODE && node.textContent.trim()
    );
    
    if (textNodes.length > 0) {
      // Take the first text node that contains the name (before badges)
      artistName = textNodes[0].textContent.trim();
    } else {
      // Method 2: Clone and remove all elements except text
      const clone = tagEl.cloneNode(true);
      
      // Remove tag-list-count span
      const countSpan = clone.querySelector('.tag-list-count');
      if (countSpan) {
        countSpan.remove();
      }
      
      // Remove all other child elements (badges, icons, etc.)
      const childElements = Array.from(clone.children);
      childElements.forEach(el => {
        el.remove();
      });
      
      // Get remaining text
      artistName = clone.textContent.trim();
    }
    
    // If still empty, try direct textContent but removing elements
    if (!artistName) {
      // Clone the element instead of using innerHTML
      const clone = tagEl.cloneNode(true);
      
      // Remove tag-list-count
      const countSpan = clone.querySelector('.tag-list-count');
      if (countSpan) {
        countSpan.remove();
      }
      
      // Remove all other elements (badges, etc.)
      clone.querySelectorAll('*').forEach(el => {
        if (el.classList.contains('tag-list-count')) {
          el.remove();
        } else {
          // Replace with its text only if it's an inline element
          const text = el.textContent.trim();
          if (text) {
            el.replaceWith(document.createTextNode(text));
          } else {
            el.remove();
          }
        }
      });
      
      artistName = clone.textContent.trim();
    }
    
    // Clean name (remove multiple spaces, leading/trailing special chars)
    artistName = artistName.replace(/\s+/g, ' ').trim();
    
    // If name still has suspicious chars, take only the first part
    if (artistName.includes('\n') || artistName.length > 100) {
      artistName = artistName.split('\n')[0].split(/\s{2,}/)[0].trim();
    }
    
    if (artistName) {
      const heart = createHeart('artist', artistName, '#f2ac08');
      const countEl = tagEl.querySelector('.tag-list-count') || tagEl.parentNode?.querySelector('.tag-list-count');
      if (countEl) {
        countEl.parentNode.insertBefore(heart, countEl.nextSibling);
        countEl.parentNode.classList.add('e621-has-heart');
      } else {
        tagEl.classList.add('e621-has-heart');
        tagEl.appendChild(heart);
      }
    }
  });

  // Other tags - detect by specific CSS classes
  const tagLists = document.querySelectorAll('.tag-list:not(.artist-tag-list) .tag-list-item');
  tagLists.forEach(tagItem => {
    const tagNameEl = tagItem.querySelector('.tag-list-name');
    if (!tagNameEl || tagNameEl.querySelector('.e621-heart') || tagItem.querySelector('.e621-heart')) return;
    
    const tagName = tagNameEl.textContent.trim();
    const tagType = getTagType(tagItem);
    const tagColor = getTagColor(tagType);
    
    const heart = createHeart('tag', tagName, tagColor);
    const countEl = tagNameEl.querySelector('.tag-list-count') || tagNameEl.parentNode?.querySelector('.tag-list-count');
    if (countEl) {
      countEl.parentNode.insertBefore(heart, countEl.nextSibling);
      countEl.parentNode.classList.add('e621-has-heart');
    } else {
      tagNameEl.classList.add('e621-has-heart');
      tagNameEl.appendChild(heart);
    }
  });
}

function getTagType(tagItem) {
  // First check if it's in the artist list
  const artistList = tagItem.closest('.artist-tag-list');
  if (artistList && tagItem.classList.contains('tag-artist')) {
    return 'artist';
  }
  
  // Then check other tag types by their classes
  if (tagItem.classList.contains('tag-artist')) return 'artist';
  if (tagItem.classList.contains('tag-contributor')) return 'contributor';
  if (tagItem.classList.contains('tag-copyright')) return 'copyright';
  if (tagItem.classList.contains('tag-character')) return 'character';
  if (tagItem.classList.contains('tag-species')) return 'species';
  if (tagItem.classList.contains('tag-lore')) return 'lore';
  if (tagItem.classList.contains('tag-pool')) return 'pool';
  return 'general';
}

function getTagColor(tagType) {
  const colors = {
    artist: '#f2ac08',
    contributor: '#c0c0c0',
    copyright: '#d0d',
    character: '#0a0',
    species: '#ed5d1f',
    general: '#b4c7d9',
    lore: '#282',
    pool: 'wheat'
  };
  return colors[tagType] || colors.general;
}

function createHeart(type, name, color) {
  const heart = document.createElement('span');
  heart.className = 'e621-heart';
  heart.dataset.type = type;
  heart.dataset.name = name;
  heart.dataset.color = color;
  heart.style.cssText = `
    margin-left: 8px;
    cursor: pointer;
    width: ${settings.iconSize}px;
    height: ${settings.iconSize}px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    vertical-align: middle;
    transition: all 0.2s ease;
    user-select: none;
    border-radius: 50%;
    padding: 2px;
  `;
  
  const isFavorite = favorites[type].some(f => f.name.toLowerCase() === name.toLowerCase());
  
  // Create SVG with tag/artist color
  const heartIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  heartIcon.setAttribute('width', settings.iconSize);
  heartIcon.setAttribute('height', settings.iconSize);
  heartIcon.setAttribute('viewBox', '0 0 256 256');
  heartIcon.style.cssText = `
    width: 100%;
    height: 100%;
    transition: all 0.2s ease;
  `;
  
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  if (isFavorite) {
    // Filled heart with tag/artist color
    path.setAttribute('d', 'M240,94c0,70-103.79,126.66-108.21,129a8,8,0,0,1-7.58,0C119.79,220.66,16,164,16,94A62.07,62.07,0,0,1,78,32c20.65,0,38.73,8.88,50,23.89C139.27,40.88,157.35,32,178,32A62.07,62.07,0,0,1,240,94Z');
    path.setAttribute('fill', color);
  } else {
    // Empty heart with tag/artist color
    path.setAttribute('d', 'M240,94c0,70-103.79,126.66-108.21,129a8,8,0,0,1-7.58,0C119.79,220.66,16,164,16,94A62.07,62.07,0,0,1,78,32c20.65,0,38.73,8.88,50,23.89C139.27,40.88,157.35,32,178,32A62.07,62.07,0,0,1,240,94ZM128,177.5c10.36-6.44,96-59.23,96-83.5a46,46,0,0,0-82.62-27.22L128,80l-13.38-13.22A46,46,0,0,0,32,94c0,24.27,85.64,77.06,96,83.5Z');
    path.setAttribute('fill', color);
    path.setAttribute('opacity', '0.6');
  }
  
  heartIcon.appendChild(path);
  heart.appendChild(heartIcon);
  heart.dataset.favorite = isFavorite;
  
  heart.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    await toggleFavorite(type, name, heart);
  }, true);
  
  if (settings.enableAnimations) {
    heart.addEventListener('mouseenter', () => {
      heart.style.transform = 'scale(1.3)';
      if (path) {
      }
    });
    heart.addEventListener('mouseleave', () => {
      heart.style.transform = 'scale(1)';
      heart.style.background = 'transparent';
      if (path) {
        path.setAttribute('opacity', isFavorite ? '1' : '0.6');
      }
    });
  }
  
  return heart;
}

async function toggleFavorite(type, name, heartEl) {
  const favoriteIndex = favorites[type].findIndex(f => f.name.toLowerCase() === name.toLowerCase());
  const color = heartEl.dataset.color || (type === 'artist' ? '#f2ac08' : '#b4c7d9');
  
  if (favoriteIndex >= 0) {
    // Remove from favorites
    favorites[type].splice(favoriteIndex, 1);
    const svg = heartEl.querySelector('svg');
    if (svg) {
      const path = svg.querySelector('path');
      if (path) {
        // Cœur vide
        path.setAttribute('d', 'M240,94c0,70-103.79,126.66-108.21,129a8,8,0,0,1-7.58,0C119.79,220.66,16,164,16,94A62.07,62.07,0,0,1,78,32c20.65,0,38.73,8.88,50,23.89C139.27,40.88,157.35,32,178,32A62.07,62.07,0,0,1,240,94ZM128,177.5c10.36-6.44,96-59.23,96-83.5a46,46,0,0,0-82.62-27.22L128,80l-13.38-13.22A46,46,0,0,0,32,94c0,24.27,85.64,77.06,96,83.5Z');
        path.setAttribute('fill', color);
        path.setAttribute('opacity', '0.6');
      }
    }
    heartEl.dataset.favorite = 'false';
    showToast('Removed from favorites', 'success');
  } else {
    // Check limit
    if (favorites[type].length >= settings.favoritesLimit) {
      showToast(`Limit reached (${settings.favoritesLimit})`, 'error');
      return;
    }
    
    // Add to favorites
    const url = convertToUrl(name);
    favorites[type].push({
      name: name,
      url: url,
      dateAdded: Date.now(),
      frequency: 0
    });
    const svg = heartEl.querySelector('svg');
    if (svg) {
      const path = svg.querySelector('path');
      if (path) {
        // Filled heart
        path.setAttribute('d', 'M240,94c0,70-103.79,126.66-108.21,129a8,8,0,0,1-7.58,0C119.79,220.66,16,164,16,94A62.07,62.07,0,0,1,78,32c20.65,0,38.73,8.88,50,23.89C139.27,40.88,157.35,32,178,32A62.07,62.07,0,0,1,240,94Z');
        path.setAttribute('fill', color);
        path.removeAttribute('opacity');
      }
    }
    heartEl.dataset.favorite = 'true';
    showToast('Added to favorites', 'success');
  }
  
  // Save persistently
  try {
    await browser.storage.local.set({ [`favorites_${type}`]: favorites[type] });
    // Verify save succeeded
    const verify = await browser.storage.local.get(`favorites_${type}`);
    if (!verify[`favorites_${type}`]) {
      console.error('Save error');
    }
    
    // Auto-save to JSON file
    await saveAllFavoritesToJson();
  } catch (error) {
    console.error('Save error:', error);
    showToast('Save error', 'error');
  }
  
  // Animation
  if (settings.enableAnimations) {
    heartEl.style.transform = 'scale(1.5)';
    setTimeout(() => {
      heartEl.style.transform = 'scale(1)';
    }, 200);
  }
}

function convertToUrl(name) {
  const urlName = name.trim().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://e621.net';
  return `${origin}/posts?tags=${encodeURIComponent(urlName)}`;
}

// Normalize an E621 search URL
function normalizeSearchUrl(url) {
  try {
    const urlObj = new URL(url);
    if (urlObj.pathname.includes('/posts')) {
      // Cas 1: URL avec ?q= (ex: e621.net/posts/5542880?q=hi_res+order%3Ascore)
      if (urlObj.searchParams.has('q')) {
        const qValue = urlObj.searchParams.get('q');
        return `${urlObj.origin}/posts?tags=${qValue}`;
      }
      // Case 2: URL with ?tags=
      else if (urlObj.searchParams.has('tags')) {
        const tagsValue = urlObj.searchParams.get('tags');
        return `${urlObj.origin}/posts?tags=${tagsValue}`;
      }
    }
    return null;
  } catch (error) {
    return null;
  }
}

// Extract display name from a search URL
function extractSearchNameFromUrl(url) {
  try {
    const urlObj = new URL(url);
    let searchValue = '';
    
    if (urlObj.searchParams.has('q')) {
      searchValue = urlObj.searchParams.get('q');
    } else if (urlObj.searchParams.has('tags')) {
      searchValue = urlObj.searchParams.get('tags');
    } else {
      return null;
    }
    
    // Decode: replace + with space and decode encoded chars
    const decoded = decodeURIComponent(searchValue.replace(/\+/g, ' '));
    return decoded;
  } catch (error) {
    return null;
  }
}

// Save all favorites to a JSON file
async function saveAllFavoritesToJson() {
  try {
    // Ask background script to save the JSON file
    const response = await browser.runtime.sendMessage({ action: 'saveToJsonFile' });
    if (response && response.success) {
      console.log('JSON file saved automatically:', response.filename);
    } else {
      console.error('JSON save error:', response?.error);
    }
  } catch (error) {
    console.error('JSON save error:', error);
  }
}

// Remove all heart elements from the page (used when disabling hearts on post pages)
function removeHeartsFromPage() {
  document.querySelectorAll('.e621-heart').forEach(el => el.remove());
  document.querySelectorAll('.e621-search-heart').forEach(el => el.remove());
  document.querySelectorAll('.e621-has-heart').forEach(el => el.classList.remove('e621-has-heart'));
}

function updateHearts() {
  // Update all hearts on the page
  document.querySelectorAll('.e621-heart').forEach(heart => {
    const type = heart.dataset.type;
    const name = heart.dataset.name;
    
    if (!type || !name) return;
    
    // Check if favorite exists (case-insensitive)
    const isFavorite = favorites[type]?.some(f => f.name.toLowerCase() === name.toLowerCase()) || false;
    const color = heart.dataset.color || (type === 'artist' ? '#f2ac08' : '#b4c7d9');
    
    const svg = heart.querySelector('svg');
    if (svg) {
      const path = svg.querySelector('path');
      if (path) {
        if (isFavorite) {
          // Filled heart
          path.setAttribute('d', 'M240,94c0,70-103.79,126.66-108.21,129a8,8,0,0,1-7.58,0C119.79,220.66,16,164,16,94A62.07,62.07,0,0,1,78,32c20.65,0,38.73,8.88,50,23.89C139.27,40.88,157.35,32,178,32A62.07,62.07,0,0,1,240,94Z');
          path.setAttribute('fill', color);
          path.removeAttribute('opacity');
        } else {
          // Cœur vide
          path.setAttribute('d', 'M240,94c0,70-103.79,126.66-108.21,129a8,8,0,0,1-7.58,0C119.79,220.66,16,164,16,94A62.07,62.07,0,0,1,78,32c20.65,0,38.73,8.88,50,23.89C139.27,40.88,157.35,32,178,32A62.07,62.07,0,0,1,240,94ZM128,177.5c10.36-6.44,96-59.23,96-83.5a46,46,0,0,0-82.62-27.22L128,80l-13.38-13.22A46,46,0,0,0,32,94c0,24.27,85.64,77.06,96,83.5Z');
          path.setAttribute('fill', color);
          path.setAttribute('opacity', '0.6');
        }
      }
      svg.setAttribute('width', settings.iconSize);
      svg.setAttribute('height', settings.iconSize);
    }
    
    heart.dataset.favorite = isFavorite;
    heart.style.width = `${settings.iconSize}px`;
    heart.style.height = `${settings.iconSize}px`;
  });
}

// Update the search heart
function updateSearchHeart() {
  const heart = document.querySelector('.e621-search-heart');
  if (!heart) return;
  
  const currentUrl = window.location.href;
  const normalizedUrl = normalizeSearchUrl(currentUrl);
  const isFavorite = normalizedUrl ? favorites.search.some(f => f.url === normalizedUrl) : false;
  
  const svg = heart.querySelector('svg');
  if (svg) {
    const path = svg.querySelector('path');
    if (path) {
      if (isFavorite) {
        path.setAttribute('d', 'M240,94c0,70-103.79,126.66-108.21,129a8,8,0,0,1-7.58,0C119.79,220.66,16,164,16,94A62.07,62.07,0,0,1,78,32c20.65,0,38.73,8.88,50,23.89C139.27,40.88,157.35,32,178,32A62.07,62.07,0,0,1,240,94Z');
        path.setAttribute('fill', '#ff0000');
        path.removeAttribute('opacity');
      } else {
        path.setAttribute('d', 'M240,94c0,70-103.79,126.66-108.21,129a8,8,0,0,1-7.58,0C119.79,220.66,16,164,16,94A62.07,62.07,0,0,1,78,32c20.65,0,38.73,8.88,50,23.89C139.27,40.88,157.35,32,178,32A62.07,62.07,0,0,1,240,94ZM128,177.5c10.36-6.44,96-59.23,96-83.5a46,46,0,0,0-82.62-27.22L128,80l-13.38-13.22A46,46,0,0,0,32,94c0,24.27,85.64,77.06,96,83.5Z');
        path.setAttribute('fill', '#ff0000');
        path.setAttribute('opacity', '0.6');
      }
    }
  }
  heart.dataset.favorite = isFavorite;
}

// Add heart to the search bar
function addHeartToSearchBar() {
  const searchForm = document.querySelector('.post-search-form');
  if (!searchForm || searchForm.querySelector('.e621-search-heart')) return;
  
  const heart = document.createElement('span');
  heart.className = 'e621-search-heart';
  heart.style.cssText = `
    margin-left: 10px;
    cursor: pointer;
    width: ${settings.iconSize + 4}px;
    height: ${settings.iconSize + 4}px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    vertical-align: middle;
    transition: all 0.2s ease;
    user-select: none;
    border-radius: 50%;
    padding: 2px;
  `;
  
  const searchColor = '#ff0000'; // Rouge pour les recherches
  heart.dataset.color = searchColor;
  
  // Check if current search is in favorites
  const currentUrl = window.location.href;
  const normalizedUrl = normalizeSearchUrl(currentUrl);
  const isFavorite = normalizedUrl ? favorites.search.some(f => f.url === normalizedUrl) : false;
  
  // Create SVG with red color
  const heartIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  heartIcon.setAttribute('width', settings.iconSize + 4);
  heartIcon.setAttribute('height', settings.iconSize + 4);
  heartIcon.setAttribute('viewBox', '0 0 256 256');
  heartIcon.style.cssText = `
    width: 100%;
    height: 100%;
    transition: all 0.2s ease;
  `;
  
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  
  if (isFavorite) {
    // Filled heart rouge
    path.setAttribute('d', 'M240,94c0,70-103.79,126.66-108.21,129a8,8,0,0,1-7.58,0C119.79,220.66,16,164,16,94A62.07,62.07,0,0,1,78,32c20.65,0,38.73,8.88,50,23.89C139.27,40.88,157.35,32,178,32A62.07,62.07,0,0,1,240,94Z');
    path.setAttribute('fill', searchColor);
    heart.dataset.favorite = 'true';
  } else {
    // Empty red heart
    path.setAttribute('d', 'M240,94c0,70-103.79,126.66-108.21,129a8,8,0,0,1-7.58,0C119.79,220.66,16,164,16,94A62.07,62.07,0,0,1,78,32c20.65,0,38.73,8.88,50,23.89C139.27,40.88,157.35,32,178,32A62.07,62.07,0,0,1,240,94ZM128,177.5c10.36-6.44,96-59.23,96-83.5a46,46,0,0,0-82.62-27.22L128,80l-13.38-13.22A46,46,0,0,0,32,94c0,24.27,85.64,77.06,96,83.5Z');
    path.setAttribute('fill', searchColor);
    path.setAttribute('opacity', '0.6');
    heart.dataset.favorite = 'false';
  }
  
  heartIcon.appendChild(path);
  heart.appendChild(heartIcon);
  
  heart.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    
    // Get and normalize search URL
    const currentUrl = window.location.href;
    const normalizedUrl = normalizeSearchUrl(currentUrl);
    const searchName = extractSearchNameFromUrl(currentUrl);
    
    if (!normalizedUrl || !searchName) {
      showToast('No active search on this page', 'error');
      return;
    }
    
    // Recharger les favoris avant de vérifier/toggle
    await loadFavorites();
    
    // Check if this normalized URL is already in favorites
    const favoriteIndex = favorites.search.findIndex(f => f.url === normalizedUrl);
    
    if (favoriteIndex >= 0) {
      // Remove from favorites
      favorites.search.splice(favoriteIndex, 1);
      const svg = heart.querySelector('svg');
      if (svg) {
        const path = svg.querySelector('path');
        if (path) {
          path.setAttribute('d', 'M240,94c0,70-103.79,126.66-108.21,129a8,8,0,0,1-7.58,0C119.79,220.66,16,164,16,94A62.07,62.07,0,0,1,78,32c20.65,0,38.73,8.88,50,23.89C139.27,40.88,157.35,32,178,32A62.07,62.07,0,0,1,240,94ZM128,177.5c10.36-6.44,96-59.23,96-83.5a46,46,0,0,0-82.62-27.22L128,80l-13.38-13.22A46,46,0,0,0,32,94c0,24.27,85.64,77.06,96,83.5Z');
          path.setAttribute('fill', searchColor);
          path.setAttribute('opacity', '0.6');
        }
      }
      heart.dataset.favorite = 'false';
      showToast('Search removed from favorites', 'success');
    } else {
      // Check limit
      if (favorites.search.length >= settings.favoritesLimit) {
        showToast(`Limit reached (${settings.favoritesLimit})`, 'error');
        return;
      }
      
      // Add to favorites with decoded name and normalized URL
      favorites.search.push({
        name: searchName,
        url: normalizedUrl,
        dateAdded: Date.now(),
        frequency: 0
      });
      
      const svg = heart.querySelector('svg');
      if (svg) {
        const path = svg.querySelector('path');
        if (path) {
          path.setAttribute('d', 'M240,94c0,70-103.79,126.66-108.21,129a8,8,0,0,1-7.58,0C119.79,220.66,16,164,16,94A62.07,62.07,0,0,1,78,32c20.65,0,38.73,8.88,50,23.89C139.27,40.88,157.35,32,178,32A62.07,62.07,0,0,1,240,94Z');
          path.setAttribute('fill', searchColor);
          path.removeAttribute('opacity');
        }
      }
      heart.dataset.favorite = 'true';
      showToast('Search added to favorites', 'success');
    }
    
    // Save persistently (même après redémarrage)
    try {
      await browser.storage.local.set({ favorites_search: favorites.search });
      // Verify save succeeded
      const verify = await browser.storage.local.get('favorites_search');
      if (!verify.favorites_search) {
        console.error('Search save error');
        showToast('Save error', 'error');
      }
      
      // Auto-save to JSON file
      await saveAllFavoritesToJson();
    } catch (error) {
      console.error('Erreur de sauvegarde:', error);
      showToast('Erreur lors de la sauvegarde', 'error');
    }
    
    // Reload to have up-to-date state
    await loadFavorites();
  }, true);
  
  if (settings.enableAnimations) {
    heart.addEventListener('mouseenter', () => {
      heart.style.transform = 'scale(1.3)';
      heart.style.background = 'rgba(255, 0, 0, 0.1)';
      const path = heartIcon.querySelector('path');
      if (path) {
        const isFav = heart.dataset.favorite === 'true';
        path.setAttribute('opacity', isFav ? '1' : '0.9');
      }
    });
    heart.addEventListener('mouseleave', () => {
      heart.style.transform = 'scale(1)';
      heart.style.background = 'transparent';
      const path = heartIcon.querySelector('path');
      if (path) {
        const isFav = heart.dataset.favorite === 'true';
        path.setAttribute('opacity', isFav ? '1' : '0.6');
      }
    });
  }
  
  searchForm.appendChild(heart);
}

// Zoom on image hover
let currentZoomedImage = null;
let currentZoomedLink = null;
let currentZoomedArticle = null;
let currentZoomWrapper = null; // Div wrapper that contains the article and download button

function setupImageZoom() {
  // Check if we're on a list page
  if (!isListPage()) {
    return; // Don't enable zoom on individual pages
  }
  
  // Observe for new images added dynamically
  const observer = new MutationObserver(() => {
    if (isListPage()) {
      addZoomToImages();
    }
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
  
  addZoomToImages();
}

function addZoomToImages() {
  // Target images in section > article > a
  const imageLinks = document.querySelectorAll('section article a img, section article a picture img');
  
  imageLinks.forEach(img => {
    if (img.dataset.zoomEnabled) return; // Already configured
    
    img.dataset.zoomEnabled = 'true';
    
    // Find parent link
    const link = img.closest('a');
    if (!link) return;
    
    // Add zoom on link to capture hover
    link.addEventListener('mouseenter', (e) => {
      e.stopPropagation();
      
      // Always unzoom previous image before zooming the new one
      if (currentZoomedImage && currentZoomedImage !== img) {
        unzoomImage(currentZoomedImage, currentZoomedLink, currentZoomedArticle, currentZoomWrapper);
      }
      
      // Zoom the new image
      zoomImage(img, link);
      currentZoomedImage = img;
      currentZoomedLink = link;
      currentZoomedArticle = link.closest('article');
      currentZoomWrapper = currentZoomedArticle ? currentZoomedArticle.closest('.e621-zoom-wrapper') : null;
    });
    
    link.addEventListener('mouseleave', (e) => {
      e.stopPropagation();
      
      // Unzoom only if it's the currently zoomed image
      if (currentZoomedImage === img) {
        unzoomImage(img, link, link.closest('article'), currentZoomWrapper);
        currentZoomedImage = null;
        currentZoomedLink = null;
        currentZoomedArticle = null;
        currentZoomWrapper = null;
      }
    });
  });
  
  // Zoom on hover for animated thumbnails (article.thumbnail[data-tags~=animated]) for posts without img
  let animatedLinks;
  try {
    animatedLinks = document.querySelectorAll('article a:has(.thumbnail[data-tags~="animated"])');
  } catch (_) {
    animatedLinks = Array.from(document.querySelectorAll('article a')).filter(link =>
      link.querySelector('.thumbnail[data-tags~="animated"]')
    );
  }
  animatedLinks.forEach(link => {
    const thumb = link.querySelector('.thumbnail[data-tags~="animated"]');
    if (!thumb || thumb.dataset.zoomEnabled === 'true') return;
    if (link.querySelector('img')) return; // already handled by img zoom, thumbnail will be scaled in zoomImage()
    thumb.dataset.zoomEnabled = 'true';
    
    link.addEventListener('mouseenter', (e) => {
      e.stopPropagation();
      if (currentZoomedImage && currentZoomedImage !== thumb) {
        unzoomImage(currentZoomedImage, currentZoomedLink, currentZoomedArticle, currentZoomWrapper);
      }
      zoomImage(thumb, link);
      currentZoomedImage = thumb;
      currentZoomedLink = link;
      currentZoomedArticle = link.closest('article');
      currentZoomWrapper = currentZoomedArticle ? currentZoomedArticle.closest('.e621-zoom-wrapper') : null;
    });
    
    link.addEventListener('mouseleave', (e) => {
      e.stopPropagation();
      if (currentZoomedImage === thumb) {
        unzoomImage(thumb, link, link.closest('article'), currentZoomWrapper);
        currentZoomedImage = null;
        currentZoomedLink = null;
        currentZoomedArticle = null;
        currentZoomWrapper = null;
      }
    });
  });
}

function zoomImage(img, link) {
  // Find parent article
  const article = link ? link.closest('article') : null;
  if (!article) return;
  
  // Store original styles if not already done
  if (!img.dataset.originalTransform) {
    img.dataset.originalTransform = img.style.transform || '';
    img.dataset.originalZIndex = img.style.zIndex || '';
    img.dataset.originalPosition = img.style.position || '';
    
    // Store container styles (link/article)
    if (link) {
      link.dataset.originalPosition = link.style.position || '';
      link.dataset.originalZIndex = link.style.zIndex || '';
      link.dataset.originalTransform = link.style.transform || '';
      link.dataset.originalWidth = link.style.width || '';
      link.dataset.originalHeight = link.style.height || '';
    }
  }
  
  // Store original parent of the article (before creating wrapper)
  if (!article.dataset.originalParentStored) {
    const currentParent = article.parentNode;
    const currentNextSibling = article.nextSibling;
    
    // Store a reference to the parent (using a method that persists)
    article.dataset.originalParentTag = currentParent.tagName;
    article.dataset.originalParentClass = currentParent.className;
    
    // Store article index in its parent
    const siblings = Array.from(currentParent.children);
    article.dataset.originalIndex = siblings.indexOf(article).toString();
    
    article.dataset.originalParentStored = 'true';
  }
  
  // Ensure no other image is zoomed
  if (currentZoomedImage && currentZoomedImage !== img) {
    unzoomImage(currentZoomedImage, currentZoomedLink, currentZoomedArticle, currentZoomWrapper);
  }
  
  // Create a div wrapper that contains the article and download button ONLY if it doesn't exist
  let wrapper = article.closest('.e621-zoom-wrapper');
  
  if (!wrapper) {
    wrapper = document.createElement('div');
    wrapper.className = 'e621-zoom-wrapper';
    wrapper.style.cssText = `
      position: relative;
      z-index: 10000;
      transition: transform 0.3s ease;
      transform-origin: center center;
    `;
    
    // Get current parent of the article (before moving it)
    const currentParent = article.parentNode;
    
    // Insert wrapper in place of the article
    currentParent.insertBefore(wrapper, article);
    
    // Move the article (and its download button inside) into the wrapper
    wrapper.appendChild(article);
    
    // Store wrapper reference and mark that wrapper was created
    article.dataset.zoomWrapperCreated = 'true';
    article.dataset.zoomWrapperParent = currentParent;
    currentZoomWrapper = wrapper;
  } else {
    currentZoomWrapper = wrapper;
  }
  
  // Unified zoom: scale only the wrapper (size adjustable in settings)
  const scale = Number(settings.zoomScale) || 1.25;
  img.dataset.zoomed = 'true';
  if (wrapper) {
    wrapper.style.transform = `scale(${scale})`;
    wrapper.style.zIndex = '10000';
  }
}

function unzoomImage(img, link, article, wrapper) {
  if (!img) return;
  
  if (wrapper) {
    wrapper.style.transform = 'scale(1)';
  }
  
  setTimeout(() => {
    img.style.zIndex = img.dataset.originalZIndex || '';
    img.style.position = img.dataset.originalPosition || '';
    img.dataset.zoomed = 'false';
    
    if (link) {
      link.style.position = link.dataset.originalPosition || '';
      link.style.zIndex = link.dataset.originalZIndex || '';
      link.style.transform = link.dataset.originalTransform || '';
      link.style.width = link.dataset.originalWidth || '';
      link.style.height = link.dataset.originalHeight || '';
    }
    
    // Retirer le wrapper et remettre l'article à sa place originale
    if (wrapper && article && article.dataset.zoomWrapperCreated) {
      const originalParent = wrapper.parentNode; // Le parent du wrapper est le parent original
      const nextSibling = wrapper.nextSibling;
      
      if (originalParent) {
        // Remettre l'article à la place du wrapper
        if (nextSibling) {
          originalParent.insertBefore(article, nextSibling);
        } else {
          originalParent.appendChild(article);
        }
        
        // Supprimer le wrapper
        wrapper.remove();
        article.dataset.zoomWrapperCreated = '';
      }
    }
    
    if (article) {
      article.style.position = article.dataset.originalPosition || '';
      article.style.zIndex = article.dataset.originalZIndex || '';
      article.style.transform = article.dataset.originalTransform || '';
    }
    
    if (wrapper) {
      wrapper.style.zIndex = '';
    }
  }, 300);
}

// Boutons de téléchargement
function setupDownloadButtons() {
  // Check if we're on a list page
  if (!isListPage()) {
    return; // Ne pas ajouter les boutons sur les pages individuelles
  }
  
  // Observer pour les nouveaux articles
  const observer = new MutationObserver(() => {
    if (isListPage()) {
      addDownloadButtons();
    }
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
  
  addDownloadButtons();
}

function addDownloadButtons() {
  // Bouton dans tous les articles
  const articles = document.querySelectorAll('section article, article');
  
  articles.forEach(article => {
    if (article.querySelector('.e621-download-container')) return; // Already added
    
    let fileUrl = article.getAttribute('data-file-url');
    if (!fileUrl) {
      // Essayer de trouver dans l'image
      const img = article.querySelector('img[data-file-url]');
      if (img) {
        fileUrl = img.getAttribute('data-file-url');
      }
    }
    
    if (!fileUrl) {
      // Essayer de trouver dans le lien de l'image
      const link = article.querySelector('a[href*="/data/"]');
      if (link) {
        fileUrl = link.href;
      }
    }
    
    // Essayer de trouver l'URL depuis le post ID
    if (!fileUrl) {
      const postId = article.getAttribute('data-id') || article.id?.match(/\d+/)?.[0];
      if (postId) {
        // Essayer de récupérer depuis l'API ou le DOM
        const dataUrl = article.querySelector('[data-file-url]');
        if (dataUrl) {
          fileUrl = dataUrl.getAttribute('data-file-url');
        }
      }
    }
    
    if (fileUrl) {
      // Create a clean container below the article
      const downloadContainer = document.createElement('div');
      downloadContainer.className = 'e621-download-container';
      downloadContainer.style.cssText = `
        margin-top: 10px;
        padding: 10px;
        background: linear-gradient(135deg, #012e57 0%, #014995 100%);
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        border: 1px solid #014995;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      `;
      
      const downloadBtn = document.createElement('button');
      downloadBtn.className = 'e621-download-btn';
      
      // Create SVG safely
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', '16');
      svg.setAttribute('height', '16');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('fill', 'currentColor');
      svg.style.cssText = 'margin-right: 6px; vertical-align: middle;';
      
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z');
      svg.appendChild(path);
      
      downloadBtn.appendChild(svg);
      const textNode = document.createTextNode('Download');
      downloadBtn.appendChild(textNode);
      downloadBtn.style.cssText = `
        padding: 10px 20px;
        background: #fcb328;
        color: #00254a;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 600;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        transition: all 0.3s ease;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
      `;
      
      downloadBtn.addEventListener('mouseenter', () => {
        downloadBtn.style.background = '#ffc84d';
        downloadBtn.style.transform = 'translateY(-2px)';
        downloadBtn.style.boxShadow = '0 4px 8px rgba(0, 0, 0, 0.3)';
      });
      
      downloadBtn.addEventListener('mouseleave', () => {
        downloadBtn.style.background = '#fcb328';
        downloadBtn.style.transform = 'translateY(0)';
        downloadBtn.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.2)';
      });
      
      downloadBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        downloadBtn.style.opacity = '0.7';
        downloadBtn.style.cursor = 'wait';
        try {
          await downloadFile(fileUrl);
          showToast('Download started', 'success');
        } catch (error) {
          showToast('Download error', 'error');
        } finally {
          setTimeout(() => {
            downloadBtn.style.opacity = '1';
            downloadBtn.style.cursor = 'pointer';
          }, 1000);
        }
      });
      
      downloadContainer.appendChild(downloadBtn);
      
      // Insert container at end of article
      article.appendChild(downloadContainer);
    }
  });
  
  // Transformer les boutons Download existants
  const downloadLinks = document.querySelectorAll('a[href*="/download"]');
  downloadLinks.forEach(link => {
    if (link.parentElement.querySelector('.e621-download-menu')) return;
    
    const originalHref = link.href;
    const postIdMatch = originalHref.match(/\/posts\/(\d+)\/download/);
    if (!postIdMatch) return;
    const postId = postIdMatch[1];
    
    const container = document.createElement('div');
    container.style.cssText = 'display: inline-block; position: relative;';
    
    const dropdownBtn = document.createElement('button');
    dropdownBtn.textContent = 'Download >';
    dropdownBtn.style.cssText = `
      padding: 5px 10px;
      background: #014995;
      color: #ffffff;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
    `;
    
    const menu = document.createElement('div');
    menu.className = 'e621-download-menu';
    menu.style.cssText = `
      display: none;
      position: absolute;
      top: 100%;
      left: 0;
      background: #012e57;
      border: 1px solid #014995;
      border-radius: 4px;
      padding: 5px 0;
      z-index: 1000;
      min-width: 150px;
    `;
    
    const formats = [
      { label: 'Default format', action: async () => await downloadFile(originalHref) },
      { label: 'PNG', action: async () => await downloadAsFormat(postId, 'png') },
      { label: 'JPG', action: async () => await downloadAsFormat(postId, 'jpg') },
      { label: 'WEBP', action: async () => await downloadAsFormat(postId, 'webp') }
    ];
    
    formats.forEach(format => {
      const item = document.createElement('div');
      item.textContent = format.label;
      item.style.cssText = `
        padding: 8px 15px;
        cursor: pointer;
        color: #ffffff;
        font-size: 12px;
      `;
      item.addEventListener('mouseenter', () => {
        item.style.background = '#014995';
      });
      item.addEventListener('mouseleave', () => {
        item.style.background = 'transparent';
      });
      item.addEventListener('click', async () => {
        await format.action();
        menu.style.display = 'none';
      });
      menu.appendChild(item);
    });
    
    dropdownBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
    });
    
    document.addEventListener('click', (e) => {
      if (!container.contains(e.target)) {
        menu.style.display = 'none';
      }
    });
    
    container.appendChild(dropdownBtn);
    container.appendChild(menu);
    
    link.parentNode.replaceChild(container, link);
  });
}

async function downloadFile(url, filename) {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename || url.split('/').pop();
    a.click();
    URL.revokeObjectURL(blobUrl);
    
    if (settings.enableSounds) {
      playSound();
    }
  } catch (error) {
    console.error('Download error:', error);
    showToast('Download error', 'error');
  }
}

async function downloadAsFormat(postId, format) {
  // Get file URL from the article
  const article = document.querySelector(`article[data-id="${postId}"]`) || 
                  document.querySelector('article[data-file-url]');
  if (article) {
    let fileUrl = article.getAttribute('data-file-url');
    if (!fileUrl) {
      // Essayer de trouver l'image principale
      const img = article.querySelector('img[data-file-url]');
      if (img) {
        fileUrl = img.getAttribute('data-file-url');
      }
    }
    
    if (fileUrl) {
      // Pour convertir le format, on doit utiliser l'API E621 ou télécharger et convertir
      // Pour l'instant, on télécharge le fichier original
      // Note: E621 ne permet pas de changer le format directement via URL
      // Il faudrait télécharger et convertir côté client, ce qui est complexe
      // Pour l'instant, on télécharge le fichier original
      const response = await fetch(fileUrl);
      const blob = await response.blob();
      
      // Create canvas to convert if possible
      if (blob.type.startsWith('image/')) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          
          canvas.toBlob((convertedBlob) => {
            const url = URL.createObjectURL(convertedBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `e621_${postId}.${format}`;
            a.click();
            URL.revokeObjectURL(url);
            
            if (settings.enableSounds) {
              playSound();
            }
          }, `image/${format}`, 0.95);
        };
        img.src = URL.createObjectURL(blob);
      } else {
        // Pour les vidéos/GIFs, on télécharge tel quel
        await downloadFile(fileUrl);
      }
    }
  }
}

function playSound(context) {
  // context: 'pageClick' | 'pageLoad' | undefined (autre, ex. téléchargement → seulement enableSounds)
  if (!settings.enableSounds) return;
  if (context === 'pageClick' && !settings.soundOnPageClick) return;
  if (context === 'pageLoad' && !settings.soundOnPageLoad) return;
  
  try {
    const audio = new Audio(browser.runtime.getURL('assets/Sounds/open.mp3'));
    const vol = Number(settings.soundVolume);
    audio.volume = typeof vol === 'number' && !Number.isNaN(vol) ? Math.min(1, Math.max(0, vol)) : 0.3;
    audio.play().catch(() => {}); // Ignore errors
  } catch (error) {
    // Ignore audio playback errors
  }
}

// Prevent navigation when clicking a heart (parent link must not follow)
document.addEventListener('click', (e) => {
  const heart = e.target.closest('.e621-heart, .e621-search-heart');
  if (heart) {
    e.preventDefault();
  }
}, true);

// Intercepter les clics sur les favoris pour jouer le son
document.addEventListener('click', (e) => {
  const favoriteLink = e.target.closest('.favorite-item a');
  if (favoriteLink && settings.enableSounds) {
    playSound('pageClick');
  }
  
  // Check if clicking a favorite link (tag/artist/search)
  const heart = e.target.closest('.e621-heart, .e621-search-heart');
  if (heart && heart.dataset.favorite === 'true' && settings.enableSounds) {
    const type = heart.dataset.type;
    const name = heart.dataset.name || heart.dataset.search;
    if (name) {
      const isFavorite = favorites[type]?.some(f => f.name.toLowerCase() === name.toLowerCase());
      if (isFavorite) {
        setTimeout(() => {
          const link = heart.closest('a') || heart.parentElement.querySelector('a');
          if (link) {
            playSound('pageClick');
          }
        }, 100);
      }
    }
  }
}, true);

// Detect when landing on a page via a favorite
(function() {
  const urlParams = new URLSearchParams(window.location.search);
  const tags = urlParams.get('tags');
  
  if (tags) {
    // Check if it's a favorite
    const allFavorites = [...(favorites.artist || []), ...(favorites.tag || []), ...(favorites.search || [])];
    const tagNames = tags.split(' ').map(t => t.replace(/_/g, ' '));
    
    const isFavorite = allFavorites.some(f => {
      const favoriteName = f.name.toLowerCase();
      return tagNames.some(t => t.toLowerCase() === favoriteName);
    });
    
    if (isFavorite && settings.enableSounds) {
      setTimeout(() => {
        playSound('pageLoad');
      }, 500);
    }
  }
})();

function showToast(message, type = '') {
  // Supprimer les toasts existants
  const existingToasts = document.querySelectorAll('.e621-toast');
  existingToasts.forEach(t => t.remove());
  
  const toast = document.createElement('div');
  toast.className = `e621-toast ${type}`;
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    padding: 15px 25px;
    background: ${type === 'success' ? '#0a0' : type === 'error' ? '#ed5d1f' : '#014995'};
    color: #ffffff;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    z-index: 10000;
    font-size: 14px;
    font-weight: 500;
    min-width: 200px;
    text-align: center;
    animation: slideInToast 0.3s ease-out;
  `;
  
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.style.animation = 'slideOutToast 0.3s ease-in';
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 3000);
}

// Ajouter les styles d'animation
const style = document.createElement('style');
style.textContent = `
  @keyframes slideInToast {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }
  
  @keyframes slideOutToast {
    from {
      transform: translateX(0);
      opacity: 1;
    }
    to {
      transform: translateX(100%);
      opacity: 0;
    }
  }
`;
document.head.appendChild(style);
