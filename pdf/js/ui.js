import { state } from './state.js';
import { saveState } from './storage.js';
import { applyAnnotation } from './annotations.js';
import { updateZoom, fitWidth, fitHeight, rotatePages } from './pdf-engine.js';
import { mergePDFs } from './pdf_editor.js';
import { addNoteToUI } from './notes.js';
import { undo, redo } from './history.js';
import { setupDrawingTools } from './drawing.js';
import * as PDFLib from '../lib/pdf_lib/pdf-lib.min.js';
const { PDFDocument, rgb } = window.PDFLib || PDFLib;


const header = document.getElementById('mini-header');
const zoomInput = document.getElementById('zoom-percent');
const pageInput = document.getElementById('page-input');
const container = document.getElementById('pages-container');
let wheelZoomTimer = null;
let pendingWheelScale = null;

function queueWheelZoom(delta) {
    pendingWheelScale = (pendingWheelScale ?? state.currentScale) + delta;
    clearTimeout(wheelZoomTimer);
    wheelZoomTimer = setTimeout(() => {
        const nextScale = pendingWheelScale;
        pendingWheelScale = null;
        updateZoom(nextScale);
    }, 40);
}

export function setHeaderMode(mode) {
    state.headerMode = mode;
    header.className = `mode-${mode}`;
    header.classList.toggle('annotation-active', state.annotationActive);
    header.classList.toggle('eraser-active', state.eraserActive);
    header.classList.toggle('freehand-active', state.freehandActive);
    const icons = {
        ghost: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>',
        minimal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/></svg>',
        fixed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>'
    };
    document.getElementById('btn-header-mode').innerHTML = icons[mode];
    saveState();
}

function setAnnotationActive(active) {
    state.annotationActive = active;
    if (active) state.freehandActive = false;
    if (active) state.eraserActive = false;
    document.getElementById('annotation-options').classList.toggle('hidden', !active);
    header.classList.toggle('annotation-active', state.annotationActive);
    header.classList.toggle('eraser-active', state.eraserActive);
    header.classList.toggle('freehand-active', state.freehandActive);
    document.getElementById('btn-annotate').classList.toggle('tool-active', state.annotationActive);
    document.getElementById('btn-eraser').classList.toggle('tool-active', state.eraserActive);
    document.getElementById('btn-draw').classList.toggle('tool-active', state.freehandActive);
    document.querySelectorAll('.drawing-canvas').forEach(canvas => canvas.classList.toggle('active', state.freehandActive));
    document.querySelectorAll('.annotation-layer').forEach(layer => layer.classList.toggle('eraser-active', state.eraserActive));
}

function setFreehandActive(active) {
    state.freehandActive = active;
    if (active) {
        state.annotationActive = false;
        state.eraserActive = false;
    }
    document.getElementById('annotation-options').classList.toggle('hidden', !active && !state.annotationActive);
    header.classList.toggle('annotation-active', state.annotationActive);
    header.classList.toggle('eraser-active', state.eraserActive);
    header.classList.toggle('freehand-active', active);
    document.getElementById('btn-draw').classList.toggle('tool-active', active);
    document.getElementById('btn-annotate').classList.toggle('tool-active', state.annotationActive);
    document.getElementById('btn-eraser').classList.toggle('tool-active', state.eraserActive);
    document.querySelectorAll('.drawing-canvas').forEach(canvas => canvas.classList.toggle('active', active));
}

export function setupUI() {
    // Annotations
    document.getElementById('btn-annotate').onclick = () => setAnnotationActive(!state.annotationActive);
    document.getElementById('btn-eraser').onclick = () => {
        state.eraserActive = !state.eraserActive;
        if (state.eraserActive) state.annotationActive = false;
        state.freehandActive = false;
        setAnnotationActive(state.annotationActive);
    };
    document.getElementById('btn-draw').onclick = () => setFreehandActive(!state.freehandActive);
    setupDrawingTools();
    
    // Zoom e Modos Visuais
    document.getElementById('btn-header-mode').onclick = () => cycleHeaderMode();
    document.getElementById('btn-zoom-in').onclick = () => updateZoom(state.currentScale + 0.1);
    document.getElementById('btn-zoom-out').onclick = () => updateZoom(state.currentScale - 0.1);
    document.getElementById('btn-fit-width').onclick = fitWidth;
    document.getElementById('btn-fit-height').onclick = fitHeight;
    document.getElementById('btn-rotate-ccw').onclick = () => rotatePages(-90);
    document.getElementById('btn-rotate-cw').onclick = () => rotatePages(90);
    zoomInput.onkeydown = event => {
        if (event.key !== 'Enter') return;
        const value = parseInt(zoomInput.value, 10);
        if (!isNaN(value)) updateZoom(value / 100);
        zoomInput.blur();
    };
    
    // Slider Lateral e Input de Página
    document.getElementById('lateral-slider').oninput = event => { container.style.transform = `translateX(${event.target.value * 10}px)`; };
    pageInput.onchange = () => {
        let val = parseInt(pageInput.value, 10);
        if (isNaN(val) || val < 1) val = 1;
        if (state.pdfDoc && val > state.pdfDoc.numPages) val = state.pdfDoc.numPages;
        pageInput.value = val;

        const wrapper = document.getElementById(`page-wrapper-${val}`);
        const viewport = document.getElementById('viewport');
        if (wrapper && viewport) {
            const y = wrapper.offsetTop - 60;
            viewport.scrollTo({ top: y, behavior: 'smooth' });
        }
    };
    const btnMerge = document.getElementById('btn-merge-pdf');
    const mergeInput = document.getElementById('merge-file-input');
    const modalMerge = document.getElementById('modal-merge');
    const btnMergeCancel = document.getElementById('btn-merge-cancel');
    const btnMergeConfirm = document.getElementById('btn-merge-confirm');
    const mergePageInput = document.getElementById('merge-page-input');

    let pendingMergeBytes = null;

    if (btnMerge) {
        btnMerge.onclick = () => mergeInput.click();
    }

    if (mergeInput) {
        mergeInput.onchange = async () => {
            const file = mergeInput.files?.[0];
            if (file) {
                pendingMergeBytes = await file.arrayBuffer();
                // Mostra o Modal de Configuração
                mergePageInput.placeholder = `(Padrão: Fim da página ${state.pdfDoc.numPages})`;
                mergePageInput.value = '';
                mergePageInput.max = state.pdfDoc.numPages + 1;
                modalMerge.classList.remove('hidden');
            }
            mergeInput.value = ''; // Limpa para permitir re-seleção
        };
    }

    if (btnMergeCancel) {
        btnMergeCancel.onclick = () => {
            modalMerge.classList.add('hidden');
            pendingMergeBytes = null;
        };
    }

    if (btnMergeConfirm) {
        btnMergeConfirm.onclick = async () => {
            modalMerge.classList.add('hidden');
            let targetPage = parseInt(mergePageInput.value, 10);
            if (isNaN(targetPage) || targetPage < 1) targetPage = null; // null assume-se fim
            
            if (pendingMergeBytes) {
                await mergePDFs(pendingMergeBytes.slice(0), targetPage);
                pendingMergeBytes = null;
            }
        };
    }

    // Botões header left
    const btnDownload = document.getElementById('btn-download');
    const dlMenu = document.getElementById('download-menu');
    
    if (btnDownload && dlMenu) {
        btnDownload.onclick = (e) => {
            e.stopPropagation();
            dlMenu.classList.toggle('hidden');
        };
        
        document.addEventListener('click', () => {
            dlMenu.classList.add('hidden');
        });
        
        document.getElementById('btn-dl-save').onclick = () => downloadNormal(false);
        document.getElementById('btn-dl-normal').onclick = downloadNormal;
        document.getElementById('btn-dl-burn').onclick = downloadBurnIn;
        document.getElementById('btn-dl-export').onclick = downloadWithNotes;
    }

    const btnCopy = document.getElementById('btn-copy-url');
    if (btnCopy) {
        btnCopy.onclick = (e) => handleCopy(e, e.ctrlKey, btnCopy);
        btnCopy.oncontextmenu = (e) => handleCopy(e, true, btnCopy); 
    }

    const btnAddNote = document.getElementById('btn-add-note');
    if (btnAddNote) {
        btnAddNote.onclick = () => {
            const currentPg = parseInt(pageInput.value, 10);
            const overlay = document.querySelector(`#page-wrapper-${currentPg} .notes-overlay`);
            if (overlay) addNoteToUI(overlay, currentPg, 50, 10, '', false);
        };
    }

    const btnFullscreen = document.getElementById('btn-fullscreen');
    if (btnFullscreen) {
        btnFullscreen.onclick = () => {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen().catch(err => console.log(`Erro Fullscreen: ${err.message}`));
            } else {
                document.exitFullscreen();
            }
        };
    }

    const btnFocus = document.getElementById('btn-focus-mode');
    const readingRuler = document.getElementById('reading-ruler');
    const focusOptions = document.getElementById('focus-options');
    
    if (btnFocus) {
        btnFocus.onclick = () => {
            state.focusMode = (state.focusMode + 1) % 3;
            btnFocus.style.color = state.focusMode > 0 ? '#80d8ff' : '#ccc'; 
            
            readingRuler.className = ''; 
            focusOptions?.classList.toggle('hidden', state.focusMode === 0);

            if (state.focusMode === 1) { 
                state.focusSize = 150; 
                readingRuler.classList.add('mode-lantern'); 
            }
            if (state.focusMode === 2) { 
                state.focusSize = 25; 
                readingRuler.classList.add('mode-line'); 
            }
            
            readingRuler.style.setProperty('--focus-size', `${state.focusSize}px`);
            readingRuler.style.setProperty('--mouse-y', `${window.focusY}px`);
        };
    }

    document.querySelectorAll('.focus-size').forEach(btn => {
        btn.onclick = () => {
            const val = parseInt(btn.dataset.val, 10);
            state.focusSize = Math.max(10, Math.min(500, state.focusSize + val)); 
            readingRuler.style.setProperty('--focus-size', `${state.focusSize}px`);
        };
    });

    setupGlobalEvents();
}


function setupGlobalEvents() {
    window.addEventListener('keydown', handleKeydown, { capture: true });

    document.addEventListener('mouseup', () => { 
        if (state.annotationActive) applyAnnotation(); 
    });

    document.addEventListener('mousemove', (e) => {
        if (state.focusMode > 0) {
            window.focusY = e.clientY;
            const readingRuler = document.getElementById('reading-ruler');
            readingRuler.style.setProperty('--mouse-x', `${e.clientX}px`);
            readingRuler.style.setProperty('--mouse-y', `${window.focusY}px`);
        }
    }, { passive: true });

    window.addEventListener('wheel', event => {
        if (event.ctrlKey) { // ctrl + wheel -> increases/decreases zoom by 10%
            event.preventDefault();
            queueWheelZoom(event.deltaY > 0 ? -0.1 : 0.1);
            return;
        }

        if (event.shiftKey && state.focusMode > 0) { // shift + wheel -> increases focus size
            event.preventDefault();
            state.focusSize = event.deltaY > 0 ? Math.max(10, state.focusSize - 10) : Math.min(500, state.focusSize + 10);
            document.getElementById('reading-ruler').style.setProperty('--focus-size', `${state.focusSize}px`);
            return;
        }

        if (state.focusMode === 2) { // wheel -> in the ruler focus mode scrolls depending on focus size
            const ruler = document.getElementById('reading-ruler');
            const viewport = document.getElementById('viewport');
            if (ruler?.classList.contains('mode-line') && viewport) {
                event.preventDefault();
                viewport.scrollBy({
                    top: state.focusSize * Math.sign(event.deltaY) * 1.5,
                    // scroll do rato ligeiramente menor que o tamanho do foco para manter algum 
                    // texto do foco anterior e manter alguma continuidade (* 2.0 seria scroll igual ao foco)
                    behavior: 'auto'
                });
            }
        }
    }, { passive: false });

    header.addEventListener('wheel', event => { // when the header is too big to big to fit, it can be scrolled
        if (event.ctrlKey) return;
        event.preventDefault();
        header.scrollLeft += event.deltaX + event.deltaY
    }, { passive: false });
}

function handleKeydown(event) {
     if (event.ctrlKey && event.key.toLowerCase() === 'a') { //ctrl + 'a' -> selecionar o conteúdo do pdf inteiro, excluindo pagina e zoom
        if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') {
            return; 
        }

        event.preventDefault(); 
        const currentPage = getCurrentPageNumber();
        const textLayer = document.querySelector(`#page-wrapper-${currentPage} .textLayer`);
        
        if (textLayer) {
            const range = document.createRange();
            range.selectNodeContents(textLayer);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
        }
        return;
    }

    if (document.activeElement?.tagName === 'TEXTAREA' || document.activeElement?.tagName === 'INPUT') {
        if (event.key === 'Escape') document.activeElement.blur();
        return;
    }

    if (event.ctrlKey && event.key.toLowerCase() === 'f') { //ctrl + 'f' -> search
        event.preventDefault();
        if (typeof window.toggleWebSearch === 'function') window.toggleWebSearch();
        return;
    }
    
    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'z') { //ctrl + shift + 'z' -> redo
        event.preventDefault();
        redo();
        return;
    }

    if (event.ctrlKey && event.key.toLowerCase() === 'y') { //ctrl + 'y' -> redo
        event.preventDefault();
        redo();
        return;
    }

    if (event.ctrlKey && event.key.toLowerCase() === 'z') { //ctrl + 'z' -> undo
        event.preventDefault();
        undo();
        return;
    }

    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 's') { //ctrl + shift + 's' -> save file
        event.preventDefault();
        downloadNormal(true);
        return;
    }

    if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === 's') { //ctrl + 's' -> save as
        event.preventDefault();
        downloadNormal(false);
        return;
    }

    if (event.ctrlKey && ['+', '-', '=', '0'].includes(event.key)) { // zoom
        event.preventDefault();
        if (event.key === '+') updateZoom(state.currentScale + 0.1); //ctrl + '+' -> +10% zoom
        if (event.key === '-') updateZoom(state.currentScale - 0.1); // ctrl + '-' -> -10% zoom
        if (event.key === '0') updateZoom(1); //ctrl + '0' -> set zoom to 100%
        return;
    }
    
    if (event.key.toLowerCase() === 'h') cycleHeaderMode(); // 'h' -> clycles through header modes

    const currentPage = getCurrentPageNumber();

    if (event.key === 'ArrowRight' && !event.altKey) { // '→' + alt -> change index/pages sidebar to right side
        event.preventDefault();
        const next = Math.min(currentPage + 1, state.pdfDoc ? state.pdfDoc.numPages : currentPage + 1);
        const wrapper = document.getElementById(`page-wrapper-${next}`);
        const viewport = document.getElementById('viewport');
        if (wrapper && viewport) {
            pageInput.value = next;
            viewport.scrollTo({ top: wrapper.offsetTop - 42 });
        }
    }

    if (event.key === 'ArrowLeft' && !event.altKey) { // '←' + alt -> change index/pages sidebar to left side 
        event.preventDefault();
        const prev = Math.max(1, currentPage - 1);
        const wrapper = document.getElementById(`page-wrapper-${prev}`);
        const viewport = document.getElementById('viewport');
        if (wrapper && viewport) {
            pageInput.value = prev;
            viewport.scrollTo({ top: wrapper.offsetTop - 42, behavior: 'smooth' });
        }
    }

    if (event.key === 'ArrowDown') { // '↓' -> moves to the next page
        event.preventDefault();
        const ruler = document.getElementById('reading-ruler');
        if (ruler?.classList.contains('mode-line')) {
            document.getElementById('viewport').scrollBy({ top: getFocusLineHeight(ruler), behavior: 'smooth' });
        } else {
            const next = Math.min(currentPage + 1, state.pdfDoc ? state.pdfDoc.numPages : currentPage + 1);
            const wrapper = document.getElementById(`page-wrapper-${next}`);
            if (wrapper) { 
                pageInput.value = next; 
                document.getElementById('viewport').scrollTo({ top: wrapper.offsetTop - 42, behavior: 'smooth' });
            }
        }
    }

    if (event.key === 'ArrowUp') { // '↑' -> moves to the next page
        event.preventDefault();
        const ruler = document.getElementById('reading-ruler');
        if (ruler?.classList.contains('mode-line')) {
            document.getElementById('viewport').scrollBy({ top: -getFocusLineHeight(ruler), behavior: 'smooth' });
        } else {
            const prev = Math.max(1, currentPage - 1);
            const wrapper = document.getElementById(`page-wrapper-${prev}`);
            if (wrapper) { 
                pageInput.value = prev; 
                document.getElementById('viewport').scrollTo({ top: wrapper.offsetTop - 42, behavior: 'smooth' });
            }
        }
    }
}

function handleCopy(e, isLinux, btnElement) {
    e.preventDefault();
    
    const fileUrl = new URLSearchParams(window.location.search).get('file');
    if (fileUrl) {
        const finalPath = formatPath(fileUrl, isLinux);
        navigator.clipboard.writeText(finalPath);
        
        // Feedback: Verde para Windows, Azul para Linux
        const originalHTML = btnElement.innerHTML;
        const checkColor = isLinux ? '#80d8ff' : '#8be28b'; 
        btnElement.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="${checkColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
        
        setTimeout(() => { btnElement.innerHTML = originalHTML; }, 2000);
    }
}

function formatPath(rawUrl, isLinux) {
    let path = decodeURIComponent(rawUrl).replace(/^file:\/\/\/?/, '');

    if (path.startsWith('wsl.localhost/') || path.startsWith('wsl$/')) {
        if (isLinux) {
            const parts = path.split('/');
            return '/' + parts.slice(2).join('/');
        } else {
            return '\\\\' + path.replace(/\//g, '\\');
        }
    }

    const driveMatch = path.match(/^([a-zA-Z]):\/(.*)/);
    if (driveMatch) {
        if (isLinux) {
            const drive = driveMatch[1].toLowerCase();
            return `/mnt/${drive}/${driveMatch[2]}`;
        } else {
            return path.replace(/\//g, '\\');
        }
    }
    return path;
}

function cycleHeaderMode() {
    const modes = ['ghost', 'minimal', 'fixed'];
    setHeaderMode(modes[(modes.indexOf(state.headerMode) + 1) % modes.length]);
}

function getCurrentPageNumber() {
    const viewport = document.getElementById('viewport');
    const pageWrappers = [...document.querySelectorAll('.page-wrapper')];
    if (!pageWrappers.length) {
        const value = parseInt(pageInput.value, 10);
        return Number.isFinite(value) ? value : 1;
    }

    const viewportTop = viewport.getBoundingClientRect().top;
    let bestPage = 1;
    let bestDistance = Number.POSITIVE_INFINITY;

    pageWrappers.forEach(wrapper => {
        const rect = wrapper.getBoundingClientRect();
        const distance = Math.abs(rect.top - viewportTop);
        if (distance < bestDistance) {
            bestDistance = distance;
            bestPage = parseInt(wrapper.dataset.pageNumber, 10) || 1;
        }
    });

    return bestPage;
}

function getFocusLineHeight(ruler) {
    const value = parseFloat(getComputedStyle(ruler).getPropertyValue('--focus-line-height'));
    return Number.isFinite(value) ? value : 25;
}

function triggerExtensionDownload(blob, suggestedFilename, useSaveAs) {
     return new Promise((resolve) => {
        const url = URL.createObjectURL(blob);
        
        chrome.downloads.download({
            url: url,
            filename: suggestedFilename,
            saveAs: useSaveAs 
        }, (downloadId) => {
            if (chrome.runtime.lastError || !downloadId) {
                console.error("Download cancelado/com erro:", chrome.runtime.lastError);
                URL.revokeObjectURL(url);
                resolve(null);
                return;
            }

            const listener = (downloadDelta) => {
                if (downloadDelta.id === downloadId && downloadDelta.filename) {
                    chrome.downloads.onChanged.removeListener(listener);
                    URL.revokeObjectURL(url); // Limpa a RAM
                    
                    const fullPath = downloadDelta.filename.current;
                    const finalName = fullPath.split(/[\\/]/).pop(); 
                    resolve(finalName);
                } else if (downloadDelta.id === downloadId && downloadDelta.state && downloadDelta.state.current === 'interrupted') {
                     chrome.downloads.onChanged.removeListener(listener);
                     URL.revokeObjectURL(url);
                     resolve(null);
                }
            };
            chrome.downloads.onChanged.addListener(listener);
        });
    });
}

export function downloadNormal(requestSaveAs = false) {
    if (!state.pdfBytes) return;
    const blob = new Blob([state.pdfBytes], { type: 'application/pdf' });
    triggerExtensionDownload(blob, state.currentFilename || 'documento.pdf', requestSaveAs);
}

export async function downloadBurnIn() {
    if (!state.pdfBytes) return;

    try {
        const pdfDoc = await PDFDocument.load(state.pdfBytes);
        const pages = pdfDoc.getPages();
        
        const helveticaFont = await pdfDoc.embedFont(window.PDFLib.StandardFonts.Helvetica);
        
        const items = await new Promise(resolve => chrome.storage.local.get(null, resolve));
        const prefix = `${state.currentFilename}_pg`;

        for (let i = 0; i < pages.length; i++) {
            const pageNum = i + 1;
            const page = pages[i];
            const { width, height } = page.getSize();

            // a) highlights e sublinhados
            const annots = items[`${prefix}${pageNum}_annotations`] || [];
            annots.forEach(a => {
                const realX = (a.x / 100) * width;
                const realY = height - ((a.y / 100) * height) - ((a.height / 100) * height);
                const realW = (a.width / 100) * width;
                const realH = (a.height / 100) * height;

                const r = parseInt(a.color.slice(1,3), 16) / 255;
                const g = parseInt(a.color.slice(3,5), 16) / 255;
                const b = parseInt(a.color.slice(5,7), 16) / 255;

                if (a.mode === 'highlight') {
                    page.drawRectangle({ x: realX, y: realY, width: realW, height: realH, color: rgb(r, g, b), opacity: 0.4 });
                } else if (a.mode === 'underline') {
                    page.drawLine({ start: { x: realX, y: realY }, end: { x: realX + realW, y: realY }, color: rgb(r, g, b), thickness: a.size });
                }
            });

            // b) desenhos livres (corrigido!)
            const drawings = items[`${prefix}${pageNum}_drawings`] || [];
            drawings.forEach(d => {
                if (!d.path || d.path.length < 2) return;
                
                const r = parseInt(d.color.slice(1,3), 16) / 255;
                const g = parseInt(d.color.slice(3,5), 16) / 255;
                const b = parseInt(d.color.slice(5,7), 16) / 255;

                let svgPath = '';
                d.path.forEach((p, idx) => {
                    if (typeof p.x !== 'number' || typeof p.y !== 'number') return;
                    
                    const px = p.x * width;
                    const py = height - (p.y * height);
                    if (svgPath === '') svgPath += `M ${px} ${py} `;
                    else svgPath += `L ${px} ${py} `;
                });

                if (svgPath !== '') {
                    page.drawSvgPath(svgPath, {
                        borderColor: rgb(r, g, b),
                        borderWidth: Number(d.size) || 3,
                        borderLineCap: 1, 
                        borderLineJoin: 1
                    });
                }
            });

            // c) notas estilo "post-it"
            const notes = items[`${prefix}${pageNum}_notes`] || [];
            notes.forEach(n => {
                const rx = (n.x / 100) * width;
                const ry = height - ((n.y / 100) * height); 

                const rawText = n.text || "Nota Vazia";
                const words = rawText.replace(/\n/g, ' \n ').split(' ');
                let lines = [];
                let currentLine = '';

                words.forEach(word => {
                    if (word === '\n') {
                        lines.push(currentLine); currentLine = '';
                    } else if ((currentLine + word).length > 35) {
                        lines.push(currentLine); currentLine = word + ' ';
                    } else {
                        currentLine += word + ' ';
                    }
                });
                if (currentLine) lines.push(currentLine);

                const boxWidth = 180;
                const boxHeight = Math.max(40, lines.length * 14 + 20); 
                
                page.drawRectangle({
                    x: rx, y: ry - boxHeight, 
                    width: boxWidth, height: boxHeight,
                    color: rgb(0.99, 0.96, 0.6), 
                    borderColor: rgb(0.9, 0.7, 0), 
                    borderWidth: 1
                });

                lines.forEach((lineText, idx) => {
                    page.drawText(lineText.trim(), {
                        x: rx + 10, y: ry - 20 - (idx * 14), 
                        size: 10, font: helveticaFont, color: rgb(0.1, 0.1, 0.1)
                    });
                });
            });
        }

        const finalBytes = await pdfDoc.save();
        const blob = new Blob([finalBytes], { type: 'application/pdf' });
        
        const suggName = (state.currentFilename ? state.currentFilename.replace('.pdf', '') : 'documento') + '_anotado.pdf';
        
        await triggerExtensionDownload(blob, suggName, true); 

    } catch (e) {
        console.error("Erro ao gerar PDF com notas:", e);
        alert("Ocorreu um erro ao exportar as notas.");
    }
}

export async function downloadWithNotes() {
    if (!state.pdfBytes) return;

    const suggName = (state.currentFilename ? state.currentFilename.replace('.pdf', '') : 'documento') + '_copia.pdf';
    const blob = new Blob([state.pdfBytes], { type: 'application/pdf' });

    const finalChosenName = await triggerExtensionDownload(blob, suggName, true);
    
    if (finalChosenName && finalChosenName !== state.currentFilename) {
        const items = await new Promise(resolve => chrome.storage.local.get(null, resolve));
        const oldPrefix = `${state.currentFilename}_pg`;
        const newPrefix = `${finalChosenName}_pg`;
        
        const keysToRemove = [];
        const newStorage = {};
        let hasDataToCopy = false;

        Object.keys(items).forEach(key => {
            if (key.startsWith(newPrefix)) {
                keysToRemove.push(key);
            }
        });

        // Prepara as notas do documento ATUAL para serem copiadas para lá
        Object.keys(items).forEach(key => {
            if (key.startsWith(oldPrefix)) {
                const suffix = key.substring(oldPrefix.length); 
                newStorage[`${newPrefix}${suffix}`] = items[key];
                hasDataToCopy = true;
            }
        });

        // Apaga o lixo antigo e grava os novos no ficheiro de destino
        chrome.storage.local.remove(keysToRemove, () => {
            if (hasDataToCopy) {
                chrome.storage.local.set(newStorage, () => {
                    console.log(`Substituição/Cópia de Notas concluída para: ${finalChosenName}`);
                });
            }
        });
    }
}
