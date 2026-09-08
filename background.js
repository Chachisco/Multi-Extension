chrome.action.onClicked.addListener((tab) => {
    chrome.tabs.create({ url: chrome.runtime.getURL("pdf/viewer.html") });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url) {
        const url = new URL(changeInfo.url);
        if (!url.pathname.toLowerCase().endsWith(".pdf")) return;

        // Evitar loop infinito
        if (changeInfo.url.includes(chrome.runtime.id)) return;

        const viewerUrl = chrome.runtime.getURL("pdf/viewer.html") + "?file=" + encodeURIComponent(changeInfo.url);
        chrome.tabs.update(tabId, { url: viewerUrl });
    }
});

chrome.commands.onCommand.addListener((command) => {
    if (command === "open-search") {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, { action: "toggle-search" });
            }
        });
    }
});