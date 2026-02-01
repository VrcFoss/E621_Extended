// Background script for E621+

// Update badge with total favorites count
async function updateBadge() {
  try {
    const data = await browser.storage.local.get([
      'favorites_artist',
      'favorites_tag',
      'favorites_search',
      'settings'
    ]);
    const total =
      (data.favorites_artist?.length || 0) +
      (data.favorites_tag?.length || 0) +
      (data.favorites_search?.length || 0);
    const text = total > 0 ? String(total) : '';
    await browser.action.setBadgeText({ text });
    const badgeColor = data.settings?.badgeColor || '#c41e3a';
    await browser.action.setBadgeBackgroundColor({ color: badgeColor });
  } catch (e) {
    console.error('Badge update error:', e);
  }
}

// Badge on startup
updateBadge();

// Badge when favorites change
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (
    changes.favorites_artist ||
    changes.favorites_tag ||
    changes.favorites_search ||
    changes.settings
  ) {
    updateBadge();
  }
});

// Listen for messages
browser.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  if (message.action === 'updateBadge') {
    await updateBadge();
    sendResponse({ success: true });
  } else if (message.action === 'playSound') {
    playSound();
    sendResponse({ success: true });
  } else if (message.action === 'saveToJsonFile') {
    // Save favorites to a JSON file
    try {
      const allData = await browser.storage.local.get([
        'favorites_artist',
        'favorites_tag',
        'favorites_search',
        'settings'
      ]);
      
      const backupData = {
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        favorites: {
          artist: allData.favorites_artist || [],
          tag: allData.favorites_tag || [],
          search: allData.favorites_search || []
        },
        settings: allData.settings || {}
      };
      
      const jsonData = JSON.stringify(backupData, null, 2);
      
      // Save to local storage as backup
      await browser.storage.local.set({ 
        last_backup: {
          data: backupData,
          timestamp: Date.now()
        }
      });
      
      // Create data URL for download
      const dataUrl = 'data:application/json;charset=utf-8,' + encodeURIComponent(jsonData);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      const filename = `e621_favorites_backup_${timestamp}.json`;
      
      // Download the file
      try {
        await browser.downloads.download({
          url: dataUrl,
          filename: filename,
          saveAs: false,
          conflictAction: 'uniquify'
        });
        sendResponse({ success: true, filename: filename });
      } catch (downloadError) {
        console.error('Download error:', downloadError);
        sendResponse({ success: false, error: downloadError.message });
      }
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
    return true; // Allow async response
  }
  return true;
});

function playSound() {
  // Sound will be played from the content script
}
