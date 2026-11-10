chrome.action.onClicked.addListener((tab) => {
    chrome.tabs.create({ url: chrome.runtime.getURL("pdf/viewer.html") });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url) {
        const url = new URL(changeInfo.url);
        if (!url.pathname.toLowerCase().endsWith(".pdf")) return;

        if (changeInfo.url.includes(chrome.runtime.id)) return;
        
        if (url.searchParams.has("bypass_ext")) return;

        const viewerUrl = chrome.runtime.getURL("pdf/viewer.html") + "?file=" + encodeURIComponent(changeInfo.url);
        chrome.tabs.update(tabId, { url: viewerUrl });
    }
});
