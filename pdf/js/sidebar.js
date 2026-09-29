import { state } from './state.js';
import { reorderPDFPages, deleteSinglePage, rotateSinglePage } from './pdf_editor.js';

// ==========================================
// 1. elementos dom
// ==========================================
const btnToggle = document.getElementById('btn-toggle-sidebar');
const btnClose = document.getElementById('btn-close-sidebar');
const btnSide = document.getElementById('btn-sidebar-side');
const sidebar = document.getElementById('pdf-sidebar');
const tabOutline = document.getElementById('tab-outline');
const tabThumbnails = document.getElementById('tab-thumbnails');
const tabFigures = document.getElementById('tab-figures');
const viewOutline = document.getElementById('outline-view');
const viewThumbnails = document.getElementById('thumbnails-view');
const viewFigures = document.getElementById('figures-view');
const viewport = document.getElementById('viewport');

// ==========================================
// 2. variáveis de estado
// ==========================================
let thumbnailsRendered = false;
let thumbnailObserver = null;
let figuresLoaded = false;
let globalFiguresData = []; 
let currentFiguresFilter = 'Tudo'; // 'Tudo' | 'Figura' | 'Tabela' | 'Equações' | 'Outros'
let currentFiguresSort = 'Agrupado'; // 'Agrupado' | 'Texto'
let currentFiguresSearch = '';

// ==========================================
// 3. inicialização (arranque da sidebar)
// ==========================================
function initSidebar() {
    // Eventos de botões principais
    if (btnToggle) btnToggle.onclick = toggleSidebar;
    if (btnClose) btnClose.onclick = toggleSidebar;
    if (btnSide) btnSide.onclick = toggleSidebarSide;

    // Eventos de Abas
    if (tabOutline) tabOutline.onclick = () => switchTab(tabOutline, viewOutline);
    if (tabThumbnails) {
        tabThumbnails.onclick = () => {
            switchTab(tabThumbnails, viewThumbnails);
            if (!thumbnailsRendered) renderThumbnails();
            else updateActiveThumbnail(Number(document.getElementById('page-input').value));
        };
    }
    if (tabFigures) {
        tabFigures.onclick = () => {
            switchTab(tabFigures, viewFigures);
            if (!figuresLoaded) loadFiguresList();
        };
    }

    // Eventos do Motor PDF
    window.addEventListener('pdf-rotation-changed', () => {
        if (!thumbnailsRendered || viewThumbnails.classList.contains('hidden')) return;
        thumbnailsRendered = false;
        renderThumbnails();
    });

    window.addEventListener('pdf-document-loaded', () => {
        thumbnailObserver?.disconnect();
        thumbnailObserver = null;
        thumbnailsRendered = false;
        figuresLoaded = false;
        
        if (viewThumbnails) viewThumbnails.innerHTML = '';
        if (viewOutline) viewOutline.innerHTML = '';
        
        const figList = document.getElementById('figures-list');
        if (figList) figList.innerHTML = ''; 

        if (tabThumbnails && tabThumbnails.classList.contains('active') && !sidebar.classList.contains('closed')) {
            renderThumbnails();
        }
    });

    window.addEventListener('pdf-page-changed', event => {
        updateActiveThumbnail(event.detail.pageNum);
    });

    window.addEventListener('keydown', handleSidebarKeys);

    // Inicializa a barra de pesquisa/filtros das figuras
    setupFiguresToolbar();

    // Aplica o Layout Inicial
    updateViewerLayout();
}

// ==========================================
// 4. funções gerais da ui
// ==========================================
function switchTab(activeTab, activeView) {
    [tabOutline, tabThumbnails, tabFigures].forEach(t => { if(t) t.classList.remove('active'); });
    [viewOutline, viewThumbnails, viewFigures].forEach(v => { if(v) v.classList.add('hidden'); });
    
    activeTab.classList.add('active');
    activeView.classList.remove('hidden');
}

export function toggleSidebar() {
    sidebar.classList.toggle('closed');
    updateViewerLayout();
    if (!sidebar.classList.contains('closed') && tabOutline.classList.contains('active')) {
        loadOutline();
    }
}

export function updateViewerLayout() {
    document.body.classList.toggle('sidebar-open-left', !sidebar.classList.contains('closed') && sidebar.classList.contains('pos-left'));
    document.body.classList.toggle('sidebar-open-right', !sidebar.classList.contains('closed') && sidebar.classList.contains('pos-right'));
}

export function toggleSidebarSide() {
    const isLeft = sidebar.classList.contains('pos-left');
    sidebar.classList.toggle('pos-left', !isLeft);
    sidebar.classList.toggle('pos-right', isLeft);
    updateViewerLayout();
}

function scrollToPage(pageNum) {
    const wrapper = document.getElementById(`page-wrapper-${pageNum}`);
    if (!wrapper || !viewport) return;

    document.getElementById('page-input').value = pageNum;
    viewport.scrollTo({ top: Math.max(0, wrapper.offsetTop - 42), behavior: 'smooth' });
}

function updateActiveThumbnail(pageNum) {
    document.querySelectorAll('.thumbnail-wrapper').forEach(wrapper => {
        wrapper.classList.toggle('active', Number(wrapper.dataset.pageNumber) === pageNum);
    });
}

function handleSidebarKeys(e) {
    if (!sidebar || sidebar.classList.contains('closed')) return;
    if (document.activeElement?.tagName === 'TEXTAREA' || document.activeElement?.tagName === 'INPUT') return;

    if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault();
        sidebar.classList.remove('pos-left');
        sidebar.classList.add('pos-right');
        updateViewerLayout();
    }
    if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        sidebar.classList.remove('pos-right');
        sidebar.classList.add('pos-left');
        updateViewerLayout();
    }
}

// ==========================================
// 5. índice (outline nativo do pdf)
// ==========================================
async function getOutlinePageNumber(item) {
    let destination = item.dest;
    if (typeof destination === 'string') destination = await state.pdfDoc.getDestination(destination);
    if (!Array.isArray(destination) || !destination[0]) return null;
    return (await state.pdfDoc.getPageIndex(destination[0])) + 1;
}

async function loadOutline() {
    if (!state.pdfDoc || viewOutline.innerHTML !== '') return;
    try {
        const outline = await state.pdfDoc.getOutline();
        if (!outline || outline.length === 0) {
            viewOutline.innerHTML = '<div class="outline-item italic">Nenhum índice disponível neste PDF.</div>';
            return;
        }

        const renderItems = (items, depth = 0, target = viewOutline) => {
            items.forEach(item => {
                const hasChildren = item.items && item.items.length > 0;
                const group = document.createElement('div');
                group.className = 'outline-group';

                const row = document.createElement('div');
                row.className = 'outline-item';
                row.style.paddingLeft = `${depth * 15 + 8}px`;

                if (hasChildren) {
                    const toggle = document.createElement('button');
                    toggle.className = 'outline-toggle';
                    toggle.type = 'button';
                    toggle.textContent = '-';
                    
                    const children = document.createElement('div');
                    children.className = 'outline-children';
                    toggle.onclick = event => {
                        event.stopPropagation();
                        const collapsed = children.classList.toggle('collapsed');
                        toggle.textContent = collapsed ? '+' : '-';
                    };
                    row.appendChild(toggle);
                    group.appendChild(row);

                    row.insertAdjacentText('beforeend', item.title);
                    renderItems(item.items, depth + 1, children);
                    group.appendChild(children);
                } else {
                    row.textContent = item.title;
                    group.appendChild(row);
                }

                row.title = item.title;
                row.onclick = async () => {
                    try {
                        const pageNum = await getOutlinePageNumber(item);
                        if (pageNum) scrollToPage(pageNum);
                    } catch (error) { console.error(error); }
                };

                target.appendChild(group);
            });
        };
        renderItems(outline, 0, viewOutline);
    } catch (e) {
        console.error("Erro ao carregar o Índice", e);
    }
}

// ==========================================
// 6. miniaturas (thumbnails) e drag & drop
// ==========================================
async function renderThumbnails() {
    if (!state.pdfDoc) return;
    thumbnailsRendered = true;
    thumbnailObserver?.disconnect();
    viewThumbnails.innerHTML = '';

    for (let i = 1; i <= state.pdfDoc.numPages; i++) {
        const thumbWrapper = document.createElement('div');
        thumbWrapper.className = 'thumbnail-wrapper';
        thumbWrapper.id = `thumb-${i}`;
        thumbWrapper.dataset.pageNumber = i;
        
        const canvas = document.createElement('canvas');
        const label = document.createElement('div');
        label.className = 'thumbnail-label';
        label.textContent = i;

        const actions = document.createElement('div');
        actions.className = 'thumbnail-actions show-right'; 
        
        const btnRotate = document.createElement('button');
        btnRotate.title = "Rodar Página";
        btnRotate.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.66-5.65"/></svg>`;
        btnRotate.onclick = (e) => { e.stopPropagation(); rotateSinglePage(i, 90); };

        const btnDelete = document.createElement('button');
        btnDelete.className = 'btn-thumb-delete';
        btnDelete.title = "Apagar Página";
        btnDelete.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
        btnDelete.onclick = (e) => {
            e.stopPropagation();
            if (state.pdfDoc.numPages <= 1) { alert("Não podes apagar a última página!"); return; }
            if (!confirm(`Tens a certeza que queres apagar a página ${i}?`)) return;

            const keyNotes = `${state.currentFilename}_pg${i}_notes`;
            chrome.storage.local.get([keyNotes], (result) => {
                let keepNotes = false;
                if (result[keyNotes] && result[keyNotes].length > 0) {
                    keepNotes = !confirm(`A página ${i} tem Notas (Post-its).\nQueres apagar as notas (OK) ou guardá-las e passá-las para a seguinte (Cancelar)?`);
                }
                deleteSinglePage(i, keepNotes);
            });
        };

        const btnPreview = document.createElement('button');
        btnPreview.title = "Abrir no modo Preview";
        btnPreview.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
        btnPreview.onclick = (e) => { e.stopPropagation(); window.showReferencePreview(i, `Pág. ${i}`); };

        thumbWrapper.draggable = true;
        thumbWrapper.ondragstart = (e) => { e.dataTransfer.setData('text/plain', i); thumbWrapper.style.opacity = '0.5'; };
        thumbWrapper.ondragend = () => { thumbWrapper.style.opacity = '1'; document.querySelectorAll('.thumbnail-wrapper').forEach(w => w.classList.remove('drag-over')); };
        thumbWrapper.ondragover = (e) => { e.preventDefault(); };
        thumbWrapper.ondragenter = (e) => { e.preventDefault(); thumbWrapper.classList.add('drag-over'); };
        thumbWrapper.ondragleave = (e) => { thumbWrapper.classList.remove('drag-over'); };
        thumbWrapper.ondrop = (e) => {
            e.preventDefault();
            thumbWrapper.classList.remove('drag-over');
            const fromPage = parseInt(e.dataTransfer.getData('text/plain'), 10);
            if (fromPage !== i && fromPage) reorderPDFPages(fromPage, i);
        };

        actions.appendChild(btnRotate);
        actions.appendChild(btnDelete);
        actions.appendChild(btnPreview);

        thumbWrapper.onmouseenter = () => {
            const rect = thumbWrapper.getBoundingClientRect();
            const sidebarRect = viewThumbnails.getBoundingClientRect();
            actions.classList.replace(rect.right > sidebarRect.right - 50 ? 'show-right' : 'show-left', rect.right > sidebarRect.right - 50 ? 'show-left' : 'show-right');
        };

        thumbWrapper.appendChild(canvas);
        thumbWrapper.appendChild(actions);
        thumbWrapper.appendChild(label);
        viewThumbnails.appendChild(thumbWrapper);

        thumbWrapper.onclick = () => {
            if (window.isShiftPressed && typeof window.showReferencePreview === 'function') {
                window.showReferencePreview(i, `Pág. ${i}`);
            } else {
                scrollToPage(i);
                document.querySelectorAll('.thumbnail-wrapper').forEach(w => w.classList.remove('active'));
                thumbWrapper.classList.add('active');
            }
        };
    }

    thumbnailObserver = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            if (!entry.isIntersecting || entry.target.dataset.rendered === 'true') return;
            renderThumbnail(entry.target);
        });
    }, { root: viewThumbnails.parentElement, rootMargin: '160px' });
    document.querySelectorAll('.thumbnail-wrapper').forEach(wrapper => thumbnailObserver.observe(wrapper));
    updateActiveThumbnail(Number(document.getElementById('page-input').value));
}

async function renderThumbnail(wrapper) {
    const pageNum = Number(wrapper.dataset.pageNumber);
    const canvas = wrapper.querySelector('canvas');
    const page = await state.pdfDoc.getPage(pageNum);
    const thumbnailViewport = page.getViewport({ scale: 0.3, rotation: (page.rotate || 0) + state.pageRotation });
    canvas.width = Math.ceil(thumbnailViewport.width);
    canvas.height = Math.ceil(thumbnailViewport.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: thumbnailViewport }).promise;
    wrapper.dataset.rendered = 'true';
}

// ==========================================
// 7. lista de figuras, tabelas e outros
// ==========================================
function setupFiguresToolbar() {
    const btnFiguresFilter = document.getElementById('btn-figures-filter');
    if (btnFiguresFilter) {
        btnFiguresFilter.onclick = () => {
            const filters = ['Tudo', 'Figura', 'Tabela', 'Equação', 'Outros'];
            const nextIdx = (filters.indexOf(currentFiguresFilter) + 1) % filters.length;
            currentFiguresFilter = filters[nextIdx];
            btnFiguresFilter.textContent = currentFiguresFilter;
            renderFiguresList(); 
        };
    }

    const btnFiguresSort = document.getElementById('btn-figures-sort');
    if (btnFiguresSort) {
        btnFiguresSort.onclick = () => {
            currentFiguresSort = currentFiguresSort === 'Agrupado' ? 'Texto' : 'Agrupado';
            btnFiguresSort.textContent = currentFiguresSort;
            renderFiguresList();
        };
    }

    const btnSearchToggle = document.getElementById('btn-figures-search-toggle');
    const searchContainer = document.getElementById('figures-search-container');
    const inputFiguresSearch = document.getElementById('figures-search');
    const toolbarWrapper = document.getElementById('figures-toolbar-wrapper');

    function evaluatePreventHide() {
        if (!toolbarWrapper) return;
        const hasText = inputFiguresSearch && inputFiguresSearch.value.trim() !== '';
        const isOpen = searchContainer && !searchContainer.classList.contains('hidden');
        if (hasText || isOpen) {
            toolbarWrapper.classList.add('prevent-hide');
        } else {
            toolbarWrapper.classList.remove('prevent-hide');
        }
    }

    if (btnSearchToggle && searchContainer) {
        btnSearchToggle.onclick = () => {
            const isHidden = searchContainer.classList.toggle('hidden');
            if (!isHidden) {
                inputFiguresSearch.focus();
            } else {
                if (currentFiguresSearch !== '') {
                    currentFiguresSearch = '';
                    inputFiguresSearch.value = '';
                    renderFiguresList();
                }
            }
            evaluatePreventHide();
        };
    }

    if (inputFiguresSearch) {
        inputFiguresSearch.oninput = (e) => {
            currentFiguresSearch = e.target.value;
            renderFiguresList(); 
            evaluatePreventHide();
        };
    }

    const sidebarContent = document.querySelector('.sidebar-content');
    
    if (sidebarContent && toolbarWrapper) {
        sidebarContent.addEventListener('scroll', () => {
            if (!document.getElementById('figures-view').classList.contains('hidden')) {
                if (sidebarContent.scrollTop > 20) {
                    toolbarWrapper.classList.add('is-scrolled');
                } else {
                    toolbarWrapper.classList.remove('is-scrolled');
                }
            }
        });
    }
}

async function loadFiguresList() {
    if (!state.pdfDoc || figuresLoaded) return;

    const listContainer = document.getElementById('figures-list');
    if (!listContainer) return;
    listContainer.innerHTML = '<div class="outline-item italic">A procurar elementos...</div>';

    try {
        globalFiguresData = [];

        const patterns = [
            {
                type: 'Figura',
                regex: /\b(?:Fig(?:ure|ura|s)?\.?|Image|Imagem|Diagram(?:a)?|Gr[áa]fico|Graph|Chart|Plot|Map|Mapa|Plate)\s*#?\s*\d+(?:[\.\-_]\d+)*[a-z]?\b/gi
            },
            {
                type: 'Tabela',
                regex: /\b(?:Tab(?:le|ela|s)?\.?|Quadro|Matrix|Matriz)\s*#?\s*\d+(?:[\.\-_]\d+)*[a-z]?\b/gi
            },
            {
                type: 'Equação',
                regex: /\b(?:Eq(?:uation|ua[çc][ãa]o|s)?\.?|Formula|F[óo]rmula|Reaction|Rea[çc][ãa]o)\s*#?\s*(?:\(?\d+(?:[\.\-_]\d+)*[a-z]?\)?)|\(\d+(?:[\.\-_]\d+)+[a-z]?\)/gi
            },
            {
                type: 'Outros',
                regex: /\b(?:Alg(?:orithm|oritmo)?\.?|Scheme|Esquema|Listing|Listagem|Code|C[óo]digo|Snippet|App(?:endix)?|Ap[êe]ndice|Annex|Anexo|Box|Caixa)\s*#?\s*\d+(?:[\.\-_]\d+)*[a-z]?\b/gi
            }
        ];

        const captionSeparatorRegex = /^\s*[:\.\-—–]\s+[A-ZÁÉÍÓÚÂÊÔÃÕ]/;

        const mentionPrefixRegex = /(?:ver|veja|vide|see|in|on|at|na|no|da|do|pela|pelo|from|of|\()\s*$/i;

        const mentionVerbContinuationRegex = /^\s+(?:mostra|indica|apresenta|ilustra|demonstra|shows|presents|indicates|illustrates|depicts|is|are|foi|foram)\b/i;

        for (let i = 1; i <= state.pdfDoc.numPages; i++) {
            const page = await state.pdfDoc.getPage(i);
            const textContent = await page.getTextContent();
            
            // Junta o texto mantendo o espaçamento
            const pageText = textContent.items.map(item => item.str).join(' ');

            for (const { type, regex } of patterns) {
                regex.lastIndex = 0;
                let match;

                while ((match = regex.exec(pageText)) !== null) {
                    const matchStart = match.index;
                    const matchEnd = match.index + match[0].length;

                    const prefix = pageText.substring(Math.max(0, matchStart - 35), matchStart);
                    const suffix = pageText.substring(matchEnd, Math.min(pageText.length, matchEnd + 90));

                    const hasCaptionSeparator = captionSeparatorRegex.test(suffix);
                    const hasMentionPrefix = mentionPrefixRegex.test(prefix);
                    const hasVerbContinuation = mentionVerbContinuationRegex.test(suffix);
                    const isInsideParentheses = prefix.trim().endsWith('(') || suffix.trim().startsWith(')');

                    let isCaption = false;

                    if (type === 'Equação') {
                        isCaption = !isInsideParentheses && !hasMentionPrefix;
                    } else {

                        if (hasCaptionSeparator && !hasMentionPrefix && !isInsideParentheses) {
                            isCaption = true;
                        } else if (!hasMentionPrefix && !hasVerbContinuation && !isInsideParentheses) {
                            isCaption = /^\s+[A-ZÁÉÍÓÚÂÊÔÃÕ]/.test(suffix);
                        }
                    }

                    const isMention = !isCaption;

                    let context = pageText.substring(matchStart, matchEnd + 80).trim();
                    context = context.replace(/\s+/g, ' ');
                     let accumulatedLength = 0;
                    let destY = null;
                    
                    for (const item of textContent.items) {
                        const len = item.str.length + 1;
                        if (accumulatedLength + len > matchStart) {
                            destY = item.transform[5];
                            break;
                        }
                        accumulatedLength += len;
                    }

                    globalFiguresData.push({
                        pageNum: i,
                        type: type,
                        isMention: isMention,
                        isCaption: isCaption,
                        matchText: match[0],
                        fullText: context,
                        destY: destY
                    });
                }
            }
        }

        figuresLoaded = true;
        renderFiguresList();

    } catch (e) {
        console.error("Erro ao procurar figuras:", e);
        listContainer.innerHTML = '<div class="outline-item italic">Erro ao analisar documento.</div>';
    }
}

function renderFiguresList() {
    const listContainer = document.getElementById('figures-list');
    if (!listContainer) return;
    listContainer.innerHTML = '';

    const filteredData = globalFiguresData.filter(fig => {
        const matchType = currentFiguresFilter === 'Tudo' || fig.type === currentFiguresFilter;
        const searchLower = currentFiguresSearch.toLowerCase();
        const matchSearch = searchLower === '' || fig.fullText.toLowerCase().includes(searchLower);
        return matchType && matchSearch;
    });

    if (globalFiguresData.length === 0) {
        listContainer.innerHTML = '<div class="outline-item italic">Nenhuma Figura, Tabela ou Elemento detetado.</div>';
        return;
    }

    if (filteredData.length === 0) {
        listContainer.innerHTML = '<div class="outline-item italic">Nenhum resultado para esta pesquisa.</div>';
        return;
    }

    const createRow = (fig) => {
        const row = document.createElement('div');
        row.className = 'outline-item';
        row.style.whiteSpace = 'normal'; 
        row.style.lineHeight = '1.4';
        row.style.marginBottom = '6px';
        row.style.borderBottom = '1px solid #333';
        row.style.paddingBottom = '6px';

        let typeColor = '#d68910';
        if (fig.type === 'Tabela') typeColor = '#8be28b';
        else if (fig.type === 'Figura') typeColor = '#0376db';
        else if (fig.type === 'Equação') typeColor = '#c678dd';

        if (fig.isMention) {
            row.innerHTML = `<strong style="color:${typeColor}; opacity: 0.6;">[Citação: ${fig.type}] Pág. ${fig.pageNum}</strong><br><span style="color:#999;">...${fig.fullText}...</span>`;
        } else {
            row.innerHTML = `<strong style="color:${typeColor};">[${fig.type}] Pág. ${fig.pageNum}</strong><br><span style="color:#ddd;">${fig.fullText}...</span>`;
        }
        
        row.title = "Clica para ir à localização. Shift+Click para Preview.";
        row.onclick = async () => {
            // Se for SHIFT+Click -> Abre na Janela Gigante (com a nova coordenada Y!)
            if (window.isShiftPressed && typeof window.showReferencePreview === 'function') {
                window.showReferencePreview(fig.pageNum, fig.matchText, fig.destY);
            } else {
                // Se for Clique Normal -> Vai lá ter! 
                const wrapper = document.getElementById(`page-wrapper-${fig.pageNum}`);
                if (!wrapper) return;
                
                document.getElementById('page-input').value = fig.pageNum;
                const viewport = document.getElementById('viewport');
                let targetScrollTop = wrapper.offsetTop - 42; 

                // Se conseguimos capturar o Y, calculamos o centro do ecrã!
                if (fig.destY !== null) {
                    const page = await state.pdfDoc.getPage(fig.pageNum);
                    const vp = page.getViewport({ scale: state.currentScale, rotation: (page.rotate || 0) + state.pageRotation });
                    
                    const pdfToHtmlY = vp.height - (fig.destY * state.currentScale);
                    const centerOffset = viewport.clientHeight / 2;
                    targetScrollTop = wrapper.offsetTop + pdfToHtmlY - centerOffset;
                }

                viewport.scrollTo({ top: Math.max(0, targetScrollTop), behavior: 'smooth' });
            }
        };
        return row;
    };

    if (currentFiguresSort === 'Agrupado') {
        const captions = filteredData.filter(f => !f.isMention);
        const mentions = filteredData.filter(f => f.isMention);

        if (captions.length > 0) {
            const sep1 = document.createElement('div');
            sep1.innerHTML = `<strong style="color:#fff; font-size:14px; display:block; padding: 5px 0;">Legendas Detetadas</strong>`;
            listContainer.appendChild(sep1);
            captions.forEach(fig => listContainer.appendChild(createRow(fig)));
        }
        if (mentions.length > 0) {
            const sep2 = document.createElement('div');
            sep2.innerHTML = `<strong style="color:#888; font-size:12px; display:block; padding: 15px 0 5px 0;">Menções no Texto</strong>`;
            listContainer.appendChild(sep2);
            mentions.forEach(fig => listContainer.appendChild(createRow(fig)));
        }

    } else {
        const sep = document.createElement('div');
        sep.innerHTML = `<strong style="color:#fff; font-size:14px; display:block; padding: 5px 0;">Ordem de Leitura</strong>`;
        listContainer.appendChild(sep);

        filteredData.forEach(fig => listContainer.appendChild(createRow(fig)));
    }
}

initSidebar();