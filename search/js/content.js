// --- ESTADO GLOBAL ---
const MAX_COLORS = 5;
const colorHex = ['#ffeb3b', '#8be28b', '#80d8ff', '#ff9f9f', '#e040fb'];

let searchRows = [
    { id: 0, text: '', matchCase: false, wholeWord: false, isRegex: false, matches: [], currentIndex: -1 }
];

let globalMatches = []; 
let currentGlobalIndex = -1;
let currentSearchId = 0;

// --- 1. INJEÇÃO DA UI ---
const wrapper = document.createElement('div');
wrapper.innerHTML = `
    <div id="sws-sidebar" class="sws-hidden"></div>
    <div id="sws-panel" class="sws-hidden">
        <div id="sws-rows-container"></div>
    </div>
`;
document.body.appendChild(wrapper);

const panel = document.getElementById('sws-panel');
const sidebar = document.getElementById('sws-sidebar');
const rowsContainer = document.getElementById('sws-rows-container');

const PDF_VIEWPORT = document.getElementById('viewport');
const IS_PDF_VIEWER = PDF_VIEWPORT !== null;
const SEARCH_ROOT = IS_PDF_VIEWER ? document.getElementById('pages-container') : document.body;

if (!document.getElementById('sws-style')) {
    const style = document.createElement('style');
    style.id = 'sws-style';
    style.textContent = `
        #sws-panel { position: fixed; top: ${IS_PDF_VIEWER ? '44px' : '12px'}; right: 25px; z-index: 2147483647; background: #1e1e1e; padding: 8px; border-radius: 6px; display: flex; flex-direction: column; gap: 6px; box-shadow: 0 4px 15px rgba(0,0,0,0.6); border: 1px solid #333; color: white; font-family: sans-serif; transition: transform 0.2s ease, opacity 0.2s ease; }
        #sws-panel.sws-hidden { transform: translateY(-15px); opacity: 0; pointer-events: none; }
        #sws-panel * { box-sizing: border-box; line-height: normal; }
        .sws-row { display: flex; align-items: center; gap: 4px; background: #252526; padding: 4px; border-radius: 4px; border-left: 3px solid transparent; height: 32px; position: relative; overflow: hidden; }
        .sws-input { appearance: none; background: transparent; border: none; color: #ccc; padding: 0 4px; margin: 0; outline: none; width: 180px; height: 24px; font-family: sans-serif; font-size: 13px; box-shadow: none; }
        .sws-input:focus { color: #fff; }
        .sws-counter { font-size: 11px; color: #888; min-width: 40px; text-align: center; margin: 0; }
        #sws-panel button { background: transparent; border: none; color: #999; cursor: pointer; padding: 0; display: flex; align-items: center; justify-content: center; border-radius: 3px; transition: 0.15s; height: 24px; width: 24px; margin: 0; box-shadow: none; }
        #sws-panel button:hover { background: #3a3a3c; color: white; }
        #sws-panel button svg { width: 14px; height: 14px; display: block; }
        .sws-toggle-btn { font-family: monospace; font-size: 12px; font-weight: bold; }
        .sws-toggle-btn.active { color: #d7ba7d !important; background: rgba(215, 186, 125, 0.15) !important; }
        .sws-divider { color: #444; margin: 0 2px; font-size: 10px; }
        #sws-sidebar { position: fixed; top: 0; right: 0; width: 16px; height: 100vh; background: transparent; border: none; z-index: 2147483646; pointer-events: none; transition: opacity 0.2s; }
        #sws-sidebar.sws-hidden { opacity: 0; }
        .sws-marker { position: absolute; right: 0; width: 100%; height: 3px; pointer-events: auto; cursor: pointer; opacity: 0.85; transition: opacity 0.1s; border-radius: 2px; }
        .sws-marker:hover { opacity: 1; filter: brightness(1.2); }
        .sws-progress { position: absolute; bottom: 0; left: 0; width: 100%; height: 2px; background: transparent; pointer-events: none; }
        .sws-progress-value { position: absolute; top: 0; left: -100%; width: 50%; height: 100%; background: #007acc; border-radius: 2px; opacity: 0; }
        .sws-row.is-loading .sws-progress-value { opacity: 1; animation: sws-loading-anim 1s infinite linear; }
        .sws-row.is-done .sws-progress-value { left: 0; width: 100%; background: #8be28b; opacity: 1; transition: left 0.2s, width 0.2s, background-color 0.3s; }
        .sws-row.is-fading .sws-progress-value { opacity: 0; transition: opacity 0.5s ease 2s; }
        @keyframes sws-loading-anim { 0% { left: -50%; width: 30%; } 50% { width: 50%; } 100% { left: 100%; width: 30%; } }
        ::highlight(sws-color-0) { background-color: rgba(255, 235, 59, 0.4); color: black; }
        ::highlight(sws-color-1) { background-color: rgba(139, 226, 139, 0.4); color: black; }
        ::highlight(sws-color-2) { background-color: rgba(128, 216, 255, 0.4); color: black; }
        ::highlight(sws-color-3) { background-color: rgba(255, 159, 159, 0.4); color: black; }
        ::highlight(sws-color-4) { background-color: rgba(224, 64, 251, 0.4); color: white; }
        ::highlight(sws-active) { background-color: #ff9800; color: white; }
    `;
    document.head.appendChild(style);
}

if (!document.getElementById('sws-panel')) {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = `
        <div id="sws-sidebar" class="sws-hidden"></div>
        <div id="sws-panel" class="sws-hidden">
            <div id="sws-rows-container"></div>
        </div>
    `;
    document.body.appendChild(wrapper);
}

function renderRows() {
    rowsContainer.innerHTML = '';
    
    searchRows.forEach((row, index) => {
        const rowEl = document.createElement('div');
        rowEl.className = 'sws-row';
        rowEl.style.borderLeftColor = colorHex[index % MAX_COLORS];

        rowEl.innerHTML = `
            <button class="sws-toggle-btn ${row.matchCase ? 'active' : ''}" data-type="case" title="Match Case">Aa</button>
            <button class="sws-toggle-btn ${row.wholeWord ? 'active' : ''}" data-type="word" title="Whole Word">"W"</button>
            <button class="sws-toggle-btn ${row.isRegex ? 'active' : ''}" data-type="regex" title="Regex">.*</button>
            <span class="sws-divider">|</span>
            <input type="text" class="sws-input" value="${row.text}" placeholder="Pesquisar..." autocomplete="off">
            <span class="sws-counter">${row.matches.length > 0 ? (row.currentIndex + 1) + '/' + row.matches.length : ''}</span>
            <button class="sws-btn-prev" title="Anterior"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m18 15-6-6-6 6"/></svg></button>
            <button class="sws-btn-next" title="Seguinte"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg></button>
            <span class="sws-divider">|</span>
            ${index === searchRows.length - 1 && index < MAX_COLORS - 1 
                ? `<button class="sws-btn-add" title="Adicionar Pesquisa"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg></button>`
                : `<button class="sws-btn-remove" title="Remover"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/></svg></button>`
            }
            <div class="sws-progress"><div class="sws-progress-value"></div></div>
        `;

        rowEl.querySelectorAll('.sws-toggle-btn').forEach(btn => {
            btn.onclick = () => {
                const type = btn.dataset.type;
                if (type === 'case') row.matchCase = !row.matchCase;
                if (type === 'word') row.wholeWord = !row.wholeWord;
                if (type === 'regex') row.isRegex = !row.isRegex;
                renderRows();
                triggerSearch();
            };
        });

        const inputEl = rowEl.querySelector('.sws-input');
        inputEl.oninput = (e) => {
            row.text = e.target.value;
            triggerSearch();
        };
        inputEl.onkeydown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                jumpToMatchRow(index, e.shiftKey ? -1 : 1);
            }
        };

        rowEl.querySelector('.sws-btn-next').onclick = () => jumpToMatchRow(index, 1);
        rowEl.querySelector('.sws-btn-prev').onclick = () => jumpToMatchRow(index, -1);

        const addBtn = rowEl.querySelector('.sws-btn-add');
        if (addBtn) addBtn.onclick = () => { searchRows.push({ id: searchRows.length, text: '', matchCase: false, wholeWord: false, isRegex: false, matches: [], currentIndex: -1 }); renderRows(); };
        
        const removeBtn = rowEl.querySelector('.sws-btn-remove');
        if (removeBtn) {
            removeBtn.onclick = () => { 
                if (searchRows.length > 1) { searchRows.splice(index, 1); renderRows(); triggerSearch(); }
            };
        }

        rowsContainer.appendChild(rowEl);
    });
}

// --- 2. EVENTOS E ATALHOS GERAIS ---

window.toggleWebSearch = function() {
    if (panel.classList.contains('sws-hidden')) renderRows();
    panel.classList.remove('sws-hidden');
    setTimeout(() => document.querySelector('.sws-input')?.focus(), 50);
};

// Escuta a ordem do Ctrl+F vinda do background.js (Em sites normais)
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((request) => {
        if (request.action === "toggle-search") {
            if (panel.classList.contains('sws-hidden')) window.toggleWebSearch();
            else closeSearch();
        }
    });
}

window.addEventListener('keydown', (e) => {
    // FECHAR
    if (e.key === 'Escape' && !panel.classList.contains('sws-hidden')) closeSearch();

    // NAVEGAÇÃO GLOBAL (Setas Cima/Baixo)
    if (!panel.classList.contains('sws-hidden') && document.activeElement.tagName !== 'INPUT') {
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); jumpToGlobal(1); }
        if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); jumpToGlobal(-1); }
    }
}, { capture: true });


window.addEventListener('keydown', (e) => {
    // abrir
    if (e.ctrlKey && e.key.toLowerCase() === 'f') {
        e.preventDefault(); e.stopPropagation();
        if (panel.classList.contains('sws-hidden')) renderRows();
        panel.classList.remove('sws-hidden');
        document.querySelector('.sws-input')?.focus();
    }
    // fechar
    if (e.key === 'Escape' && !panel.classList.contains('sws-hidden')) closeSearch();

    if (!panel.classList.contains('sws-hidden') && document.activeElement.tagName !== 'INPUT') {
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); jumpToGlobal(1); }
        if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); jumpToGlobal(-1); }
    }
}, { capture: true });

function closeSearch() {
    panel.classList.add('sws-hidden'); sidebar.classList.add('sws-hidden');
    CSS.highlights?.clear(); currentSearchId++; globalMatches = []; sidebar.innerHTML = '';
}

let debounceTimeout;
function triggerSearch() {
    clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(performSearch, 200);
}

// --- 3. MOTOR DE PESQUISA CORE ---
async function performSearch() {
    currentSearchId++;
    const mySearchId = currentSearchId;
    if (CSS.highlights) CSS.highlights.clear();
    globalMatches = [];

    searchRows.forEach(row => { row.matches = []; row.currentIndex = -1; });

    const activeRows = searchRows.map((row, idx) => {
        const terms = row.text.split(',').map(s => s.trim()).filter(s => s.length > 0);
        if (terms.length === 0) return null;

        const regexFlags = row.matchCase ? 'g' : 'gi';
        const patterns = terms.map(term => {
            try {
                let pattern = term;
                if (!row.isRegex) pattern = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                if (row.wholeWord) pattern = `\\b(?:${pattern})\\b`;
                return new RegExp(pattern, regexFlags);
            } catch (e) { return null; }
        }).filter(r => r !== null);
        
        return { index: idx, patterns };
    }).filter(r => r !== null && r.patterns.length > 0);

    if (activeRows.length === 0) { renderRows(); sidebar.classList.add('sws-hidden'); return; }

    document.querySelectorAll('.sws-row').forEach((rowEl, idx) => {
        if (activeRows.some(ar => ar.index === idx)) {
            rowEl.classList.remove('is-done', 'is-fading');
            rowEl.classList.add('is-loading');
        }
    });

    const treeWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
    let textNode;
    const rangesByColor = [[], [], [], [], []];

    function processChunk() {
        if (mySearchId !== currentSearchId) return;
        const startTime = performance.now();

        while ((textNode = treeWalker.nextNode()) && (performance.now() - startTime < 40)) {
            const parentName = textNode.parentNode.tagName;
            if (parentName === 'SCRIPT' || parentName === 'STYLE' || textNode.parentNode.closest('#sws-panel')) continue;
            
            const nodeText = textNode.nodeValue;
            
            activeRows.forEach(activeRow => {
                activeRow.patterns.forEach(regex => {
                    let match; regex.lastIndex = 0;
                    while ((match = regex.exec(nodeText)) !== null) {
                        if (match[0].length === 0) { regex.lastIndex++; continue; }
                        if (globalMatches.length > 10000) break; 
                        
                        try {
                            const range = new Range();
                            range.setStart(textNode, match.index);
                            range.setEnd(textNode, match.index + match[0].length);
                            
                            searchRows[activeRow.index].matches.push(range);
                            rangesByColor[activeRow.index % MAX_COLORS].push(range);
                            globalMatches.push({ range, rowIdx: activeRow.index });
                        } catch(e) {}
                    }
                });
            });
        }

        if (textNode && globalMatches.length <= 10000) {
            if (CSS.highlights) {
                rangesByColor.forEach((ranges, idx) => {
                    if (ranges.length > 0) {
                        const highlight = new Highlight(...ranges);
                        highlight.priority = 1;
                        CSS.highlights.set(`sws-color-${idx}`, highlight);
                    }
                });
            }
            
            document.querySelectorAll('.sws-row').forEach((rowEl, idx) => {
                const row = searchRows[idx];
                if (row.matches.length > 0) rowEl.querySelector('.sws-counter').textContent = `.../${row.matches.length}`;
            });

            requestAnimationFrame(processChunk);
        } else {
            applyHighlights(mySearchId, rangesByColor);
        }
    }
    requestAnimationFrame(processChunk);
}

function applyHighlights(searchId, rangesByColor) {
    if (searchId !== currentSearchId) return; 
    if (!CSS.highlights) return;

    sidebar.innerHTML = ''; 
    const pageHeight = IS_PDF_VIEWER ? PDF_VIEWPORT.scrollHeight : document.documentElement.scrollHeight;

    rangesByColor.forEach((ranges, idx) => {
        if (ranges.length > 0) {
            const highlight = new Highlight(...ranges);
            highlight.priority = 1;
            CSS.highlights.set(`sws-color-${idx}`, highlight);

            const limit = Math.min(ranges.length, 500);
            for (let i = 0; i < limit; i++) {
                const rect = ranges[i].getBoundingClientRect();
                const absoluteY = rect.top + (IS_PDF_VIEWER ? PDF_VIEWPORT.scrollTop : window.scrollY);
                
                const marker = document.createElement('div');
                marker.className = 'sws-marker';
                marker.style.top = `${(absoluteY / pageHeight) * 100}%`;
                marker.style.backgroundColor = colorHex[idx % MAX_COLORS];
                marker.onclick = () => jumpToMatchRow(idx, 0, i); 
                sidebar.appendChild(marker);
            }
        }
    });

    globalMatches.sort((a, b) => a.range.startContainer.compareDocumentPosition(b.range.startContainer) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
    
    document.querySelectorAll('.sws-row').forEach((rowEl, idx) => {
        const row = searchRows[idx];
        if (row.text.length > 0) {
            rowEl.querySelector('.sws-counter').textContent = row.matches.length > 0 ? `0/${row.matches.length}` : '0/0';
            rowEl.classList.remove('is-loading');
            rowEl.classList.add('is-done', 'is-fading');
        }
    });

    if (globalMatches.length > 0) {
        sidebar.classList.remove('sws-hidden');
        jumpToGlobal(1);
    } else {
        sidebar.classList.add('sws-hidden');
    }
}

// --- 4. NAVEGAÇÃO INDIVIDUAL E GLOBAL ---
function executeScrollAndHighlight(range) {
    const activeHighlight = new Highlight(range);
    activeHighlight.priority = 10;
    CSS.highlights.set('sws-active', activeHighlight);

    const element = range.startContainer.parentElement;
    if (element) {
        if (IS_PDF_VIEWER) {
            // Scroll no PDF com Offset para não ficar debaixo do Header
            const y = element.getBoundingClientRect().top + PDF_VIEWPORT.scrollTop - 100;
            PDF_VIEWPORT.scrollTo({ top: y, behavior: 'smooth' });
        } else {
            // Scroll nativo na Web
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }
}

function jumpToMatchRow(rowIdx, direction, exactMatchIndex = null) {
    const row = searchRows[rowIdx];
    if (row.matches.length === 0) return;

    if (exactMatchIndex !== null) {
        row.currentIndex = exactMatchIndex;
    } else {
        row.currentIndex += direction;
        if (row.currentIndex >= row.matches.length) row.currentIndex = 0;
        if (row.currentIndex < 0) row.currentIndex = row.matches.length - 1;
    }

    executeScrollAndHighlight(row.matches[row.currentIndex]);

    const rowEls = document.querySelectorAll('.sws-row');
    if(rowEls[rowIdx]) rowEls[rowIdx].querySelector('.sws-counter').textContent = `${row.currentIndex + 1}/${row.matches.length}`;
}

function jumpToGlobal(direction) {
    if (globalMatches.length === 0) return;

    currentGlobalIndex += direction;
    if (currentGlobalIndex >= globalMatches.length) currentGlobalIndex = 0;
    if (currentGlobalIndex < 0) currentGlobalIndex = globalMatches.length - 1;

    const matchData = globalMatches[currentGlobalIndex];
    executeScrollAndHighlight(matchData.range);
    
    const row = searchRows[matchData.rowIdx];
    row.currentIndex = row.matches.indexOf(matchData.range);
    
    const rowEls = document.querySelectorAll('.sws-row');
    if(rowEls[matchData.rowIdx]) {
        rowEls[matchData.rowIdx].querySelector('.sws-counter').textContent = `${row.currentIndex + 1}/${row.matches.length}`;
    }
}