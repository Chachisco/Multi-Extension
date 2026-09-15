import * as pdfjsLib from '../lib/pdf.mjs';
import { state } from './state.js';
import { loadAnnotationsForPage } from './annotations.js';
import { loadNotesForPage } from './notes.js';
import { saveState } from './storage.js';
import { activate as activateHistory } from './history.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = './lib/pdf.worker.mjs';

const container = document.getElementById('pages-container');
const viewport = document.getElementById('viewport');
const pageInput = document.getElementById('page-input');
let zoomRequestId = 0;
let pageObserver = null;
let lastStoredPage = null;
const pageCache = new Map();

const linkService = {
    getDestinationHash: dest => dest,
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
    state.annotationLoadVersions = {};
    state.pendingAnnotationRemovals = new Map();
    lastStoredPage = null;

    state.currentFilename = filename;
    activateHistory(filename);
    document.title = filename || 'UniPDF Pro';
    const loadingTask = pdfjsLib.getDocument(typeof source === 'string' ? { url: source } : { data: source });
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

    // 2. Criar as caixas com as medidas reais de cada uma
    pages.forEach((page, index) => {
        const pageNum = index + 1;
        const vp = page.getViewport({ scale: state.currentScale });

        const wrapper = document.createElement('div');
        wrapper.className = 'page-wrapper';
        wrapper.id = `page-wrapper-${pageNum}`;
        wrapper.dataset.pageNumber = pageNum;
        
        // Cada página tem a sua medida certa (slides, A4, etc)
        wrapper.style.width = `${Math.floor(vp.width)}px`;
        wrapper.style.height = `${Math.floor(vp.height)}px`;
        
        wrapper.innerHTML = '<canvas></canvas><div class="pdf-links-layer"></div><div class="annotation-layer"></div><div class="textLayer"></div><div class="notes-overlay"></div>';
        container.appendChild(wrapper);
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
        const pageViewport = page.getViewport({ scale: state.currentScale });
        const canvas = wrapper.querySelector('canvas');
        const context = canvas.getContext('2d', { alpha: false });
        const textLayerDiv = wrapper.querySelector('.textLayer');
        const textLayer = new pdfjsLib.TextLayer({
            textContentSource: await page.getTextContent(),
            container: textLayerDiv,
            viewport: pageViewport
        });
        const linksLayerDiv = wrapper.querySelector('.pdf-links-layer');

        canvas.width = Math.floor(pageViewport.width * dpr);
        canvas.height = Math.floor(pageViewport.height * dpr);
        canvas.style.width = `${Math.floor(pageViewport.width)}px`;
        canvas.style.height = `${Math.floor(pageViewport.height)}px`;

        wrapper.style.width = canvas.style.width;
        wrapper.style.height = canvas.style.height;

        if (state.renderTasks[pageNum]){state.renderTasks[pageNum].cancel();}
        const renderTask = page.render({ canvasContext: context, viewport: pageViewport, transform: [dpr, 0, 0, dpr, 0, 0] });
        state.renderTasks[pageNum] = renderTask;
        await renderTask.promise;


        textLayerDiv.innerHTML = '';
        textLayerDiv.style.setProperty('--scale-factor', state.currentScale);
        textLayerDiv.style.setProperty('--total-scale-factor', state.currentScale);

        state.textLayerTasks[pageNum] = textLayer;
        await textLayer.render();

        wrapper.dataset.rendered = 'true';
        wrapper.dataset.scale = state.currentScale;
        loadNotesForPage(pageNum);
        loadAnnotationsForPage(pageNum);

        linksLayerDiv.innerHTML = ''; // Limpa links antigos

        try {
            const annotationsData = await page.getAnnotations();
            const linkAnnotations = annotationsData.filter(a => a.subtype === 'Link');
            
            const annotationLayer = new pdfjsLib.AnnotationLayer({
                viewport: pageViewport,
                div: linksLayerDiv,
                page,
                linkService
            });
            await annotationLayer.render({
                annotations: linkAnnotations,
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
    const vp = page.getViewport({ scale: state.currentScale });
    const wrapper = document.getElementById(`page-wrapper-${pageNum}`);

    if (!wrapper) return;
    wrapper.style.width = `${Math.floor(vp.width)}px`;
    wrapper.style.height = `${Math.floor(vp.height)}px`;
    wrapper.dataset.rendered = 'false';

    const canvas = wrapper.querySelector('canvas');
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
    updateZoom((window.innerWidth - 35) / page.getViewport({ scale: 1 }).width);
}

export async function fitHeight() {
    const page = await state.pdfDoc.getPage(1);
    updateZoom((window.innerHeight - 50) / page.getViewport({ scale: 1 }).height);
}