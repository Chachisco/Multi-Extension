import * as pdfjsLib from '../lib/pdf.mjs';
import { state } from './state.js';
import { loadAnnotationsForPage } from './annotations.js';
import { loadNotesForPage } from './notes.js';
import { saveState } from './storage.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = './lib/pdf.worker.mjs';

const container = document.getElementById('pages-container');
const viewport = document.getElementById('viewport');
const pageInput = document.getElementById('page-input');

export async function loadPDF(source, filename) {
    state.currentFilename = filename;
    document.title = filename || 'UniPDF Pro';
    const loadingTask = pdfjsLib.getDocument(typeof source === 'string' ? { url: source } : { data: source });
    state.pdfDoc = await loadingTask.promise;
    
    const totalPages = state.pdfDoc.numPages;
    document.getElementById('page-count').textContent = totalPages;
    container.innerHTML = '';

    // 1. Descobrir a geometria EXATA de todas as páginas super rápido (sem as pintar!)
    const pagePromises = [];
    for (let i = 1; i <= totalPages; i++) {
        pagePromises.push(state.pdfDoc.getPage(i));
    }
    const pages = await Promise.all(pagePromises);

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
        const page = await state.pdfDoc.getPage(pageNum);
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

        const mathPattern = /[=+\-*/\\[\]{}()<>_^|0-9]/;
        const bionicRanges = [];
        
        // Usar TreeWalker para capturar os nós de texto verdadeiros do PDF.js
        const treeWalker = document.createTreeWalker(textLayerDiv, NodeFilter.SHOW_TEXT, null, false);
        let textNode;
        
        while ((textNode = treeWalker.nextNode())) {
            const text = textNode.nodeValue;
            if (text.trim().length > 1) {
                // Regex global que apanha cada palavra e a sua posição no node
                const wordRegex = /\S+/g;
                let match;
                
                while ((match = wordRegex.exec(text)) !== null) {
                    const word = match[0];
                    if (word.length <= 1 || mathPattern.test(word)) continue;
                    
                    const splitPoint = Math.ceil(word.length / 2);
                    
                    try {
                        const range = new Range();
                        // Destaca apenas a primeira metade da palavra
                        range.setStart(textNode, match.index);
                        range.setEnd(textNode, match.index + splitPoint);
                        bionicRanges.push(range);
                    } catch(e) {}
                }
            }
        }

        // Se houver palavras para pintar, criamos o grupo e pintamos a página toda
        if (bionicRanges.length > 0 && CSS.highlights) {
            // Guarda com o ID da página para podermos gerir (ligar/desligar)
            const highlight = new Highlight(...bionicRanges);
            CSS.highlights.set(`bionic-pg-${pageNum}`, highlight);
        }

        // Sincronizar com o estado atual do botão
        const btnBold = document.getElementById('btn-bold-mode');
        if (btnBold && btnBold.style.color === 'rgb(255, 215, 64)') {
            wrapper.classList.add('fast-read');
        } else {
            // Se estiver desligado, limpamos a pintura desta página
            if (CSS.highlights) CSS.highlights.delete(`bionic-pg-${pageNum}`);
        }

        wrapper.dataset.rendered = 'true';
        wrapper.dataset.scale = state.currentScale;
        loadNotesForPage(pageNum);
        loadAnnotationsForPage(pageNum);

        linksLayerDiv.innerHTML = ''; // Limpa links antigos

        try {
            const annotationsData = await page.getAnnotations();
            const linkAnnotations = annotationsData.filter(a => a.subtype === 'Link');
            
            const linkService = {
                    getDestinationHash: (dest) => dest,
                    navigateTo: (dest) => console.log("Navegar para:", dest),
                    getAnchorUrl: (url) => url || "",
                    setDocument: () => {},
                    executeNamedAction: (action) => console.log("Ação:", action),
                    addLinkAttributes: (link, url, newWindow) => {
                        link.href = url;
                        link.target = url ? '_blank' : '';
                        link.rel = 'noopener noreferrer nofollow';
                    }
                };

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
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const pageNum = parseInt(entry.target.dataset.pageNumber, 10);
        renderPage(pageNum);
        pageInput.value = pageNum;
        chrome.storage.local.set({ [state.currentFilename]: pageNum });
    }), { root: viewport, threshold: 0.1 });
    document.querySelectorAll('.page-wrapper').forEach(page => observer.observe(page));
}

export function renderVisiblePages() {
    document.querySelectorAll('.page-wrapper').forEach(wrapper => {
        const rect = wrapper.getBoundingClientRect();
        if (rect.top < window.innerHeight && rect.bottom > 0) renderPage(parseInt(wrapper.dataset.pageNumber, 10));
    });
}

export async function updateZoom(newScale) {
    state.currentScale = Math.min(Math.max(0.1, newScale), 5);
    document.getElementById('zoom-percent').value = `${Math.round(state.currentScale * 100)}%`;
    
    if (state.pdfDoc) {
        const totalPages = state.pdfDoc.numPages;
        const pagePromises = [];
        
        for (let i = 1; i <= totalPages; i++) {
            pagePromises.push(state.pdfDoc.getPage(i));
        }
        
        const pages = await Promise.all(pagePromises);

        pages.forEach((page, index) => {
            const pageNum = index + 1;
            const vp = page.getViewport({ scale: state.currentScale });
            const wrapper = document.getElementById(`page-wrapper-${pageNum}`);
            
            if (wrapper) {
                wrapper.style.width = `${Math.floor(vp.width)}px`;
                wrapper.style.height = `${Math.floor(vp.height)}px`;
                
                wrapper.dataset.rendered = 'false'; 
                
                const canvas = wrapper.querySelector('canvas');
                if(canvas) {
                    const ctx = canvas.getContext('2d');
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                }
            }
        });
    }

    Object.values(state.textLayerTasks).forEach(task => task?.cancel());
    Object.values(state.renderTasks).forEach(task => task?.cancel());
    
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