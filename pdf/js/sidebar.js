import { state } from './state.js';
import { reorderPDFPages, deleteSinglePage, rotateSinglePage } from './pdf_editor.js';
import { jumpTo } from './utils.js'
import { askUserInput, showNotification } from './ui.js';
import { addCustomElementToDB, forceDBUpdate, updateBookmarksSidebar } from './bookmarks.js';

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
const tabRefs = document.getElementById('tab-refs');
const viewRefs = document.getElementById('refs-view');
const viewport = document.getElementById('viewport');
const tabBookmarks = document.getElementById('tab-bookmarks');
const viewBookmarks = document.getElementById('bookmarks-view');

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
let biblioLoaded = false;

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

    if (tabRefs) {
        tabRefs.onclick = () => {
            switchTab(tabRefs, viewRefs);
            loadBibliography();
        };
    }
    if (tabBookmarks) {
        tabBookmarks.onclick = () => {
            switchTab(tabBookmarks, viewBookmarks);
            updateBookmarksSidebar();
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

    window.addEventListener('custom-figures-updated', () => {
        if (!viewFigures.classList.contains('hidden')) renderFiguresList();
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
    [tabOutline, tabThumbnails, tabFigures, tabRefs, tabBookmarks].forEach(t => { if(t) t.classList.remove('active'); });
    [viewOutline, viewThumbnails, viewFigures, viewRefs, viewBookmarks].forEach(v => { if(v) v.classList.add('hidden'); });
    
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
                const toggleWrapper = document.createElement('div');
                toggleWrapper.className = 'outline-toggle-wrapper';

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
                    
                    toggleWrapper.appendChild(toggle);
                    row.appendChild(toggleWrapper);
                    row.insertAdjacentText('beforeend', item.title);
                    
                    group.appendChild(row);
                    renderItems(item.items, depth + 1, children);
                    group.appendChild(children);
                } 
                else {
                    row.appendChild(toggleWrapper);
                    row.insertAdjacentText('beforeend', item.title);
                    group.appendChild(row);
                }

                row.title = item.title;
                row.onclick = async () => {
                    try {
                        const pageNum = await getOutlinePageNumber(item);
                        if (pageNum) {
                            if (window.isShiftPressed && typeof window.showReferencePreview === 'function') {
                                window.showReferencePreview(pageNum, item.title, null); 
                            } else {
                                jumpTo(pageNum, { align: 'top' });
                            }
                        }
                    } catch (error) {
                        console.error(error);
                        showNotification(`Não foi possível abrir o destino do índice: ${error.message || error}`, 'error');
                    }
                };

                target.appendChild(group);
            });
        };
        renderItems(outline, 0, viewOutline);
        renderItems(outline, 0, viewOutline);
    } catch (e) {
        console.error("Erro ao carregar o Índice", e);
        showNotification(`Erro ao carregar o índice: ${e.message || e}`, 'error');
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
                jumpTo(i, { align: 'top' });
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
    const btnFiguresAdd = document.getElementById('btn-figures-add');

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

    if (btnFiguresAdd) {
        btnFiguresAdd.onclick = async () => {
            const selection = window.getSelection();
            if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
                alert("Por favor, seleciona o texto no PDF primeiro.");
                return;
            }
            const range = selection.getRangeAt(0);
            const wrapper = range.startContainer.parentElement?.closest('.page-wrapper');
            if (!wrapper) return;

            const pageNum = parseInt(wrapper.dataset.pageNumber, 10);
            const rect = range.getClientRects()[0];
            const wrapperRect = wrapper.getBoundingClientRect();
            
            const targetY = (((rect.top - wrapperRect.top) / wrapperRect.height) * 100) - 2;
            const defaultText = selection.toString().trim().substring(0, 80);

            const res = await askUserInput("Adicionar Elemento", defaultText, true);
            if (res && res.text !== "") {
                addCustomElementToDB(pageNum, targetY, res.text, res.type);
                window.getSelection().removeAllRanges();
            }
        };
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
    listContainer.innerHTML = '<div class="outline-item italic">A procurar elementos e hiperligações...</div>';

    try {
        globalFiguresData = [];

        // Dicionário de padrões. Captura a "Etiqueta" principal.
        const patterns = [
            { type: 'Figura', regex: /\b(?:Fig(?:ure|ura|s)?\.?|Image|Imagem|Diagram(?:a)?|Gr[áa]fico|Graph|Chart|Plot|Map|Mapa|Plate)\s*#?\s*\d+(?:[\.\-_]\d+)*[a-z]?\b/gi },
            { type: 'Tabela', regex: /\b(?:Tab(?:le|ela|s)?\.?|Quadro|Matrix|Matriz)\s*#?\s*\d+(?:[\.\-_]\d+)*[a-z]?\b/gi },
            { type: 'Equação', regex: /\b(?:Eq(?:uation|ua[çc][ãa]o|s)?\.?|Formula|F[óo]rmula|Reaction|Rea[çc][ãa]o)\s*#?\s*(?:\(?\d+(?:[\.\-_]\d+)*[a-z]?\)?)|\(\d+(?:[\.\-_]\d+)+[a-z]?\)/gi },
            { type: 'Outros', regex: /\b(?:Alg(?:orithm|oritmo)?\.?|Scheme|Esquema|Listing|Listagem|Code|C[óo]digo|Snippet|App(?:endix)?|Ap[êe]ndice|Annex|Anexo|Box|Caixa)\s*#?\s*\d+(?:[\.\-_]\d+)*[a-z]?\b/gi }
        ];

        // Regex para detetar se uma palavra é a "Legenda Oficial"
        const captionSeparatorRegex = /^\s*[:\.\-—–]\s+[A-ZÁÉÍÓÚÂÊÔÃÕ]/;
        const mentionPrefixRegex = /(?:ver|veja|vide|see|in|on|at|na|no|da|do|pela|pelo|from|of|\()\s*$/i;
        const mentionVerbContinuationRegex = /^\s+(?:mostra|indica|apresenta|ilustra|demonstra|shows|presents|indicates|illustrates|depicts|is|are|foi|foram)\b/i;

        for (let i = 1; i <= state.pdfDoc.numPages; i++) {
            const page = await state.pdfDoc.getPage(i);
            const textContent = await page.getTextContent();
            
            // 1. Em vez de colar o texto todo com " ", mantemos os \n nativos do PDF
            // para sabermos onde acaba um parágrafo.
            let fullText = "";
            let textMapping = []; 
            
            for (let item of textContent.items) {
                if (item.str.trim() === '') {
                    fullText += ' '; continue;
                }
                textMapping.push({
                    index: fullText.length,
                    x: item.transform[4],
                    y: item.transform[5],
                    w: item.width || 40
                });
                fullText += item.str;
                // Se a caixa do PDF acabar muito antes da margem, mete uma quebra de linha visual
                if (item.hasEOL) fullText += '\n'; else fullText += ' ';
            }

            for (const { type, regex } of patterns) {
                let match;
                regex.lastIndex = 0;

                while ((match = regex.exec(fullText)) !== null) {
                    const matchStart = match.index;
                    const matchEnd = match.index + match[0].length;

                    const prefix = fullText.substring(Math.max(0, matchStart - 40), matchStart);
                    const suffix = fullText.substring(matchEnd, Math.min(fullText.length, matchEnd + 100));

                    const hasCaptionSeparator = captionSeparatorRegex.test(suffix);
                    const hasMentionPrefix = mentionPrefixRegex.test(prefix);
                    const hasVerbContinuation = mentionVerbContinuationRegex.test(suffix);
                    const isInsideParentheses = prefix.trim().endsWith('(') || suffix.trim().startsWith(')');

                    let isCaption = false;
                    
                    // Equações são manhosas: se estão fora de parênteses e no fim da frase (sem texto a dizer "ver"), é a equação em si.
                    if (type === 'Equação') {
                        // Confere se está alinhado à direita num parágrafo curto
                        const paragraph = fullText.substring(Math.max(0, matchStart - 100), Math.min(fullText.length, matchEnd + 20));
                        const isShortLine = !paragraph.includes('\n') || paragraph.split('\n').pop().length < 80;
                        isCaption = isShortLine && !isInsideParentheses && !hasMentionPrefix;
                    } else {
                        // Regra de Ouro para Legendas:
                        // Se tem dois pontos (Fig 1: Texto) ou se não tem o prefixo "ver"
                        if (hasCaptionSeparator && !hasMentionPrefix && !isInsideParentheses) {
                            isCaption = true;
                        } else if (!hasMentionPrefix && !hasVerbContinuation && !isInsideParentheses) {
                            // Se a frase não diz "mostra", mas começa em Maiúscula
                            isCaption = /^\s+[A-ZÁÉÍÓÚÂÊÔÃÕ]/.test(suffix);
                        }
                    }

                    // Se estiver no início exato de uma quebra de linha (nativa do PDF), a probabilidade de ser legenda é 99%
                    if (prefix.trim() === '' || prefix.endsWith('\n')) isCaption = true;

                    // Captura o Contexto exato, respeitando as quebras de linha!
                    // Extraímos até encontrar uma quebra de linha natural
                    const blockEndIndex = fullText.indexOf('\n', matchStart);
                    const safeEnd = blockEndIndex !== -1 ? Math.min(blockEndIndex, matchEnd + 120) : matchEnd + 120;
                    
                    let context = fullText.substring(matchStart, safeEnd).trim();
                    context = context.replace(/\s+/g, ' '); // Limpa espaços duplos
                    
                    if (context.length > 150) context = context.substring(0, 150) + "...";

                    // Mapeia a Coordenada Física Exata!
                    const mapItem = textMapping.slice().reverse().find(m => m.index <= matchStart) || textMapping[0];
                    let destY = mapItem ? mapItem.y : null;
                    let destX = mapItem ? mapItem.x : null;
                    let destW = mapItem ? mapItem.w : 40;

                    globalFiguresData.push({
                        pageNum: i,
                        type: type,
                        isMention: !isCaption,
                        isCaption: isCaption,
                        matchText: match[0],
                        fullText: context,
                        destY: destY,
                        destX: destX,
                        destW: destW
                    });
                }
            }
        }

        figuresLoaded = true;
        renderFiguresList();

    } catch (e) {
        console.error("Erro ao analisar documento:", e);
        showNotification(`Erro ao analisar o documento: ${e.message || e}`, 'error');
        listContainer.innerHTML = '<div class="outline-item italic">Erro fatal ao analisar documento.</div>';
    }
}

async function renderFiguresList() {
    const listContainer = document.getElementById('figures-list');
    if (!listContainer) return;
    listContainer.innerHTML = '';

    // 1. CARREGAR FIGURAS MANUAIS DA BASE DE DADOS
    const items = await new Promise(resolve => chrome.storage.local.get(null, resolve));
    const prefix = `${state.currentFilename}_pg`;
    const manualFigures = [];

    Object.keys(items).forEach(key => {
        if (key.startsWith(prefix) && key.endsWith('_bookmarks')) {
            const pageNum = parseInt(key.replace(prefix, '').replace('_bookmarks', ''), 10);
            items[key].forEach(bmk => {
                if (bmk.type && bmk.type !== 'bookmark') {
                    manualFigures.push({
                        pageNum: pageNum,
                        type: bmk.type,
                        isMention: false,
                        isCaption: true,
                        isManual: true,
                        originalY: bmk.y,
                        matchText: '',
                        fullText: bmk.title,
                        destY: null,
                        htmlY: bmk.y
                    });
                }
            });
        }
    });

    // FUNDIR OS DOIS ARRAYS
    const combinedData = [...globalFiguresData, ...manualFigures];

    const filteredData = combinedData.filter(fig => {
        const matchType = currentFiguresFilter === 'Tudo' || fig.type === currentFiguresFilter;
        const searchLower = currentFiguresSearch.toLowerCase();
        const matchSearch = searchLower === '' || fig.fullText.toLowerCase().includes(searchLower);
        return matchType && matchSearch;
    });

    if (combinedData.length === 0) {
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
        
        row.style.display = 'flex';
        row.style.gap = '10px';
        row.style.alignItems = 'flex-start';
        row.style.marginBottom = '6px';
        row.style.borderBottom = '1px solid #333';
        row.style.paddingBottom = '6px';
        row.style.position = 'relative';

        let typeColor = '#d68910';
        if (fig.type === 'Tabela') typeColor = '#8be28b';
        else if (fig.type === 'Figura') typeColor = '#0376db';
        else if (fig.type === 'Equação') typeColor = '#c678dd';

        const leftCol = `<div style="flex: 0 0 65px; display: flex; flex-direction: column; gap: 2px;">
            <strong style="color:${typeColor}; font-size:11px; opacity:${fig.isMention ? '0.6' : '1'};">[${fig.type}]</strong>
            <span style="color:${typeColor}; font-size:10px; opacity: 0.8;">Pág. ${fig.pageNum}</span>
        </div>`;

        const rightCol = `<div style="flex: 1; color:${fig.isMention ? '#999' : '#ddd'}; font-size: 12px; line-height: 1.3; overflow-wrap: anywhere;">
            ${fig.isMention ? 'Citação: ' : ''}${fig.fullText}
        </div>`;

        row.innerHTML = leftCol + rightCol;
        row.title = "Clica para ir à localização. Shift+Click para Preview.";

        if (fig.isManual) {
            const delBtn = document.createElement('button');
            delBtn.innerHTML = `×`;
            delBtn.style.cssText = "position:absolute; top:2px; right:2px; background:transparent; border:none; color:#e51400; cursor:pointer; font-weight:bold; font-size:16px;";
            delBtn.title = "Remover Extração Manual";
            delBtn.onclick = (e) => {
                e.stopPropagation();
                if(confirm("Apagar extração manual?")) forceDBUpdate(fig.pageNum, fig.originalY, null, true);
            };
            row.appendChild(delBtn);
        }

        row.onclick = async () => {
            if (window.isShiftPressed && typeof window.showReferencePreview === 'function') {
                window.showReferencePreview(fig.pageNum, fig.matchText, fig.destY);
            } else {
                jumpTo(fig.pageNum, {
                    pdfY: fig.destY,
                    htmlY: fig.htmlY,
                    align: 'center', 
                    flashX: fig.destX, 
                    flashW: fig.destW
                });
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

async function loadBibliography() {
    if (!state.pdfDoc || biblioLoaded) return;
    const listContainer = document.getElementById('refs-list');
    if (!listContainer) return;
    listContainer.innerHTML = '<div class="outline-item italic">A processar Referências e Coordenadas...</div>';

    try {
        const lastPages = Math.min(20, state.pdfDoc.numPages); // Analisa apenas as últimas 20 págs
        let fullText = "";
        let textMapping = []; 

        // 1. Extrair texto e mapear coordenadas
        for (let i = state.pdfDoc.numPages - lastPages + 1; i <= state.pdfDoc.numPages; i++) {
            const page = await state.pdfDoc.getPage(i);
            const textContent = await page.getTextContent();
            
            for (let item of textContent.items) {
                if (item.str.trim() === '') {
                    fullText += ' '; continue;
                }
                textMapping.push({
                    index: fullText.length,
                    pageNum: i,
                    x: item.transform[4],
                    y: item.transform[5],
                    w: item.width || 50
                });
                fullText += item.str + ' ';
            }
            fullText += '\n\n'; // Força parágrafo entre páginas
        }

        // 2. Procurar TODAS as listas sequenciais no texto!
        const potentialRefRegex = /(?:\[(\d+)\]|\b(\d+)\.\s)/g;
        let match;
        let sequences = [];
        let currentSequence = [];
        let expectedNum = 1;
        let refStyle = null; // 1 para [1], 2 para 1.

        while ((match = potentialRefRegex.exec(fullText)) !== null) {
            const num = parseInt(match[1] || match[2], 10);
            const isBracket = match[1] !== undefined;
            const currentStyle = isBracket ? 1 : 2;

            // Encontrou um 1? Inicia uma nova sequência candidata
            if (num === 1) {
                if (currentSequence.length > 0) sequences.push(currentSequence);
                currentSequence = [{
                    num: num, style: currentStyle, index: match.index, length: match[0].length,
                    map: textMapping.slice().reverse().find(m => m.index <= match.index) || textMapping[0]
                }];
                expectedNum = 2;
                refStyle = currentStyle;
                continue;
            }

            // A continuação de uma sequência em andamento
            if (currentSequence.length > 0) {
                if (currentStyle !== refStyle) continue;
                
                if (num >= expectedNum && num <= expectedNum + 2) {
                    currentSequence.push({
                        num: num, style: currentStyle, index: match.index, length: match[0].length,
                        map: textMapping.slice().reverse().find(m => m.index <= match.index) || textMapping[0]
                    });
                    expectedNum = num + 1;
                }
            }
        }
        if (currentSequence.length > 0) sequences.push(currentSequence);

        // 3. A Bibliografia Real é assumida como sendo a sequência mais longa
        sequences.sort((a, b) => b.length - a.length);
        const bestSequence = sequences[0];

        // Se a sequência mais longa tiver menos de 3 itens, não é uma bibliografia
        if (!bestSequence || bestSequence.length < 3) {
            listContainer.innerHTML = '<div class="outline-item italic">Nenhuma bibliografia reconhecível detetada.</div>';
            return;
        }

        // 4. Extrair o texto entre os marcadores da sequência
        const refs = [];
        for (let i = 0; i < bestSequence.length; i++) {
            const current = bestSequence[i];
            const next = bestSequence[i + 1];

            const startExtract = current.index + current.length;
            const endExtract = next ? next.index : fullText.length;

            let content = fullText.substring(startExtract, endExtract).trim();

            // Proteção especial para a ÚLTIMA referência (para não engolir os Anexos/Supplementary Notes)
            if (!next) {
                const stopRegex = /\n\s*\n|\b(?:Acknowledgments|Appendix|Supplementary|Author contributions|Data availability)\b/i;
                const stopMatch = stopRegex.exec(content);
                if (stopMatch) {
                    content = content.substring(0, stopMatch.index).trim();
                }
                if (content.length > 500) content = content.substring(0, 500) + '...'; // Limite de segurança
            }

            content = content.replace(/-\s*\n\s*/g, '').replace(/\s+/g, ' '); // Limpa formatação partida
            if (content.length > 0) {
                refs.push({ num: current.num, style: current.style, text: content, map: current.map });
            }
        }

        // 5. Renderizar na Sidebar
        listContainer.innerHTML = '';
        refs.forEach(ref => {
            const row = document.createElement('div');
            row.className = 'outline-item';
            row.style.whiteSpace = 'normal'; 
            row.style.lineHeight = '1.4';
            row.style.marginBottom = '8px';
            row.style.borderBottom = '1px solid #333';
            row.style.paddingBottom = '8px';
            row.title = "Clica para ir à localização. Shift+Click para Preview.";

            row.innerHTML = `<strong style="color:#0376db;">${ref.style === 1 ? '['+ref.num+']' : ref.num+'.'}</strong> <span style="color:#ddd; font-size: 12px;">${ref.text}</span>`;
            
            row.onclick = async () => {
                if (!ref.map) return;
                
                if (window.isShiftPressed && typeof window.showReferencePreview === 'function') {
                    window.showReferencePreview(ref.map.pageNum, `Ref. ${ref.style === 1 ? '['+ref.num+']' : ref.num+'.'}`, ref.map.y);
                } else {
                    jumpTo(ref.map.pageNum, { pdfY: ref.map.y, align: 'center', flashX: ref.map.x, flashW: ref.map.w * 3});
                }
            };
            
            listContainer.appendChild(row);
        });

        biblioLoaded = true;

    } catch (e) {
        console.error("Erro na Bibliografia:", e);
        showNotification(`Erro ao carregar a bibliografia: ${e.message || e}`, 'error');
        listContainer.innerHTML = '<div class="outline-item italic">Erro ao processar documento.</div>';
    }
}



initSidebar();