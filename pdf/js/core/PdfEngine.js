import * as pdfjsLib from '../../lib/pdf_js/build/pdf.mjs';
import { appState } from './AppState.js';
import { HistoryManager } from '../controllers/HistoryManager.js';
import { BookmarkManager } from '../controllers/BookmarkManager.js';
import { ElementsManager } from '../controllers/ElementsManager.js';
import { NotesManager } from '../controllers/NotesManager.js';
import { storageService } from '../services/StorageService.js';
import { migrateLegacyStorage } from '../utils/migrate.js';
import { jumpTo } from '../utils/navigation.js';
import { logger } from '../services/LoggerService.js';

// Worker config
const pdfJsBaseUrl = new URL('../../lib/pdf_js/', import.meta.url);
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('build/pdf.worker.mjs', pdfJsBaseUrl).href;

const linkService = {
    getDestinationHash: destination => typeof destination === 'string' ? `#${encodeURIComponent(destination)}` : '#',
    getAnchorUrl: url => url || '#',
    setDocument: () => {},
    navigateTo: destination => { window.location.href = destination; },
    executeNamedAction: action => {
        if (action === 'NextPage') jumpTo(Math.min(appState.currentSession.pdfDoc.numPages, Number(document.getElementById('page-input').value) + 1));
        if (action === 'PrevPage') jumpTo(Math.max(1, Number(document.getElementById('page-input').value) - 1));
        if (action === 'FirstPage') jumpTo(1);
        if (action === 'LastPage') jumpTo(appState.currentSession.pdfDoc.numPages);
    },
    addLinkAttributes: (link, url) => {
        link.href = url;
        link.target = url ? '_blank' : '';
        link.rel = 'noopener noreferrer nofollow';
    },
    goToDestination: async destination => {
        const pdfDoc = appState.currentSession?.pdfDoc;
        if (!pdfDoc) return;
        const dest = typeof destination === 'string'
            ? await pdfDoc.getDestination(destination)
            : destination;
        if (!Array.isArray(dest) || !dest[0]) return;

        const pageIndex = await pdfDoc.getPageIndex(dest[0]);
        const command = dest[1]?.name;
        const destX = command === 'XYZ' && typeof dest[2] === 'number' ? dest[2] : null;
        const destY = ['XYZ', 'FitR', 'FitH', 'FitV', 'FitBH', 'FitBV'].includes(command)
            ? (typeof dest[3] === 'number' ? dest[3] : typeof dest[2] === 'number' ? dest[2] : null)
            : null;
        jumpTo(pageIndex + 1, { pdfY: destY, align: 'top', flashX: destX, origin: 'top' });
    }
};

export class PdfEngine {
    constructor(state = appState, storage = storageService) {
        this.state = state;
        this.storage = storage;
        this.pageCache = new Map();
        this.pageObserver = null;
        this.zoomRequestId = 0;
        this.container = document.getElementById('pages-container');
        this.viewport = document.getElementById('viewport');
    }

    async getPage(pageNum) {
        if (!this.pageCache.has(pageNum)) {
            const pagePromise = this.state.currentSession.pdfDoc.getPage(pageNum);
            this.pageCache.set(pageNum, pagePromise);
        }
        return this.pageCache.get(pageNum);
    }

    /**
     * Loads a new PDF
     */
    async loadDocument(source, filename, displayTitle = filename) {
        // 1. Limpa renderizações anteriores
        Object.values(this.state.renderTasks).forEach(t => t?.cancel());
        Object.values(this.state.textLayerTasks).forEach(t => t?.cancel());
        this.pageObserver?.disconnect();
        this.pageCache.clear();

        // 2. Carrega com PDF.js
        const preservedPdfBytes = source instanceof ArrayBuffer
            ? source.slice(0)
            : source instanceof Uint8Array
                ? source.slice()
                : null;
        const docSource = typeof source === 'string' ? { url: source } : { data: source };
        const loadingTask = pdfjsLib.getDocument({
            ...docSource,
            cMapUrl: new URL('web/cmaps/', pdfJsBaseUrl).href,
            cMapPacked: true,
            standardFontDataUrl: new URL('web/standard_fonts/', pdfJsBaseUrl).href,
            wasmUrl: new URL('web/wasm/', pdfJsBaseUrl).href
        });

        const pdfDoc = await loadingTask.promise;

        await migrateLegacyStorage(this.storage.adapter);
        let isSigned = false;
        if (typeof pdfDoc.getFieldObjects === 'function') {
            try {
                const fieldObjects = await pdfDoc.getFieldObjects();
                isSigned = Object.values(fieldObjects || {}).flat().some(field => {
                    const fieldType = field?.type ?? field?.fieldType;
                    const hasSignatureValue = field?.value !== undefined &&
                        field.value !== null &&
                        field.value !== '';
                    return ['Sig', 'sig', 'signature'].includes(fieldType) && hasSignatureValue;
                });
            } catch (error) {
                logger.warn('Não foi possível verificar assinaturas digitais no PDF.', error);
            }
        }

        // 3. Creates a session with his managers
        const history = new HistoryManager();
        const bookmarks = new BookmarkManager(filename, history, this.storage);
        const elements = new ElementsManager(filename, this.storage);
        const notes = new NotesManager(filename, history, this.storage);

        this.state.setSession({
            filename,
            displayTitle,
            pdfDoc,
            pdfBytes: preservedPdfBytes,
            isSigned,
            history,
            bookmarks,
            elements,
            notes
        });

        // 4. Regista no storage index
        await this.storage.registerDocument(filename, { pageCount: pdfDoc.numPages });

        // 5. Prepara a grelha de páginas (Geometria Instantânea)
        await this._setupPageWrappers(pdfDoc);

        // 6. Inicia o parser de texto em segundo plano
        elements.loadAutomaticElements(pdfDoc).catch(error => logger.error('Não foi possível analisar figuras e tabelas.', error));
        elements.loadManualElements().catch(error => logger.error('Não foi possível carregar elementos guardados.', error));

        document.title = displayTitle || 'UniPDF Pro';
        window.dispatchEvent(new CustomEvent('pdf-document-loaded', { detail: { filename, numPages: pdfDoc.numPages } }));

        return pdfDoc;
    }

    async _setupPageWrappers(pdfDoc) {
        this.container.innerHTML = '';
        const totalPages = pdfDoc.numPages;

        const pagePromises = [];
        for (let i = 1; i <= totalPages; i++) {
            pagePromises.push(this.getPage(i));
        }
        const pages = await Promise.all(pagePromises);

        pages.forEach((page, index) => {
            const pageNum = index + 1;
            const vp = page.getViewport({ scale: this.state.currentScale, rotation: (page.rotate || 0) + this.state.pageRotation });

            const wrapper = document.createElement('div');
            wrapper.className = 'page-wrapper';
            wrapper.id = `page-wrapper-${pageNum}`;
            wrapper.dataset.pageNumber = pageNum;
            wrapper.style.width = `${Math.floor(vp.width)}px`;
            wrapper.style.height = `${Math.floor(vp.height)}px`;

            wrapper.innerHTML = `
                <div class="page-actions-overlay"></div>
                <canvas></canvas>
                <canvas class="drawing-canvas"></canvas>
                <div class="pdf-links-layer"></div>
                <div class="annotation-layer"></div>
                <div class="textboxes-overlay"></div>
                <div class="textLayer"></div>
                <div class="notes-overlay"></div>
                <div class="bookmarks-overlay"></div>
                <div class="search-overlay"></div>
            `;

            this.container.appendChild(wrapper);
        });

        this._setupIntersectionObserver();
    }

    async renderPage(pageNum) {
        const wrapper = document.getElementById(`page-wrapper-${pageNum}`);
        if (!wrapper || this.state.renderingStates[pageNum]) return;

        if (wrapper.dataset.rendered === 'true' && Number(wrapper.dataset.scale) === this.state.currentScale) {
            return;
        }

        const renderScale = this.state.currentScale;
        this.state.renderingStates[pageNum] = true;
        const dpr = window.devicePixelRatio || 1;

        try {
            const page = await this.getPage(pageNum);
            if (renderScale !== this.state.currentScale) return;
            const pageViewport = page.getViewport({
                scale: renderScale,
                rotation: (page.rotate || 0) + this.state.pageRotation
            });

            const canvas = wrapper.querySelector('canvas:not(.drawing-canvas)');
            const context = canvas.getContext('2d', { alpha: false });

            canvas.width = Math.floor(pageViewport.width * dpr);
            canvas.height = Math.floor(pageViewport.height * dpr);
            canvas.style.width = `${Math.floor(pageViewport.width)}px`;
            canvas.style.height = `${Math.floor(pageViewport.height)}px`;

            wrapper.style.width = canvas.style.width;
            wrapper.style.height = canvas.style.height;

            if (this.state.renderTasks[pageNum]) {
                this.state.renderTasks[pageNum].cancel();
            }

            const renderTask = page.render({
                canvasContext: context,
                viewport: pageViewport,
                transform: [dpr, 0, 0, dpr, 0, 0]
            });
            this.state.renderTasks[pageNum] = renderTask;
            await renderTask.promise;
            if (renderScale !== this.state.currentScale) return;

            // Renderiza Camada de Texto nativa do PDF.js
            const textLayerDiv = wrapper.querySelector('.textLayer');
            textLayerDiv.innerHTML = '';
            textLayerDiv.style.setProperty('--total-scale-factor', renderScale);
            textLayerDiv.style.setProperty('--min-font-size', '1');
            textLayerDiv.style.setProperty('--min-font-size-inv', '1');

            const textLayer = new pdfjsLib.TextLayer({
                textContentSource: page.streamTextContent({ includeMarkedContent: true, disableNormalization: true }),
                container: textLayerDiv,
                viewport: pageViewport
            });
            this.state.textLayerTasks[pageNum] = textLayer;
            await textLayer.render();
            if (renderScale !== this.state.currentScale) return;

            const linksLayer = wrapper.querySelector('.pdf-links-layer');
            linksLayer.innerHTML = '';
            try {
                const annotations = await page.getAnnotations();
                const annotationLayer = new pdfjsLib.AnnotationLayer({
                    viewport: pageViewport,
                    div: linksLayer,
                    page,
                    linkService,
                    renderForms: true
                });
                await annotationLayer.render({ annotations, downloadManager: null });
                if (renderScale !== this.state.currentScale) return;
            } catch (error) {
                if (renderScale !== this.state.currentScale) return;
                console.warn(`Não foi possível renderizar os links/formulários da página ${pageNum}.`, error);
            }

            wrapper.dataset.rendered = 'true';
            wrapper.dataset.scale = renderScale;

            // Emite evento para os Overlays de UI desenharem notas, marcadores e destaques
            window.dispatchEvent(new CustomEvent('page-rendered', { detail: { pageNum, wrapper, viewport: pageViewport } }));

        } catch (error) {
            const textLayerCancelled = error.name === 'AbortException' &&
                error.message === 'TextLayer task cancelled.';
            if (renderScale === this.state.currentScale &&
                error.name !== 'RenderingCancelledException' &&
                !textLayerCancelled) {
                console.error(`Erro ao renderizar pág. ${pageNum}:`, error);
                window.dispatchEvent(new CustomEvent('pdf-render-error', { detail: { pageNum, error } }));
            }
        } finally {
            this.state.renderingStates[pageNum] = false;
            this.state.renderTasks[pageNum] = null;
            if (wrapper.isConnected && renderScale !== this.state.currentScale) {
                this._renderVisiblePages();
            }
        }
    }

    _setupIntersectionObserver() {
        this.pageObserver?.disconnect();
        this.pageObserver = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                if (!entry.isIntersecting) return;
                const pageNum = parseInt(entry.target.dataset.pageNumber, 10);
                this.renderPage(pageNum);
            });
        }, { root: this.viewport, threshold: 0.1 });

        document.querySelectorAll('.page-wrapper').forEach(p => this.pageObserver.observe(p));
    }

    async updateZoom(newScale) {
        const reqId = ++this.zoomRequestId;
        const scrollAnchor = this._getScrollAnchor();
        this.state.setScale(newScale);
        const scale = this.state.currentScale;

        Object.values(this.state.renderTasks).forEach(task => task?.cancel());
        Object.values(this.state.textLayerTasks).forEach(task => task?.cancel());

        const pageGeometries = await Promise.all(
            [...this.pageCache.entries()].map(async ([pageNum, pagePromise]) => {
                const page = await pagePromise;
                const viewport = page.getViewport({
                    scale,
                    rotation: (page.rotate || 0) + this.state.pageRotation
                });
                return { pageNum, viewport };
            })
        );
        if (reqId !== this.zoomRequestId) return;

        const dpr = window.devicePixelRatio || 1;
        pageGeometries.forEach(({ pageNum, viewport }) => {
            const wrapper = document.getElementById(`page-wrapper-${pageNum}`);
            if (wrapper) {
                const width = Math.floor(viewport.width);
                const height = Math.floor(viewport.height);
                wrapper.style.width = `${width}px`;
                wrapper.style.height = `${height}px`;
                wrapper.dataset.rendered = 'false';
                const canvas = wrapper.querySelector('canvas:not(.drawing-canvas)');
                if (canvas) {
                    canvas.width = Math.floor(viewport.width * dpr);
                    canvas.height = Math.floor(viewport.height * dpr);
                    canvas.style.width = `${width}px`;
                    canvas.style.height = `${height}px`;
                }
                const textLayer = wrapper.querySelector('.textLayer');
                if (textLayer) textLayer.innerHTML = '';
                const linksLayer = wrapper.querySelector('.pdf-links-layer');
                if (linksLayer) linksLayer.innerHTML = '';
            }
        });

        this._restoreScrollAnchor(scrollAnchor);
        this._renderVisiblePages();
    }

    _getScrollAnchor() {
        const scrollTop = this.viewport.scrollTop;
        const pages = [...this.container.querySelectorAll('.page-wrapper')];
        const wrapper = pages.find(page => page.offsetTop + page.offsetHeight > scrollTop) || pages.at(-1);
        return wrapper
            ? {
                pageNum: Number(wrapper.dataset.pageNumber),
                offsetRatio: wrapper.offsetHeight
                    ? (scrollTop - wrapper.offsetTop) / wrapper.offsetHeight
                    : 0
            }
            : null;
    }

    _restoreScrollAnchor(anchor) {
        if (!anchor) return;
        const wrapper = document.getElementById(`page-wrapper-${anchor.pageNum}`);
        if (wrapper) {
            this.viewport.scrollTop = wrapper.offsetTop + wrapper.offsetHeight * anchor.offsetRatio;
        }
    }

    _renderVisiblePages() {
        const vpRect = this.viewport.getBoundingClientRect();
        document.querySelectorAll('.page-wrapper').forEach(wrapper => {
            const rect = wrapper.getBoundingClientRect();
            if (rect.top < vpRect.bottom && rect.bottom > vpRect.top) {
                this.renderPage(parseInt(wrapper.dataset.pageNumber, 10));
            }
        });
    }
}

export const pdfEngine = new PdfEngine();