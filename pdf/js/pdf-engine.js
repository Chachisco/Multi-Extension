import * as pdfjsLib from '../lib/pdf_js/build/pdf.mjs';
import { state } from './state.js';
import { loadAnnotationsForPage } from './annotations.js';
import { loadNotesForPage } from './notes.js';
import { saveState } from './storage.js';
import { activate as activateHistory } from './history.js';
import { initDrawingLayer, resizeDrawingCanvas, loadDrawingsForPage } from './drawing.js';
import { TextLayerBuilder } from './text-layer-builder.js';
import { deleteSinglePage, rotateSinglePage } from './pdf_editor.js';

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

                if (window.isShiftPressed) {
                    showReferencePreview(targetPage, window.lastClickedLinkText);
                    return;
                }

                const wrapper = document.getElementById(`page-wrapper-${targetPage}`);
                if (wrapper) {
                    const viewport = document.getElementById('viewport');
                    document.getElementById('page-input').value = targetPage;
                    viewport.scrollTo({ top: Math.max(0, wrapper.offsetTop - 42), behavior: 'smooth' }); 
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

    // state.currentFilename = filename;
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

            const keyAnnotations = `${state.currentFilename}_pg${pageNum}_annotations`;
            const keyNotes = `${state.currentFilename}_pg${pageNum}_notes`;
            const keyDrawings = `${state.currentFilename}_pg${pageNum}_drawings`;

            chrome.storage.local.get([keyAnnotations, keyNotes, keyDrawings], (result) => {

                let keepNotes = false;

                if (result[keyNotes]?.length > 0) {
                    const ans = confirm(`A página ${pageNum} tem notas.\nQueres apagá-las também?\n(OK = Apagar tudo | Cancelar = Apagar a página e passar as notas para a página seguinte)`);
                    keepNotes = !ans;
                } else {
                    if (!confirm(`Tens a certeza que queres apagar a página ${pageNum}?`)) return;
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

async function showReferencePreview(pageNum, refNameText = "") {
    const previewEl = document.getElementById('reference-preview');
    const canvas = document.getElementById('ref-canvas');
    const ctx = canvas.getContext('2d');
    const container = previewEl.querySelector('.ref-body');
    
    document.getElementById('ref-page-number').textContent = pageNum;
    
    const cleanRef = refNameText.trim();
    document.getElementById('ref-name').textContent = cleanRef ? ` ${cleanRef}` : '';
    
    previewEl.classList.remove('hidden');

    try {
        const page = await state.pdfDoc.getPage(pageNum);
        
        const viewport = page.getViewport({ scale: 2.0, rotation: (page.rotate || 0) + state.pageRotation });
        
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        
        await page.render({ canvasContext: ctx, viewport: viewport }).promise;
        
        container.scrollTop = 0;
        
    } catch (err) {
        console.error("Erro ao gerar preview de referência:", err);
    }
}