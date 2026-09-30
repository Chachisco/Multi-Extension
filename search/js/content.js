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

const panel = document.getElementById('sws-panel');
const sidebar = document.getElementById('sws-sidebar');
const rowsContainer = document.getElementById('sws-rows-container');

function getPdfViewport() { return document.getElementById('viewport'); }
function isPdfViewer() { return getPdfViewport() !== null; }
function getSearchRoot() { return isPdfViewer() ? document.getElementById('pages-container') : document.body; }

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
    if (panel.classList.contains('sws-hidden')) {
        renderRows();
        panel.classList.remove('sws-hidden');
        setTimeout(() => document.querySelector('.sws-input')?.focus(), 50);
    } else {
        closeSearch();
    }
};

if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((request) => {
        if (request.action === "toggle-search") {
            window.toggleWebSearch();
        }
    });
}

window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === 'f') {
        e.preventDefault(); 
        e.stopPropagation();
        
        if (panel.classList.contains('sws-hidden')) {
            renderRows();
            panel.classList.remove('sws-hidden');
        }
        
        const input = document.querySelector('.sws-input');
        if (input) {
            input.focus();
            input.select();
        }
    }
    else if (e.key === 'Escape' && !panel.classList.contains('sws-hidden')) {
        closeSearch();
    }
    else if (!panel.classList.contains('sws-hidden') && document.activeElement.tagName !== 'INPUT') {
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); jumpToGlobal(1); }
        if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); jumpToGlobal(-1); }
    }
}, { capture: true });

function closeSearch() {
    panel.classList.add('sws-hidden'); sidebar.classList.add('sws-hidden');
    if (CSS.highlights) CSS.highlights.clear(); 
    currentSearchId++; globalMatches = []; sidebar.innerHTML = '';
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

    const treeWalker = document.createTreeWalker(getSearchRoot(), NodeFilter.SHOW_TEXT, null, false);
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
    const pageHeight = isPdfViewer() ? getPdfViewport().scrollHeight : document.documentElement.scrollHeight;

    rangesByColor.forEach((ranges, idx) => {
        if (ranges.length > 0) {
            const highlight = new Highlight(...ranges);
            highlight.priority = 1;
            CSS.highlights.set(`sws-color-${idx}`, highlight);

            const limit = Math.min(ranges.length, 500);
            for (let i = 0; i < limit; i++) {
                const rect = ranges[i].getBoundingClientRect();
                const viewportOffset = isPdfViewer() ? getPdfViewport().getBoundingClientRect().top : 0;
                const scrollOffset = isPdfViewer() ? getPdfViewport().scrollTop : window.scrollY;
                const absoluteY = rect.top - viewportOffset + scrollOffset;
                
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
        if (isPdfViewer()) {
            const elementRect = element.getBoundingClientRect();
            const viewportRect = getPdfViewport().getBoundingClientRect();
            const absoluteY = elementRect.top - viewportRect.top + getPdfViewport().scrollTop;
            const centerOffset = getPdfViewport().clientHeight / 2;
            
            getPdfViewport().scrollTo({ top: Math.max(0, absoluteY - centerOffset), behavior: 'smooth' });
        } else {
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