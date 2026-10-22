// Clicking the extension icon opens the side panel. That is all this file does.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
