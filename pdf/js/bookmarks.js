import { state } from './state.js';
import { updateNotesSidebar } from './notes.js';
import { jumpTo } from './utils.js';
import { askUserInput } from './ui.js';

export function addBookmarkToUI(overlay, pageNum, x, y, title = '', type = 'bookmark') {
    if (!overlay) return;
    if (type !== 'bookmark') return;

    const bmk = document.createElement('div');
    bmk.className = 'pdf-bookmark-icon';
    bmk.style.top = `${y}%`;
    bmk.dataset.title = title || 'Marcador sem nome';
    bmk.title = bmk.dataset.title;

    bmk.onclick = (e) => {
        e.stopPropagation();
        jumpTo(pageNum, { htmlY: y, align: 'center'});
        bmk.style.background = '#0376db';
        setTimeout(() => bmk.style.background = '', 500);
    };

    overlay.appendChild(bmk);
}

export function addCustomElementToDB(pageNum, y, title, type) {
    const key = `${state.currentFilename}_pg${pageNum}_bookmarks`;
    chrome.storage.local.get([key], result => {
        const items = result[key] || [];
        items.push({ x: 0, y, title, type, isManual: true });
        chrome.storage.local.set({ [key]: items }, () => {
            updateBookmarksSidebar();
            updateNotesSidebar();
            window.dispatchEvent(new CustomEvent('custom-figures-updated'));
        });
    });
}

export function saveBookmarksForPage(pageNum, overlay) {
    const key = `${state.currentFilename}_pg${pageNum}_bookmarks`;
    chrome.storage.local.get([key], result => {
        const existing = result[key] || [];
        const nonBookmarks = existing.filter(e => e.type !== 'bookmark');

        const visualBookmarks = Array.from(overlay.querySelectorAll('.pdf-bookmark-icon')).map(bmk => ({
            x: 0, y: parseFloat(bmk.style.top), title: bmk.dataset.title, type: 'bookmark'
        }));

        chrome.storage.local.set({ [key]: [...nonBookmarks, ...visualBookmarks] }, () => {
            updateBookmarksSidebar();
            updateNotesSidebar();
        });
    });
}

export async function loadBookmarksForPage(pageNum) {
    const overlay = document.querySelector(`#page-wrapper-${pageNum} .bookmarks-overlay`);
    if (!overlay) return;
    overlay.innerHTML = '';
    const key = `${state.currentFilename}_pg${pageNum}_bookmarks`;
    const result = await new Promise(resolve => chrome.storage.local.get([key], resolve));
    
    (result[key] || []).forEach(b => {
        addBookmarkToUI(overlay, pageNum, b.x, b.y, b.title, b.type || 'bookmark');
    });
}

export async function updateBookmarksSidebar() {
    const listContainer = document.getElementById('bookmarks-list');
    if (!listContainer) return;
    listContainer.innerHTML = '';

    const items = await new Promise(resolve => chrome.storage.local.get(null, resolve));
    const prefix = `${state.currentFilename}_pg`;
    const allBookmarks = [];

    Object.keys(items).forEach(key => {
        if (key.startsWith(prefix) && key.endsWith('_bookmarks')) {
            const pageNum = parseInt(key.replace(prefix, '').replace('_bookmarks', ''), 10);
            items[key].forEach(bmk => {
                if (!bmk.type || bmk.type === 'bookmark') {
                    allBookmarks.push({ pageNum, originalY: bmk.y, ...bmk });
                }
            });
        }
    });

    allBookmarks.sort((a, b) => a.pageNum === b.pageNum ? a.y - b.y : a.pageNum - b.pageNum);

    if (allBookmarks.length === 0) {
        listContainer.innerHTML = '<div class="outline-item italic">Nenhum marcador criado.<br><br><b>Shift+Click</b> no PDF para criar um na margem esquerda.</div>';
        return;
    }

    allBookmarks.forEach(bmk => {
        const row = document.createElement('div');
        row.className = 'outline-item';
        row.style.display = 'flex'; row.style.alignItems = 'center'; row.style.justifyContent = 'space-between';
        row.style.padding = '6px'; row.style.borderBottom = '1px solid #333';

        const infoDiv = document.createElement('div');
        infoDiv.style.flex = "1"; infoDiv.style.cursor = "pointer"; infoDiv.style.overflow = "hidden";
        infoDiv.innerHTML = `<strong style="color:#aaa;">Pág ${bmk.pageNum}</strong> - <span style="color:#ddd; font-size: 12px;">${bmk.title}</span>`;
        
        infoDiv.onclick = () => jumpTo(bmk.pageNum, { htmlY: bmk.y, align: 'center' });

        const actionsDiv = document.createElement('div');
        actionsDiv.style.display = "flex"; actionsDiv.style.gap = "4px";

        const btnEdit = document.createElement('button');
        btnEdit.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
        btnEdit.style.cssText = "background:transparent; border:none; color:#888; cursor:pointer;";
        
        btnEdit.onclick = async () => {
            const res = await askUserInput("Mudar Nome do Marcador", bmk.title, false);
            if (res && res.text !== "") forceDBUpdate(bmk.pageNum, bmk.originalY, res.text, false);
        };

        const btnDel = document.createElement('button');
        btnDel.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
        btnDel.style.cssText = "background:transparent; border:none; color:#888; cursor:pointer;";

        btnDel.onclick = () => {
            if (!confirm("Apagar este marcador?")) return;
            const overlay = document.querySelector(`#page-wrapper-${bmk.pageNum} .bookmarks-overlay`);
            if (overlay) {
                const icons = overlay.querySelectorAll('.pdf-bookmark-icon');
                const targetIcon = Array.from(icons).find(i => Math.abs(parseFloat(i.style.top) - bmk.originalY) < 0.1);
                if (targetIcon) targetIcon.remove();
                saveBookmarksForPage(bmk.pageNum, overlay);
            } else {
                forceDBUpdate(bmk.pageNum, bmk.originalY, null, true);
            }
        };

        actionsDiv.appendChild(btnEdit); actionsDiv.appendChild(btnDel);
        row.appendChild(infoDiv); row.appendChild(actionsDiv);
        listContainer.appendChild(row);
    });
}

export function forceDBUpdate(pageNum, targetY, newTitle, isDelete) {
    const key = `${state.currentFilename}_pg${pageNum}_bookmarks`;
    chrome.storage.local.get([key], result => {
        let bmks = result[key] || [];
        if (isDelete) bmks = bmks.filter(b => Math.abs(b.y - targetY) > 0.1);
        else {
            const target = bmks.find(b => Math.abs(b.y - targetY) < 0.1);
            if (target) target.title = newTitle;
        }
        chrome.storage.local.set({ [key]: bmks }, () => {
            updateBookmarksSidebar();
            updateNotesSidebar();
            window.dispatchEvent(new CustomEvent('custom-figures-updated'));
        });
    });
}