import * as pdfjsLib from '../lib/pdf_js/build/pdf.mjs';
import { state } from './state.js';
import { loadAnnotationsForPage } from './annotations.js';
import { loadNotesForPage } from './notes.js';
import { saveState } from './storage.js';
import { activate as activateHistory } from './history.js';
import { initDrawingLayer, resizeDrawingCanvas, loadDrawingsForPage } from './drawing.js';
import { TextLayerBuilder } from './text-layer-builder.js';
import { deleteSinglePage, rotateSinglePage } from './pdf_editor.js';
import { loadTextBoxesForPage } from './textboxes.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = './lib/pdf_js/build/pdf.worker.mjs';

const container = document.getElementById('pages-container');
const viewport = document.getElementById('viewport');
const pageInput = document.getElementById('page-input');
let zoomRequestId = 0;
let pageObserver = null;
let lastStoredPage = null;
const pageCache = new Map();

const linkService = {
    getDestinationHash: dest => dest,
    goToDestination: async dest => {
        if (!state.pdfDoc) return;
        
        let destination = dest;
        if (typeof destination === 'string') {
            destination = await state.pdfDoc.getDestination(destination);
        }
        
        if (Array.isArray(destination) && destination[0]) {
            try {
                const pageIndex = await state.pdfDoc.getPageIndex(destination[0]);
                const targetPage = pageIndex + 1; 

                let destY = null, destX = null;
                const command = destination[1]?.name;
                
                if (command === 'XYZ' || command === 'FitR') {
                    if (typeof destination[2] === 'number') destX = destination[2];
                    if (typeof destination[3] === 'number') destY = destination[3];
                } else if (command === 'FitH' || command === 'FitV' || command === 'FitBH' || command === 'FitBV') {
                    if (typeof destination[2] === 'number') destY = destination[2];
                } else {
                    for (let i = 2; i < destination.length; i++) {
                        if (typeof destination[i] === 'number') {
                            destY = destination[i]; break;
                        }
                    }
                }

                if (window.isShiftPressed) {
                    showReferencePreview(targetPage, window.lastClickedLinkText, destY);
                    return;
                }

                const wrapper = document.getElementById(`page-wrapper-${targetPage}`);
                if (wrapper) {
                    const viewport = document.getElementById('viewport');
                    document.getElementById('page-input').value = targetPage;
                    
                    let targetScrollTop = wrapper.offsetTop - 42;
                    
                    if (destY !== null) {
                        const page = await state.pdfDoc.getPage(targetPage);
                        const vp = page.getViewport({ scale: state.currentScale, rotation: (page.rotate || 0) + state.pageRotation });
                        
                        const pdfToHtmlY = vp.height - (destY * state.currentScale);
                        const centerOffset = viewport.clientHeight / 2;
                        targetScrollTop = wrapper.offsetTop + pdfToHtmlY - centerOffset;
                    }

                    viewport.scrollTo({ top: Math.max(0, targetScrollTop), behavior: 'smooth' }); 
                    setTimeout(() => {
                        if (typeof window.flashHighlight === 'function') {
                            window.flashHighlight(targetPage, destX, destY, null, true);
                        }
                    }, 100);
                }
            } catch (e) {
                console.warn("Erro ao navegar para o link interno:", e);
            }
        }
    },
    navigateTo: dest => console.log('Navegar para:', dest),
    getAnchorUrl: url => url || '',
    setDocument: () => {},
    executeNamedAction: action => console.log('Ação:', action),
    addLinkAttributes: (link, url) => {
        link.href = url;
        link.target = url ? '_blank' : '';
        link.rel = 'noopener noreferrer nofollow';
    }
};

function getPage(pageNum) {
    if (!pageCache.has(pageNum)) pageCache.set(pageNum, state.pdfDoc.getPage(pageNum));
    return pageCache.get(pageNum);
}

export async function loadPDF(source, filename) {
    Object.values(state.renderTasks).forEach(task => task?.cancel());
    Object.values(state.textLayerTasks).forEach(task => task?.cancel());
    pageObserver?.disconnect();
    pageCache.clear();
    state.renderTasks = {};
    state.renderingStates = {};
    state.textLayerTasks = {};
    state.pageRotation = 0;
    state.drawings = {};
    state.annotationLoadVersions = {};
    state.pendingAnnotationRemovals = new Map();
    lastStoredPage = null;

    activateHistory(filename);
    document.title = filename || 'UniPDF Pro';
    const documentSource = typeof source === 'string' ? { url: source } : { data: source };
    const loadingTask = pdfjsLib.getDocument({
        ...documentSource,
        cMapUrl: './lib/pdf_js/web/cmaps/',
        cMapPacked: true,
        standardFontDataUrl: './lib/pdf_js/web/standard_fonts/',
        wasmUrl: './lib/pdf_js/web/wasm/'
    });
    state.pdfDoc = await loadingTask.promise;
    
    const totalPages = state.pdfDoc.numPages;
    document.getElementById('page-count').textContent = totalPages;
    container.innerHTML = '';

    // 1. Descobrir a geometria EXATA de todas as páginas super rápido (sem as pintar!)
    const pagePromises = [];
    for (let i = 1; i <= totalPages; i++) {
        pagePromises.push(getPage(i));
    }
    const pages = await Promise.all(pagePromises);
    pages.forEach((page, index) => pageCache.set(index + 1, page));
    window.dispatchEvent(new CustomEvent('pdf-document-loaded'));

    // 2. Criar as caixas com as medidas reais de cada uma
    pages.forEach((page, index) => {
        const pageNum = index + 1;
        const vp = page.getViewport({ scale: state.currentScale, rotation: (page.rotate || 0) + state.pageRotation });

        const wrapper = document.createElement('div');
        wrapper.className = 'page-wrapper';
        wrapper.id = `page-wrapper-${pageNum}`;
        wrapper.dataset.pageNumber = pageNum;
        
        // Cada página tem a sua medida certa (slides, A4, etc)
        wrapper.style.width = `${Math.floor(vp.width)}px`;
        wrapper.style.height = `${Math.floor(vp.height)}px`;
        
        wrapper.innerHTML = `
            <div class="page-actions-overlay">
                <div class="page-actions-buttons">
                    <button class="btn-page-preview" title="Abrir no modo Preview">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    </button>
                    <button class="btn-page-copy" title="Copiar texto desta página">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                    </button>
                    <button class="btn-page-rotate" title="Rodar 90º">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.66-5.65"/></svg>
                    </button>
                    <button class="btn-page-delete" title="Apagar Página">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                </div>
            </div>
            <canvas></canvas>
            <canvas class="drawing-canvas"></canvas>
            <div class="pdf-links-layer"></div>
            <div class="annotation-layer"></div>
            <div class="textboxes-overlay"></div>
            <div class="textLayer"></div>
            <div class="notes-overlay"></div>
        `;
        container.appendChild(wrapper);
        initDrawingLayer(wrapper, pageNum);

        // LÓGICA DO BOTÃO COPIAR
        wrapper.querySelector('.btn-page-copy').onclick = () => {
            const textLayer = wrapper.querySelector('.textLayer');
            if (textLayer) {
                let text = '';
                textLayer.querySelectorAll('span').forEach(span => { text += span.textContent + ' '; });
                navigator.clipboard.writeText(text.trim());
                
                // Pisca a verde
                const btn = wrapper.querySelector('.btn-page-copy');
                const origHTML = btn.innerHTML;
                btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="#8be28b" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`;
                setTimeout(() => btn.innerHTML = origHTML, 2000);
            }
        };


        wrapper.querySelector('.btn-page-rotate').onclick = () => {
             rotateSinglePage(pageNum, 90); 
        };
        wrapper.querySelector('.btn-page-delete').onclick = () => {
            if (state.pdfDoc.numPages <= 1) {
                alert("Não podes apagar a última página do documento!");
                return;
            }

            // Confirmação primária de segurança
            if (!confirm(`Tens a certeza que queres apagar a página ${pageNum}?`)) return;

            // Só verifica as Notas (Post-its)
            const keyNotes = `${state.currentFilename}_pg${pageNum}_notes`;
            chrome.storage.local.get([keyNotes], (result) => {
                let keepNotes = false;

                if (result[keyNotes] && result[keyNotes].length > 0) {
                    const ans = confirm(`A página ${pageNum} tem Notas (Post-its).\nQueres apagar as notas (OK) ou guardá-las e passá-las para a página seguinte (Cancelar)?`);
                    keepNotes = !ans; // Se cancelou a destruição, mantém!
                }

                deleteSinglePage(pageNum, keepNotes);
            });
        };
    });

    setupObserver();
}


export async function renderPage(pageNum) {
    const wrapper = document.getElementById(`page-wrapper-${pageNum}`);
    if (!wrapper || state.renderingStates[pageNum]) return;
    if (wrapper.dataset.rendered === 'true' && Number(wrapper.dataset.scale) === state.currentScale) {
        loadNotesForPage(pageNum);
        loadAnnotationsForPage(pageNum);
        loadTextBoxesForPage(pageNum)
        return;
    }
    state.renderingStates[pageNum] = true;
    const dpr = window.devicePixelRatio || 1;
    try {
        const page = await getPage(pageNum);
        const pageViewport = page.getViewport({ scale: state.currentScale, rotation: (page.rotate || 0) + state.pageRotation });
        const canvas = wrapper.querySelector('canvas:not(.drawing-canvas)');
        const context = canvas.getContext('2d', { alpha: false });
        const textLayerDiv = wrapper.querySelector('.textLayer');
        const textLayer = new TextLayerBuilder({ pdfPage: page });
        textLayer.div = textLayerDiv;
        textLayerDiv.style.setProperty('--total-scale-factor', state.currentScale);
        textLayerDiv.style.setProperty('--min-font-size', '1');
        textLayerDiv.style.setProperty('--min-font-size-inv', '1');
        const linksLayerDiv = wrapper.querySelector('.pdf-links-layer');

        canvas.width = Math.floor(pageViewport.width * dpr);
        canvas.height = Math.floor(pageViewport.height * dpr);
        canvas.style.width = `${Math.floor(pageViewport.width)}px`;
        canvas.style.height = `${Math.floor(pageViewport.height)}px`;
        resizeDrawingCanvas(pageNum, pageViewport.width, pageViewport.height);
        if (state.drawings?.[pageNum] === undefined) await loadDrawingsForPage(pageNum);

        wrapper.style.width = canvas.style.width;
        wrapper.style.height = canvas.style.height;

        if (state.renderTasks[pageNum]){state.renderTasks[pageNum].cancel();}
        const renderTask = page.render({ canvasContext: context, viewport: pageViewport, transform: [dpr, 0, 0, dpr, 0, 0] });
        state.renderTasks[pageNum] = renderTask;
        await renderTask.promise;


        state.textLayerTasks[pageNum] = textLayer;
        await textLayer.render({ viewport: pageViewport });

        wrapper.dataset.rendered = 'true';
        wrapper.dataset.scale = state.currentScale;
        loadNotesForPage(pageNum);
        loadAnnotationsForPage(pageNum);

        linksLayerDiv.innerHTML = ''; // Limpa links antigos

        try {
            const annotationsData = await page.getAnnotations();

            const annotationLayer = new pdfjsLib.AnnotationLayer({
                viewport: pageViewport,
                div: linksLayerDiv,
                page,
                linkService,
                renderForms: true
            });
            await annotationLayer.render({
                annotations: annotationsData,
                downloadManager: null
            });
        } catch (linkError) {
            console.warn("Erro ao renderizar links nativos:", linkError);
        }
    } catch (error) {
        if (error.name !== 'RenderingCancelledException') console.error(error);
    } finally {
        state.renderingStates[pageNum] = false;
        state.renderTasks[pageNum] = null;
        if (wrapper && Number(wrapper.dataset.scale) !== state.currentScale) renderPage(pageNum);
    }
}

function setupObserver() {
    pageObserver?.disconnect();
    pageObserver = new IntersectionObserver(entries => entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const pageNum = parseInt(entry.target.dataset.pageNumber, 10);
        renderPage(pageNum);
        pageInput.value = pageNum;
        window.dispatchEvent(new CustomEvent('pdf-page-changed', { detail: { pageNum } }));
        if (pageNum !== lastStoredPage) {
            lastStoredPage = pageNum;
            chrome.storage.local.set({ [state.currentFilename]: pageNum });
        }
    }), { root: viewport, threshold: 0.1 });
    document.querySelectorAll('.page-wrapper').forEach(page => pageObserver.observe(page));
}

export function renderVisiblePages() {
    const viewportRect = viewport.getBoundingClientRect();
    document.querySelectorAll('.page-wrapper').forEach(wrapper => {
        const rect = wrapper.getBoundingClientRect();
        if (rect.top < viewportRect.bottom && rect.bottom > viewportRect.top) {
            renderPage(parseInt(wrapper.dataset.pageNumber, 10));
        }
    });
}

function updatePageGeometry(page, pageNum) {
    const vp = page.getViewport({ scale: state.currentScale, rotation: (page.rotate || 0) + state.pageRotation });
    const wrapper = document.getElementById(`page-wrapper-${pageNum}`);

    if (!wrapper) return;
    wrapper.style.width = `${Math.floor(vp.width)}px`;
    wrapper.style.height = `${Math.floor(vp.height)}px`;
    wrapper.dataset.rendered = 'false';
    resizeDrawingCanvas(pageNum, vp.width, vp.height);

    const canvas = wrapper.querySelector('canvas:not(.drawing-canvas)');
    if (canvas) {
        canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    }
    wrapper.querySelector('.textLayer').innerHTML = '';
    wrapper.querySelector('.pdf-links-layer').innerHTML = '';

    return wrapper;
}

function getScrollAnchor() {
    const scrollTop = viewport.scrollTop;
    const wrappers = document.querySelectorAll('.page-wrapper');
    const wrapper = [...wrappers].find(page => page.offsetTop + page.offsetHeight > scrollTop);
    return {
        wrapper,
        offset: wrapper ? scrollTop - wrapper.offsetTop : 0
    };
}

function restoreScrollAnchor(anchor) {
    if (anchor.wrapper) {
        viewport.scrollTo({
            top: anchor.wrapper.offsetTop + anchor.offset,
            behavior: 'auto'
        });
    }
}

export async function updateZoom(newScale) {
    const requestId = ++zoomRequestId;
    const scrollAnchor = getScrollAnchor();

    state.currentScale = Math.min(Math.max(0.1, newScale), 5);
    document.getElementById('zoom-percent').value = `${Math.round(state.currentScale * 100)}%`;
    
    if (state.pdfDoc) {
        Object.values(state.textLayerTasks).forEach(task => task?.cancel());
        Object.values(state.renderTasks).forEach(task => task?.cancel());
        pageCache.forEach((page, pageNum) => updatePageGeometry(page, pageNum));
        if (requestId !== zoomRequestId) return;
        restoreScrollAnchor(scrollAnchor);
    }
    
    renderVisiblePages();
    saveState();
}

export async function fitWidth() {
    const page = await state.pdfDoc.getPage(1);
    updateZoom((window.innerWidth - 35) / page.getViewport({ scale: 1, rotation: (page.rotate || 0) + state.pageRotation }).width);
}

export async function fitHeight() {
    const page = await state.pdfDoc.getPage(1);
    updateZoom((window.innerHeight - 50) / page.getViewport({ scale: 1, rotation: (page.rotate || 0) + state.pageRotation }).height);
}

export function rotatePages(delta) {
    state.pageRotation = (state.pageRotation + delta + 360) % 360;
    document.querySelectorAll('.page-wrapper').forEach(wrapper => {
        wrapper.dataset.rendered = 'false';
    });
    window.dispatchEvent(new CustomEvent('pdf-rotation-changed'));
    updateZoom(state.currentScale);
}

window.currentPreviewPage = 1;
window.currentPreviewScale = 1.5;
window.currentPreviewName = "";
window.currentPreviewY = null;

window.showReferencePreview = async function(pageNum, refNameText = null, destY = undefined) {
    const previewEl = document.getElementById('reference-preview');
    const canvas = document.getElementById('ref-canvas');
    const ctx = canvas.getContext('2d', { alpha: false });
    const container = previewEl.querySelector('.ref-body');
    
    // Atualiza Estado
    window.currentPreviewPage = pageNum;
    if (refNameText !== null) window.currentPreviewName = refNameText;
     if (destY !== undefined) window.currentPreviewY = destY;
    
    document.getElementById('ref-page-number').textContent = window.currentPreviewPage;
    document.getElementById('ref-zoom-display').textContent = `${Math.round(window.currentPreviewScale * 100)}%`;
    
    const cleanRef = window.currentPreviewName.trim();
    // document.getElementById('ref-name').textContent = cleanRef ? ` ${cleanRef}` : '';
    
    previewEl.classList.remove('hidden');

    try {
        const page = await state.pdfDoc.getPage(window.currentPreviewPage);
        const viewport = page.getViewport({ scale: window.currentPreviewScale, rotation: (page.rotate || 0) + state.pageRotation });
        
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        
        await page.render({ 
            canvasContext: ctx, 
            viewport: viewport,
            transform: [dpr, 0, 0, dpr, 0, 0]
        }).promise;
        
        if (refNameText !== null) container.scrollTop = 0;

        if (destY !== null) {
            const pdfToHtmlY = viewport.height - (destY * window.currentPreviewScale);
            const centerOffset = container.clientHeight / 2;
            container.scrollTop = Math.max(0, pdfToHtmlY - centerOffset);
        } else if (refNameText !== null) {
            container.scrollTop = 0; 
        }

        
    } catch (err) {
        console.error("Erro ao gerar preview de referência:", err);
    }
}

window.flashHighlight = async function(pageNum, pdfX, pdfY, pdfW, isLinkTarget = false) {
    if (pdfY === null || pdfY === undefined) return;
    
    const wrapper = document.getElementById(`page-wrapper-${pageNum}`);
    if (!wrapper) return;

    const page = await state.pdfDoc.getPage(pageNum);
    const vp = page.getViewport({ scale: state.currentScale, rotation: (page.rotate || 0) + state.pageRotation });

    const safeX = (pdfX !== null && pdfX !== undefined) ? pdfX : 30; 
    
    const safeW = (pdfW !== null && pdfW !== undefined) ? pdfW : (isLinkTarget ? 350 : 150); 

    const htmlX = safeX * state.currentScale;
    const htmlY = vp.height - (pdfY * state.currentScale);
    const htmlW = safeW * state.currentScale;

    const flashBox = document.getElementById('jump-highlight');
    if (!flashBox) return;

    if (flashBox.hideTimeout) clearTimeout(flashBox.hideTimeout);
    if (flashBox.fadeTimeout) clearTimeout(flashBox.fadeTimeout);

    wrapper.appendChild(flashBox);
    
    flashBox.style.left = `${htmlX - 5}px`;
    flashBox.style.width = `${htmlW + 10}px`;
    
    if (isLinkTarget) {
        flashBox.style.top = `${htmlY + (1 * state.currentScale)}px`;
        flashBox.style.height = `${20 * state.currentScale}px`;
    } else {
        flashBox.style.top = `${htmlY - (12 * state.currentScale)}px`;
        flashBox.style.height = `${16 * state.currentScale}px`;
    }
    
    flashBox.classList.remove('hidden');
    flashBox.style.transition = 'none';
    flashBox.style.opacity = '1';

    void flashBox.offsetHeight;
    flashBox.style.transition = 'opacity 1.5s ease-in-out';

    flashBox.fadeTimeout = setTimeout(() => { 
        flashBox.style.opacity = '0';
    }, 1200);

    flashBox.hideTimeout = setTimeout(() => {
        flashBox.classList.add('hidden'); 
    }, 2700);
};