// --- ESTADO GLOBAL ---
const MAX_COLORS = 5;
const colorHex = ['#ffeb3b8c', '#8be28b', '#80d8ff', '#ff9f9f', '#e040fb'];

let searchRows = [{ id: 0, text: '', matchCase: false, wholeWord: false, isRegex: false, matches: [], currentIndex: -1 }];
let globalMatches = []; 
let currentGlobalIndex = -1;

let pdfSearchMap = [];
let isSearchMapBuilt = false;

// --- 1. INJEÇÃO DA UI ---
if (!document.getElementById('sws-panel')) {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = `
        <div id="sws-sidebar" class="sws-hidden"></div>
        <div id="sws-panel" class="sws-hidden"><div id="sws-rows-container"></div></div>
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
            <button class="sws-toggle-btn ${row.matchCase ? 'active' : ''}" data-type="case" aria-pressed="${row.matchCase}" title="Match Case">Aa</button>
            <button class="sws-toggle-btn ${row.wholeWord ? 'active' : ''}" data-type="word" aria-pressed="${row.wholeWord}" title="Whole Word">"W"</button>
            <button class="sws-toggle-btn ${row.isRegex ? 'active' : ''}" data-type="regex" aria-pressed="${row.isRegex}" title="Regex">.*</button>
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
        `;

        rowEl.querySelectorAll('.sws-toggle-btn').forEach(btn => {
            btn.onclick = () => {
                const type = btn.dataset.type;
                if (type === 'case') row.matchCase = !row.matchCase;
                if (type === 'word') row.wholeWord = !row.wholeWord;
                if (type === 'regex') row.isRegex = !row.isRegex;
                
                btn.classList.toggle('active');
                btn.setAttribute('aria-pressed', String(btn.classList.contains('active')));
                triggerSearch();
            };
        });

        const inputEl = rowEl.querySelector('.sws-input');
        inputEl.oninput = (e) => { row.text = e.target.value; triggerSearch(); };
        inputEl.onkeydown = (e) => {
            if (e.key === 'Enter') { e.preventDefault(); jumpToMatchRow(index, e.shiftKey ? -1 : 1); }
        };

        rowEl.querySelector('.sws-btn-next').onclick = () => jumpToMatchRow(index, 1);
        rowEl.querySelector('.sws-btn-prev').onclick = () => jumpToMatchRow(index, -1);

        const addBtn = rowEl.querySelector('.sws-btn-add');
        if (addBtn) addBtn.onclick = () => { searchRows.push({ id: searchRows.length, text: '', matchCase: false, wholeWord: false, isRegex: false, matches: [], currentIndex: -1 }); renderRows(); };
        
        const removeBtn = rowEl.querySelector('.sws-btn-remove');
        if (removeBtn) {
            removeBtn.onclick = () => { if (searchRows.length > 1) { searchRows.splice(index, 1); renderRows(); triggerSearch(); } };
        }

        rowsContainer.appendChild(rowEl);
    });
}

// --- 2. EXTRAÇÃO EM BACKGROUND V3.0 ---
window.addEventListener('pdf-document-loaded', async () => {
    isSearchMapBuilt = false;
    pdfSearchMap = [];

    if (!window.pdfViewerState || !window.pdfViewerState.pdfDoc) return;
    const pdfDoc = window.pdfViewerState.pdfDoc;

    for (let i = 1; i <= pdfDoc.numPages; i++) {
        const page = await pdfDoc.getPage(i);
        const content = await page.getTextContent();
        const vp = page.getViewport({ scale: 1 }); 
        
        let pageStr = "";
        let mapping = [];

        content.items.forEach(item => {
            if (item.str.trim() === '') { pageStr += ' '; return; }
            
            const h = Math.abs(item.transform[3]);
            mapping.push({
                index: pageStr.length,
                length: item.str.length,
                xPercent: (item.transform[4] / vp.width) * 100,
                yPercent: ((vp.height - item.transform[5] - h) / vp.height) * 100,
                wPercent: (item.width / vp.width) * 100,
                hPercent: (h / vp.height) * 100
            });
            pageStr += item.str;
            pageStr += item.hasEOL ? '\n' : ' ';
        });
        pdfSearchMap.push({ pageNum: i, text: pageStr, mapping });
    }
    isSearchMapBuilt = true;
    
    if (!panel.classList.contains('sws-hidden')) triggerSearch();
});

// --- 3. EVENTOS E ATALHOS GERAIS ---
window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === 'f') {
        e.preventDefault(); 
        e.stopPropagation();

        const activeElement = document.activeElement;
        if (!panel.classList.contains('sws-hidden') && panel.contains(activeElement) &&
            activeElement.classList.contains('sws-input')) {
            closeSearch();
            return;
        }

        const selection = window.getSelection().toString().trim();

        if (panel.classList.contains('sws-hidden')) {
            renderRows();
            panel.classList.remove('sws-hidden');
        }
        
        const input = document.querySelector('.sws-input');
        if (input) {
            if (selection) {
                input.value = selection;
                searchRows[0].text = selection;
                triggerSearch();
            }
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
    globalMatches = []; sidebar.innerHTML = '';
    document.querySelectorAll('.search-overlay').forEach(el => el.innerHTML = '');
    if (CSS.highlights) CSS.highlights.clear(); 
}

let debounceTimeout;
function triggerSearch() {
    clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(performSearch, 250);
}

// --- 4. MOTOR DE PESQUISA CORE V3.0 ---
async function performSearch() {
    if (isPdfViewer() && !isSearchMapBuilt) {
        setTimeout(performSearch, 500); 
        return;
    }

    document.querySelectorAll('.search-overlay').forEach(el => el.innerHTML = '');
    sidebar.innerHTML = '';
    globalMatches = [];
    if (CSS.highlights) CSS.highlights.clear();

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

    if (activeRows.length === 0) {
        document.querySelectorAll('.sws-counter').forEach(c => c.textContent = '');
        sidebar.classList.add('sws-hidden'); 
        return; 
    }

    if (isPdfViewer()) {
        pdfSearchMap.forEach(pageData => {
            activeRows.forEach(row => {
                row.patterns.forEach(regex => {
                    let match; regex.lastIndex = 0;
                    while((match = regex.exec(pageData.text)) !== null) {
                        if (match[0].length === 0) { regex.lastIndex++; continue; }
                        
                        const startIndex = match.index;
                        const endIndex = match.index + match[0].length;

                        const startItem = pageData.mapping.slice().reverse().find(m => m.index <= startIndex) || pageData.mapping[0];
                        const endItem = pageData.mapping.slice().reverse().find(m => m.index <= endIndex) || startItem;

                        const startCharWidth = startItem.length > 0 ? (startItem.wPercent / startItem.length) : 0;
                        const endCharWidth = endItem.length > 0 ? (endItem.wPercent / endItem.length) : 0;

                        const startOffsetChars = startIndex - startItem.index;
                        const endOffsetChars = endIndex - endItem.index;

                        const exactStartX = startItem.xPercent + (startOffsetChars * startCharWidth);
                        const exactEndX = endItem.xPercent + (endOffsetChars * endCharWidth);

                        const totalWidth = exactEndX - exactStartX;

                        const matchData = {
                            pageNum: pageData.pageNum,
                            x: exactStartX,
                            y: startItem.yPercent,
                            w: totalWidth > 0 ? totalWidth : 2,
                            h: startItem.hPercent * 1.2,
                            colorIdx: row.index % MAX_COLORS
                        };

                        searchRows[row.index].matches.push(matchData);
                        globalMatches.push({ data: matchData, rowIdx: row.index });
                    }
                });
            });
        });
        applyHighlightsPDF();
    } else {
        const treeWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
        let textNode;
        const rangesByColor = [[], [], [], [], []];

        while ((textNode = treeWalker.nextNode())) {
            const parentName = textNode.parentNode.tagName;
            if (parentName === 'SCRIPT' || parentName === 'STYLE' || textNode.parentNode.closest('#sws-panel')) continue;
            
            activeRows.forEach(activeRow => {
                activeRow.patterns.forEach(regex => {
                    let match; regex.lastIndex = 0;
                    while ((match = regex.exec(textNode.nodeValue)) !== null) {
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
        applyHighlightsWeb(rangesByColor);
    }
}

function applyHighlightsPDF() {
    const totalPages = window.pdfViewerState ? window.pdfViewerState.pdfDoc.numPages : 1;
    const viewport = getPdfViewport();
    const viewportRect = viewport?.getBoundingClientRect();

    if (viewport && viewportRect) {
        sidebar.style.top = `${viewportRect.top}px`;
        sidebar.style.left = `${viewportRect.right - sidebar.offsetWidth}px`;
        sidebar.style.right = 'auto';
        sidebar.style.height = `${viewport.clientHeight}px`;
    }

    globalMatches.forEach((match, i) => {
        const data = match.data;
        const pageWrapper = document.querySelector(`#page-wrapper-${data.pageNum}`);
        const overlay = pageWrapper?.querySelector('.search-overlay');
        if (overlay) {
            const box = document.createElement('div');
            box.className = 'search-match-box';
            box.dataset.globalIndex = i;
            box.style.left = `${data.x}%`;
            box.style.top = `${data.y}%`;
            box.style.width = `${data.w}%`;
            box.style.height = `${data.h}%`;
            box.style.backgroundColor = colorHex[data.colorIdx];
            overlay.appendChild(box);
        }

        const marker = document.createElement('div');
        marker.className = 'sws-marker';
        if (viewport && viewportRect && pageWrapper && viewport.scrollHeight > 0) {
            const pageRect = pageWrapper.getBoundingClientRect();
            const matchY = viewport.scrollTop + pageRect.top - viewportRect.top +
                (data.y / 100) * pageRect.height;
            marker.style.top = `${(matchY / viewport.scrollHeight) * viewport.clientHeight}px`;
        } else {
            const absoluteYPercent = (((data.pageNum - 1) + (data.y / 100)) / totalPages) * 100;
            marker.style.top = `${absoluteYPercent}%`;
        }
        marker.style.backgroundColor = colorHex[data.colorIdx];
        marker.onclick = () => {
            currentGlobalIndex = i;
            executeScrollAndHighlightPDF(globalMatches[i]);
            updateCounters();
        };
        sidebar.appendChild(marker);
    });

    updateCounters();
    if (globalMatches.length > 0) {
        sidebar.classList.remove('sws-hidden');
        jumpToGlobal(1);
    } else {
        sidebar.classList.add('sws-hidden');
    }
}

function applyHighlightsWeb(rangesByColor) {
    if (!CSS.highlights) return;
    const scrollElement = document.scrollingElement || document.documentElement;
    const pageHeight = scrollElement.scrollHeight;
    const trackHeight = window.innerHeight;
    sidebar.style.top = '0px';
    sidebar.style.left = 'auto';
    sidebar.style.right = '0px';
    sidebar.style.height = `${trackHeight}px`;

    rangesByColor.forEach((ranges, idx) => {
        if (ranges.length > 0) {
            const highlight = new Highlight(...ranges);
            highlight.priority = 1;
            CSS.highlights.set(`sws-color-${idx}`, highlight);

            const limit = Math.min(ranges.length, 500);
            for (let i = 0; i < limit; i++) {
                const rect = ranges[i].getBoundingClientRect();
                const absoluteY = rect.top + window.scrollY;
                
                const marker = document.createElement('div');
                marker.className = 'sws-marker';
                marker.style.top = `${(absoluteY / pageHeight) * trackHeight}px`;
                marker.style.backgroundColor = colorHex[idx % MAX_COLORS];
                marker.onclick = () => jumpToMatchRow(idx, 0, i); 
                sidebar.appendChild(marker);
            }
        }
    });

    globalMatches.sort((a, b) => a.range.startContainer.compareDocumentPosition(b.range.startContainer) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
    updateCounters();
    if (globalMatches.length > 0) {
        sidebar.classList.remove('sws-hidden');
        jumpToGlobal(1);
    } else {
        sidebar.classList.add('sws-hidden');
    }
}

function updateCounters() {
    searchRows.forEach((row, idx) => {
        const rowEl = document.querySelectorAll('.sws-row')[idx];
        if (rowEl) {
            rowEl.querySelector('.sws-counter').textContent = row.matches.length > 0 ? `${row.currentIndex + 1}/${row.matches.length}` : '0/0';
        }
    });
}

// --- 4. NAVEGAÇÃO ---
function executeScrollAndHighlightPDF(matchEntry) {
    if (!matchEntry) return;
    const data = matchEntry.data;
    document.querySelectorAll('.search-match-box.active-match').forEach(b => b.classList.remove('active-match'));

    const box = document.querySelector(`.search-match-box[data-global-index="${currentGlobalIndex}"]`);
    if (box) box.classList.add('active-match');
    
    if (window.pdfJumpTo) {
        window.pdfJumpTo(data.pageNum, { htmlY: data.y, align: 'center', behavior: 'smooth' },);
    }
}

function executeScrollAndHighlightWeb(range) {
    const activeHighlight = new Highlight(range);
    activeHighlight.priority = 10;
    CSS.highlights.set('sws-active', activeHighlight);

    const element = range.startContainer.parentElement;
    if (element) element.scrollIntoView({ behavior: 'smooth', block: 'center' });
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

    const targetData = row.matches[row.currentIndex];
    
    if (isPdfViewer()) {
        currentGlobalIndex = globalMatches.findIndex(m => m.data === targetData);
        executeScrollAndHighlightPDF(globalMatches[currentGlobalIndex]);
    } else {
        currentGlobalIndex = globalMatches.findIndex(m => m.range === targetData);
        executeScrollAndHighlightWeb(targetData);
    }
    updateCounters();
}

function jumpToGlobal(direction) {
    if (globalMatches.length === 0) return;

    currentGlobalIndex += direction;
    if (currentGlobalIndex >= globalMatches.length) currentGlobalIndex = 0;
    if (currentGlobalIndex < 0) currentGlobalIndex = globalMatches.length - 1;

    const matchEntry = globalMatches[currentGlobalIndex];
    const row = searchRows[matchEntry.rowIdx];
    
    if (isPdfViewer()) {
        row.currentIndex = row.matches.indexOf(matchEntry.data);
        executeScrollAndHighlightPDF(matchEntry);
    } else {
        row.currentIndex = row.matches.indexOf(matchEntry.range);
        executeScrollAndHighlightWeb(matchEntry.range);
    }
    updateCounters();
}