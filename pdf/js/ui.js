import { state } from './state.js';
import { saveState } from './storage.js';
import { applyAnnotation } from './annotations.js';
import { updateZoom, fitWidth, fitHeight } from './pdf-engine.js';
import { addNoteToUI } from './notes.js';
import { undo, redo } from './history.js';
import { setupDrawingTools } from './drawing.js';

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

    // Botões Extra
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