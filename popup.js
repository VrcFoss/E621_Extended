// Supported sites (e621 + e926)
const E621_SITES = ['https://e621.net/*', 'https://e926.net/*'];

// Gestion des onglets
document.addEventListener('DOMContentLoaded', () => {
  // Navigation entre onglets
  document.querySelectorAll('.tab-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.tab).classList.add('active');
    });
  });

  // Bouton settings
  document.getElementById('settings-btn').addEventListener('click', () => {
    document.querySelectorAll('.tab-nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    document.getElementById('settings').classList.add('active');
  });

  // Bouton Ko-fi
  document.getElementById('kofi-btn').addEventListener('click', () => {
    browser.tabs.create({ url: 'https://ko-fi.com/marouvevr' });
  });

  // Color picker (heart)
  const colorPreview = document.getElementById('color-preview');
  const heartColor = document.getElementById('heart-color');
  if (colorPreview && heartColor) {
    colorPreview.addEventListener('click', () => heartColor.click());
    heartColor.addEventListener('input', (e) => {
      colorPreview.style.background = e.target.value;
    });
  }

});

// Gestion des favoris
class FavoritesManager {
  constructor(type) {
    this.type = type;
    this.storageKey = `favorites_${type}`;
    // Mapping des types vers les nouveaux IDs
    const typeMap = {
      'artist': 'artists',
      'tag': 'tags',
      'search': 'searches'
    };
    const tabId = typeMap[type] || type;
    
    this.inputId = `${type}-input`;
    this.listId = `${type}-list`;
    this.addBtnId = `add-${type}-btn`;
    this.countId = `${type}-count`;
    this.searchId = `${type}-search`;
    this.sortId = `${type}-sort`;
    this.importId = `import-${type}`;
    this.exportId = `export-${type}`;
    this.alreadyMsgId = `${type}-already-msg`;
    
    this.init();
  }

  async init() {
    await this.loadFavorites();
    this.setupEventListeners();
    this.render();
    this.updateCount(); // Show correct count after loading favorites
  }

  setupEventListeners() {
    const addBtn = document.getElementById(this.addBtnId);
    const input = document.getElementById(this.inputId);
    const searchInput = document.getElementById(this.searchId);
    const sortSelect = document.getElementById(this.sortId);
    const importBtn = document.getElementById(this.importId);
    const exportBtn = document.getElementById(this.exportId);

    addBtn.addEventListener('click', () => this.addFavorite());
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.addFavorite();
    });
    input.addEventListener('input', () => this.updateAlreadyIndicator());

    searchInput.addEventListener('input', () => this.render());
    sortSelect.addEventListener('change', () => this.render());

    importBtn.addEventListener('click', () => this.importFavorites());
    exportBtn.addEventListener('click', () => this.exportFavorites());
  }

  async loadFavorites() {
    const result = await browser.storage.local.get(this.storageKey);
    
    // Si le storage est vide, essayer de charger depuis le dernier backup
    if (!result[this.storageKey] || result[this.storageKey].length === 0) {
      const backup = await browser.storage.local.get('last_backup');
      if (backup.last_backup && backup.last_backup.data) {
        const typeMap = {
          'favorites_artist': 'artist',
          'favorites_tag': 'tag',
          'favorites_search': 'search'
        };
        const type = typeMap[this.storageKey];
        if (type && backup.last_backup.data.favorites) {
          this.favorites = backup.last_backup.data.favorites[type] || [];
          
          // Restaurer dans le storage local
          await browser.storage.local.set({ [this.storageKey]: this.favorites });
        } else {
          this.favorites = [];
        }
      } else {
        this.favorites = [];
      }
    } else {
      this.favorites = result[this.storageKey] || [];
    }
  }

  async saveFavorites() {
    // Save persistently with browser.storage.local
    // This persists even after PC restart
    try {
      await browser.storage.local.set({ [this.storageKey]: this.favorites });
      // Verify save succeeded
      const verify = await browser.storage.local.get(this.storageKey);
      if (!verify[this.storageKey]) {
        console.error('Erreur lors de la sauvegarde des favoris');
      }
      
      // Sauvegarder automatiquement dans un fichier JSON
      await this.saveToJsonFile();
    } catch (error) {
      console.error('Erreur de sauvegarde:', error);
      this.showToast('Error saving', 'error');
    }
    
    this.updateCount();
    this.render();
    // Notifier le content script (e621 + e926)
    const tabs = await browser.tabs.query({ url: E621_SITES });
    tabs.forEach(tab => {
      browser.tabs.sendMessage(tab.id, { action: 'favoritesUpdated', type: this.type }).catch(() => {});
    });
  }

  async saveToJsonFile() {
    try {
      // Demander au background script de sauvegarder le fichier JSON
      const response = await browser.runtime.sendMessage({ action: 'saveToJsonFile' });
      if (response && response.success) {
        console.log('JSON file saved:', response.filename);
      } else {
        console.error('Erreur lors de la sauvegarde JSON:', response?.error);
      }
    } catch (error) {
      console.error('Erreur lors de la sauvegarde JSON:', error);
    }
  }

  async addFavorite() {
    const input = document.getElementById(this.inputId);
    const name = input.value.trim();
    
    if (!name) {
      this.showToast('Please enter a name', 'error');
      return;
    }

    // Check if already in favorites
    if (this.favorites.some(f => f.name.toLowerCase() === name.toLowerCase())) {
      this.showToast('Already in favorites', 'error');
      return;
    }

    // Check limit
    const settings = await this.getSettings();
    if (this.favorites.length >= settings.favoritesLimit) {
      this.showToast(`Limit reached (${settings.favoritesLimit})`, 'error');
      return;
    }

    const favorite = {
      name: name,
      url: this.convertToUrl(name),
      dateAdded: Date.now(),
      frequency: 0
    };

    this.favorites.push(favorite);
    await this.saveFavorites();
    input.value = '';
    this.updateAlreadyIndicator();
    this.showToast('Added to favorites', 'success');
    
    // Sauvegarder automatiquement dans JSON
    await this.saveToJsonFile();
  }

  convertToUrl(name) {
    const urlName = name.replace(/\s+/g, '_');
    return `https://e621.net/posts?tags=${urlName}`;
  }

  async removeFavorite(index) {
    const removedFavorite = this.favorites[index];
    this.favorites.splice(index, 1);
    await this.saveFavorites();
    this.showToast('Removed from favorites', 'success');
    
    // Sauvegarder automatiquement dans JSON
    await this.saveToJsonFile();
    
    // Notifier le content script (e621 + e926)
    const tabs = await browser.tabs.query({ url: E621_SITES });
    tabs.forEach(tab => {
      browser.tabs.sendMessage(tab.id, { 
        action: 'favoriteRemoved', 
        type: this.type,
        name: removedFavorite.name
      }).catch(() => {});
    });
  }

  async incrementFrequency(index) {
    this.favorites[index].frequency = (this.favorites[index].frequency || 0) + 1;
    // Don't save to JSON for frequency changes (too frequent)
    // Juste sauvegarder dans le storage local
    try {
      await browser.storage.local.set({ [this.storageKey]: this.favorites });
    } catch (error) {
      console.error('Erreur de sauvegarde:', error);
    }
  }

  async getSettings() {
    const result = await browser.storage.local.get('settings');
    return result.settings || {
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
      badgeColor: '#c41e3a',
      disableHeartsOnListPage: false
    };
  }

  filterAndSort() {
    const searchInput = document.getElementById(this.searchId);
    const sortSelect = document.getElementById(this.sortId);
    const searchTerm = searchInput.value.toLowerCase();
    
    let filtered = this.favorites.filter(f => 
      f.name.toLowerCase().includes(searchTerm)
    );

    const sortBy = sortSelect.value;
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'alphabetical':
          return a.name.localeCompare(b.name);
        case 'date':
          return b.dateAdded - a.dateAdded;
        case 'frequency':
          return (b.frequency || 0) - (a.frequency || 0);
        default:
          return 0;
      }
    });

    return filtered;
  }

  render() {
    const list = document.getElementById(this.listId);
    const filtered = this.filterAndSort();
    
    list.textContent = '';
    
    if (filtered.length === 0) {
      const emptyState = document.createElement('div');
      emptyState.className = 'empty-state';
      const emptyImg = document.createElement('img');
      emptyImg.src = 'assets/Images/Icons/heart-fill.svg';
      emptyImg.alt = '';
      const emptyP = document.createElement('p');
      emptyP.textContent = 'No favorites';
      emptyState.appendChild(emptyImg);
      emptyState.appendChild(emptyP);
      list.appendChild(emptyState);
      return;
    }

    filtered.forEach((favorite, index) => {
      const originalIndex = this.favorites.indexOf(favorite);
      const card = document.createElement('div');
      card.className = 'favorite-card';
      card.draggable = true;
      card.dataset.index = originalIndex;

      const dateAdded = new Date(favorite.dateAdded);
      const dateStr = this.formatDate(dateAdded);

      // Create elements safely
      const iconDiv = document.createElement('div');
      iconDiv.className = 'favorite-icon';
      const iconImg = document.createElement('img');
      iconImg.src = 'assets/Images/Icons/heart-fill.svg';
      iconImg.alt = '';
      iconDiv.appendChild(iconImg);

      const infoDiv = document.createElement('div');
      infoDiv.className = 'favorite-info';
      
      const nameDiv = document.createElement('div');
      nameDiv.className = 'favorite-name';
      const nameLink = document.createElement('a');
      nameLink.href = favorite.url;
      nameLink.target = '_blank';
      nameLink.rel = 'noopener noreferrer';
      nameLink.textContent = favorite.name;
      nameDiv.appendChild(nameLink);
      
      const metaDiv = document.createElement('div');
      metaDiv.className = 'favorite-meta';
      const dateSpan = document.createElement('span');
      dateSpan.textContent = dateStr;
      metaDiv.appendChild(dateSpan);
      
      if (favorite.frequency > 0) {
        const freqSpan = document.createElement('span');
        freqSpan.textContent = `• Used ${favorite.frequency}x`;
        metaDiv.appendChild(freqSpan);
      }
      
      infoDiv.appendChild(nameDiv);
      infoDiv.appendChild(metaDiv);

      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'favorite-actions';
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'action-btn delete';
      deleteBtn.dataset.index = originalIndex;
      const deleteImg = document.createElement('img');
      deleteImg.src = 'assets/Images/Icons/trash-solid.svg';
      deleteImg.alt = 'Remove';
      deleteBtn.appendChild(deleteImg);
      actionsDiv.appendChild(deleteBtn);

      card.appendChild(iconDiv);
      card.appendChild(infoDiv);
      card.appendChild(actionsDiv);

      // Gestion du clic sur le lien - ne pas bloquer la navigation
      const link = card.querySelector('a');
      link.addEventListener('click', async (e) => {
        // Don't prevent navigation with preventDefault
        // Just increment frequency and play sound
        await this.incrementFrequency(originalIndex);
        
        // Play sound if enabled (general sounds + sound on popup click)
        const settings = await this.getSettings();
        if (settings.enableSounds && settings.soundOnPopupClick) {
          try {
            const audio = new Audio(browser.runtime.getURL('assets/Sounds/open.mp3'));
            audio.volume = 0.3;
            audio.play().catch(() => {});
          } catch (error) {
            // Ignorer les erreurs
          }
        }
        // Laisser le navigateur ouvrir le lien normalement
      });
      
      // Handle click on entire card to open link
      card.addEventListener('click', (e) => {
        // Si on ne clique pas sur le bouton delete, ouvrir le lien
        if (!e.target.closest('.action-btn')) {
          link.click();
        }
      });

      // Handle delete (deleteBtn is already created above)
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.removeFavorite(originalIndex);
      });

      // Drag & Drop
      card.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', originalIndex);
        card.classList.add('dragging');
      });

      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
      });

      card.addEventListener('dragover', (e) => {
        e.preventDefault();
        const dragging = document.querySelector('.dragging');
        if (dragging && dragging !== card) {
          const allCards = Array.from(list.querySelectorAll('.favorite-card'));
          const draggingIndex = allCards.indexOf(dragging);
          const currentIndex = allCards.indexOf(card);
          
          if (draggingIndex < currentIndex) {
            list.insertBefore(dragging, card.nextSibling);
          } else {
            list.insertBefore(dragging, card);
          }
        }
      });

      card.addEventListener('drop', async (e) => {
        e.preventDefault();
        const draggedIndex = parseInt(e.dataTransfer.getData('text/plain'));
        const targetIndex = parseInt(card.dataset.index);
        
        if (draggedIndex !== targetIndex) {
          const dragged = this.favorites[draggedIndex];
          this.favorites.splice(draggedIndex, 1);
          this.favorites.splice(targetIndex, 0, dragged);
          await this.saveFavorites();
        }
      });

      list.appendChild(card);
    });
  }

  formatDate(date) {
    const now = new Date();
    const diff = now - date;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    if (days === 0) return 'Added today';
    if (days === 1) return 'Added yesterday';
    if (days < 7) return `Added ${days} days ago`;
    if (days < 30) return `Added ${Math.floor(days / 7)} weeks ago`;
    if (days < 365) return `Added ${Math.floor(days / 30)} months ago`;
    return `Added ${Math.floor(days / 365)} years ago`;
  }

  updateCount() {
    const countEl = document.getElementById(this.countId);
    if (countEl) {
      countEl.textContent = this.favorites.length;
    }
  }

  updateAlreadyIndicator() {
    const msg = document.getElementById(this.alreadyMsgId);
    const input = document.getElementById(this.inputId);
    if (!msg || !input) return;
    const name = input.value.trim();
    if (name && this.favorites.some(f => f.name.toLowerCase() === name.toLowerCase())) {
      msg.classList.add('show');
    } else {
      msg.classList.remove('show');
    }
  }

  async exportFavorites() {
    const dataStr = JSON.stringify(this.favorites, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `e621_${this.type}_favorites.json`;
    a.click();
    URL.revokeObjectURL(url);
    this.showToast('Export successful', 'success');
  }

  async importFavorites() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      try {
        const text = await file.text();
        const imported = JSON.parse(text);
        
        if (Array.isArray(imported)) {
          const settings = await this.getSettings();
          const toAdd = imported.slice(0, settings.favoritesLimit - this.favorites.length);
          this.favorites.push(...toAdd);
          await this.saveFavorites();
          this.showToast('Import successful', 'success');
        } else {
          this.showToast('Invalid format', 'error');
        }
      } catch (error) {
        this.showToast('Import error', 'error');
      }
    };
    input.click();
  }

  showToast(message, type = '') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type} show`;
    
    setTimeout(() => {
      toast.classList.remove('show');
    }, 3000);
  }
}

// Initialisation des gestionnaires de favoris
let artistManager, tagManager, searchManager;

document.addEventListener('DOMContentLoaded', async () => {
  artistManager = new FavoritesManager('artist');
  tagManager = new FavoritesManager('tag');
  searchManager = new FavoritesManager('search');

  // Gestion des settings
  await loadSettings();
  setupSettingsListeners();
  setupGlobalExportImport();
  
  // Detect artists on the active page
  detectArtistsOnPage();
});

function setupGlobalExportImport() {
  const exportAllBtn = document.getElementById('export-all');
  const importAllBtn = document.getElementById('import-all');
  if (exportAllBtn) {
    exportAllBtn.addEventListener('click', exportAllFavorites);
  }
  if (importAllBtn) {
    importAllBtn.addEventListener('click', () => document.getElementById('import-all-file').click());
  }
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.json';
  fileInput.id = 'import-all-file';
  fileInput.style.display = 'none';
  fileInput.addEventListener('change', importAllFavorites);
  document.body.appendChild(fileInput);
}

async function exportAllFavorites() {
  try {
    const result = await browser.storage.local.get([
      'favorites_artist',
      'favorites_tag',
      'favorites_search',
      'settings'
    ]);
    const data = {
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      favorites: {
        artist: result.favorites_artist || [],
        tag: result.favorites_tag || [],
        search: result.favorites_search || []
      },
      settings: result.settings || {}
    };
    const dataStr = JSON.stringify(data, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `e621_global_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Global export successful', 'success');
  } catch (error) {
    console.error('Export global:', error);
    showToast('Export error', 'error');
  }
}

async function importAllFavorites(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const favorites = data.favorites || data;
    const artist = Array.isArray(favorites.artist) ? favorites.artist : [];
    const tag = Array.isArray(favorites.tag) ? favorites.tag : [];
    const search = Array.isArray(favorites.search) ? favorites.search : [];
    const settings = await browser.storage.local.get('settings');
    const currentSettings = settings.settings || {};
    const limit = currentSettings.favoritesLimit ?? 100;
    await browser.storage.local.set({
      favorites_artist: artist.slice(0, limit),
      favorites_tag: tag.slice(0, limit),
      favorites_search: search.slice(0, limit)
    });
    if (data.settings && typeof data.settings === 'object') {
      await browser.storage.local.set({
        settings: { ...currentSettings, ...data.settings }
      });
    }
    await artistManager.loadFavorites();
    await tagManager.loadFavorites();
    await searchManager.loadFavorites();
    artistManager.render();
    artistManager.updateCount();
    tagManager.render();
    tagManager.updateCount();
    searchManager.render();
    searchManager.updateCount();
    const tabs = await browser.tabs.query({ url: E621_SITES });
    tabs.forEach(tab => {
      browser.tabs.sendMessage(tab.id, { action: 'favoritesUpdated' }).catch(() => {});
    });
    showToast('Global import successful', 'success');
  } catch (error) {
    console.error('Import global:', error);
    showToast('Import error (invalid file?)', 'error');
  }
}

async function detectArtistsOnPage() {
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (tabs.length === 0) return;
    
    const tab = tabs[0];
    if (!tab.url || (!tab.url.includes('e621.net') && !tab.url.includes('e926.net'))) return;
    
    // Utiliser browser.scripting pour Manifest V3
    let results;
    try {
      results = await browser.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const artists = [];
          const artistTags = document.querySelectorAll('.tag-list.artist-tag-list .tag-list-item.tag-artist .tag-list-search .tag-list-name');
          artistTags.forEach(tagEl => {
            let artistName = '';
            
            // Search for text directly in text nodes of the tag-list-name span
            const textNodes = Array.from(tagEl.childNodes).filter(node => 
              node.nodeType === Node.TEXT_NODE && node.textContent.trim()
            );
            
            if (textNodes.length > 0) {
              // Take the first text node that contains the name (before badges)
              artistName = textNodes[0].textContent.trim();
            } else {
              // Fallback: clone and remove all elements except text
              const clone = tagEl.cloneNode(true);
              
              // Retirer le span tag-list-count
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
              
              // Retirer tag-list-count
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
            
            // Nettoyer le nom
            artistName = artistName.replace(/\s+/g, ' ').trim();
            
            // If name still has suspicious chars, take only the first part
            if (artistName.includes('\n') || artistName.length > 100) {
              artistName = artistName.split('\n')[0].split(/\s{2,}/)[0].trim();
            }
            
            if (artistName && !artists.includes(artistName)) {
              artists.push(artistName);
            }
          });
          return artists;
        }
      });
    } catch (e) {
      // No fallback - tabs.executeScript no longer exists in Manifest V3
      console.error('Error detecting artists:', e);
      results = [];
    }
    
    const artists = results && results[0] ? (results[0].result || results[0]) : null;
    if (artists && artists.length > 0) {
      showArtistSuggestions(Array.isArray(artists) ? artists : [artists]);
    }
  } catch (error) {
    // Ignore errors (page may not be accessible)
    console.log('Artist detection error:', error);
  }
}

function showArtistSuggestions(artists) {
  const container = document.getElementById('artist-suggestions');
  if (!container) return;
  
  // Check which artists are not already in favorites
  const newArtists = artists.filter(artist => 
    !artistManager.favorites.some(f => f.name.toLowerCase() === artist.toLowerCase())
  );
  
  // Vider le conteneur
  container.textContent = '';
  
  if (newArtists.length === 0) {
    return;
  }
  
  // Create elements safely
  const suggestionsBox = document.createElement('div');
  suggestionsBox.className = 'suggestions-box';
  
  const titleDiv = document.createElement('div');
  titleDiv.className = 'suggestions-title';
  const titleImg = document.createElement('img');
  titleImg.src = 'assets/Images/Icons/heart-fill.svg';
  titleImg.alt = '';
  titleDiv.appendChild(titleImg);
  const titleText = document.createTextNode(`Artists detected on this page (${newArtists.length})`);
  titleDiv.appendChild(titleText);
  suggestionsBox.appendChild(titleDiv);
  
  newArtists.forEach(artist => {
    const suggestionItem = document.createElement('div');
    suggestionItem.className = 'suggestion-item';
    
    const nameSpan = document.createElement('span');
    nameSpan.className = 'suggestion-name';
    nameSpan.textContent = artist;
    
    const addBtn = document.createElement('button');
    addBtn.className = 'btn-add';
    addBtn.dataset.artist = artist;
    addBtn.textContent = '+ Add';
    
    suggestionItem.appendChild(nameSpan);
    suggestionItem.appendChild(addBtn);
    suggestionsBox.appendChild(suggestionItem);
  });
  
  container.appendChild(suggestionsBox);
  
  // Ajouter les event listeners
  container.querySelectorAll('.btn-add').forEach(btn => {
    btn.addEventListener('click', async () => {
      const artist = btn.dataset.artist;
      const input = document.getElementById('artist-input');
      input.value = artist;
      await artistManager.addFavorite();
      showArtistSuggestions(artists.filter(a => a !== artist));
    });
  });
}

async function loadSettings() {
  const result = await browser.storage.local.get('settings');
  const settings = result.settings || {
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
    badgeColor: '#c41e3a',
    disableHeartsOnListPage: false
  };
  settings.zoomScale = settings.zoomScale ?? 1.25;
  settings.badgeColor = settings.badgeColor ?? '#c41e3a';
  settings.soundVolume = settings.soundVolume ?? 0.3;

  const heartColor = document.getElementById('heart-color');
  const iconSize = document.getElementById('icon-size');
  const iconSizeValue = document.getElementById('icon-size-value');
  const favoritesLimit = document.getElementById('favorites-limit');
  const zoomScale = document.getElementById('zoom-scale');
  const badgeColor = document.getElementById('badge-color');
  const badgeColorValue = document.getElementById('badge-color-value');
  const toggleAnimations = document.getElementById('toggle-animations');
  const toggleSounds = document.getElementById('toggle-sounds');
  const toggleRemoveAds = document.getElementById('toggle-remove-ads');
  const toggleDisableHeartsListPage = document.getElementById('toggle-disable-hearts-list-page');
  const soundVolume = document.getElementById('sound-volume');
  const soundVolumeValue = document.getElementById('sound-volume-value');
  const toggleSoundPopup = document.getElementById('toggle-sound-popup');
  const toggleSoundPageClick = document.getElementById('toggle-sound-page-click');
  const toggleSoundPageLoad = document.getElementById('toggle-sound-page-load');
  const colorPreview = document.getElementById('color-preview');

  if (heartColor) heartColor.value = settings.heartColor;
  if (iconSize) iconSize.value = settings.iconSize;
  if (iconSizeValue) iconSizeValue.textContent = `${settings.iconSize}px`;
  if (favoritesLimit) favoritesLimit.value = settings.favoritesLimit;
  if (zoomScale) zoomScale.value = String(settings.zoomScale);
  if (badgeColor) badgeColor.value = settings.badgeColor;
  if (badgeColorValue) badgeColorValue.textContent = settings.badgeColor;
  if (colorPreview) colorPreview.style.background = settings.heartColor;
  
  if (toggleAnimations) {
    if (settings.enableAnimations) {
      toggleAnimations.classList.add('active');
    } else {
      toggleAnimations.classList.remove('active');
    }
  }
  
  if (toggleSounds) {
    if (settings.enableSounds) {
      toggleSounds.classList.add('active');
    } else {
      toggleSounds.classList.remove('active');
    }
  }

  if (toggleSoundPopup) {
    toggleSoundPopup.classList.toggle('active', settings.soundOnPopupClick !== false);
  }
  if (toggleSoundPageClick) {
    toggleSoundPageClick.classList.toggle('active', settings.soundOnPageClick !== false);
  }
  if (toggleSoundPageLoad) {
    toggleSoundPageLoad.classList.toggle('active', settings.soundOnPageLoad !== false);
  }
  if (toggleRemoveAds) {
    toggleRemoveAds.classList.toggle('active', settings.removeAds !== false);
  }
  if (toggleDisableHeartsListPage) {
    toggleDisableHeartsListPage.classList.toggle('active', settings.disableHeartsOnListPage === true);
  }
  if (soundVolume) soundVolume.value = Math.round((settings.soundVolume ?? 0.3) * 100);
  if (soundVolumeValue) soundVolumeValue.textContent = `${Math.round((settings.soundVolume ?? 0.3) * 100)}%`;
}

function setupSettingsListeners() {
  const heartColor = document.getElementById('heart-color');
  const iconSize = document.getElementById('icon-size');
  const iconSizeValue = document.getElementById('icon-size-value');
  const favoritesLimit = document.getElementById('favorites-limit');
  const toggleAnimations = document.getElementById('toggle-animations');
  const toggleSounds = document.getElementById('toggle-sounds');
  const toggleSoundPopup = document.getElementById('toggle-sound-popup');
  const toggleSoundPageClick = document.getElementById('toggle-sound-page-click');
  const toggleSoundPageLoad = document.getElementById('toggle-sound-page-load');
  const toggleRemoveAds = document.getElementById('toggle-remove-ads');
  const toggleDisableHeartsListPage = document.getElementById('toggle-disable-hearts-list-page');
  const soundVolume = document.getElementById('sound-volume');
  const soundVolumeValue = document.getElementById('sound-volume-value');
  const zoomScale = document.getElementById('zoom-scale');
  const badgeColor = document.getElementById('badge-color');
  const badgeColorValue = document.getElementById('badge-color-value');
  const colorPreview = document.getElementById('color-preview');
  const resetBtn = document.getElementById('reset-settings');

  if (heartColor) {
    heartColor.addEventListener('input', async (e) => {
      if (colorPreview) colorPreview.style.background = e.target.value;
      await saveSetting('heartColor', e.target.value);
    });
  }

  if (iconSize && iconSizeValue) {
    iconSize.addEventListener('input', async (e) => {
      const value = parseInt(e.target.value);
      iconSizeValue.textContent = `${value}px`;
      await saveSetting('iconSize', value);
    });
  }

  if (favoritesLimit) {
    favoritesLimit.addEventListener('change', async (e) => {
      await saveSetting('favoritesLimit', parseInt(e.target.value));
    });
  }

  if (toggleAnimations) {
    toggleAnimations.addEventListener('click', async () => {
      toggleAnimations.classList.toggle('active');
      await saveSetting('enableAnimations', toggleAnimations.classList.contains('active'));
    });
  }

  if (toggleSounds) {
    toggleSounds.addEventListener('click', async () => {
      toggleSounds.classList.toggle('active');
      await saveSetting('enableSounds', toggleSounds.classList.contains('active'));
    });
  }

  if (toggleSoundPopup) {
    toggleSoundPopup.addEventListener('click', async () => {
      toggleSoundPopup.classList.toggle('active');
      await saveSetting('soundOnPopupClick', toggleSoundPopup.classList.contains('active'));
    });
  }
  if (toggleSoundPageClick) {
    toggleSoundPageClick.addEventListener('click', async () => {
      toggleSoundPageClick.classList.toggle('active');
      await saveSetting('soundOnPageClick', toggleSoundPageClick.classList.contains('active'));
    });
  }
  if (toggleSoundPageLoad) {
    toggleSoundPageLoad.addEventListener('click', async () => {
      toggleSoundPageLoad.classList.toggle('active');
      await saveSetting('soundOnPageLoad', toggleSoundPageLoad.classList.contains('active'));
    });
  }
  if (toggleRemoveAds) {
    toggleRemoveAds.addEventListener('click', async () => {
      toggleRemoveAds.classList.toggle('active');
      await saveSetting('removeAds', toggleRemoveAds.classList.contains('active'));
    });
  }
  if (toggleDisableHeartsListPage) {
    toggleDisableHeartsListPage.addEventListener('click', async () => {
      toggleDisableHeartsListPage.classList.toggle('active');
      await saveSetting('disableHeartsOnListPage', toggleDisableHeartsListPage.classList.contains('active'));
    });
  }
  if (soundVolume && soundVolumeValue) {
    soundVolume.addEventListener('input', async (e) => {
      const pct = parseInt(e.target.value, 10);
      soundVolumeValue.textContent = `${pct}%`;
      await saveSetting('soundVolume', pct / 100);
    });
  }
  if (zoomScale) {
    zoomScale.addEventListener('change', async (e) => {
      await saveSetting('zoomScale', parseFloat(e.target.value));
    });
  }
  if (badgeColor && badgeColorValue) {
    badgeColor.addEventListener('input', async (e) => {
      const value = e.target.value;
      badgeColorValue.textContent = value;
      await saveSetting('badgeColor', value);
      browser.runtime.sendMessage({ action: 'updateBadge' }).catch(() => {});
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', async () => {
      try {
        const defaultSettings = {
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
          badgeColor: '#c41e3a',
          disableHeartsOnListPage: false
        };
        
        // Save persistently
        await browser.storage.local.set({ settings: defaultSettings });
        
        // Verify save succeeded
        const verify = await browser.storage.local.get('settings');
        if (!verify.settings) {
          console.error('Error resetting settings');
        }
        
        await loadSettings();
        showToast('Settings reset', 'success');
      } catch (error) {
        console.error('Reset error:', error);
        showToast('Reset failed', 'error');
      }
    });
  }
}

async function saveSetting(key, value) {
  try {
    const result = await browser.storage.local.get('settings');
    const settings = { ...(result.settings || {}), [key]: value };
    
    await browser.storage.local.set({ settings });
    
    // Verify save succeeded
    const verify = await browser.storage.local.get('settings');
    if (!verify.settings || verify.settings[key] !== value) {
      console.error('Erreur lors de la sauvegarde des settings');
    }
    
    // Notifier le content script (e621 + e926)
    const tabs = await browser.tabs.query({ url: E621_SITES });
    tabs.forEach(tab => {
      browser.tabs.sendMessage(tab.id, { action: 'settingsUpdated', settings }).catch(() => {});
    });
  } catch (error) {
    console.error('Erreur lors de la sauvegarde des settings:', error);
  }
}

function showToast(message, type = '') {
  const toast = document.getElementById('toast');
  const toastMessage = document.getElementById('toast-message');
  if (toast && toastMessage) {
    toastMessage.textContent = message;
    toast.className = `toast ${type} show`;
    
    setTimeout(() => {
      toast.classList.remove('show');
    }, 3000);
  }
}
