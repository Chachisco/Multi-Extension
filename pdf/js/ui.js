import { state } from './state.js';
import { saveState } from './storage.js';
import { applyAnnotation, undoAnnotation } from './annotations.js';
import { updateZoom, fitWidth, fitHeight } from './pdf-engine.js';
import { addNoteToUI } from './notes.js';

const header = document.getElementById('mini-header');
const zoomInput = document.getElementById('zoom-percent');
const pageInput = document.getElementById('page-input');
const container = document.getElementById('pages-container');

export function setHeaderMode(mode) {
    state.headerMode = mode;
    header.className = `mode-${mode}`;
    header.classList.toggle('annotation-active', state.annotationActive);
    header.classList.toggle('eraser-active', state.eraserActive);
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
    if (active) state.eraserActive = false;
    document.getElementById('annotation-options').classList.toggle('hidden', !active);
    header.classList.toggle('annotation-active', state.annotationActive);
    header.classList.toggle('eraser-active', state.eraserActive);
    document.getElementById('btn-annotate').classList.toggle('tool-active', state.annotationActive);
    document.getElementById('btn-eraser').classList.toggle('tool-active', state.eraserActive);
    document.querySelectorAll('.annotation-layer').forEach(layer => layer.classList.toggle('eraser-active', state.eraserActive));
}

export function setupUI() {
    document.getElementById('btn-annotate').onclick = () => setAnnotationActive(!state.annotationActive);
    document.getElementById('btn-eraser').onclick = () => {
        state.eraserActive = !state.eraserActive;
        if (state.eraserActive) state.annotationActive = false;
        setAnnotationActive(state.annotationActive);
    };
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
    document.getElementById('lateral-slider').oninput = event => { container.style.transform = `translateX(${event.target.value * 10}px)`; };
    document.addEventListener('mouseup', () => { if (state.annotationActive) applyAnnotation(); });
    window.addEventListener('keydown', handleKeydown, { capture: true });
    window.addEventListener('wheel', event => {
        if (!event.ctrlKey) return;
        event.preventDefault();
        updateZoom(state.currentScale + (event.deltaY > 0 ? -0.1 : 0.1));
    }, { passive: false });

    const btnCopy = document.getElementById('btn-copy-url');
    if (btnCopy) {
        // Clique Esquerdo: Se tiver o Ctrl premido (e.ctrlKey) é Linux, senão é Windows.
        btnCopy.onclick = (e) => handleCopy(e, e.ctrlKey, btnCopy);
        
        // Clique Direito: Sempre Linux (WSL)
        btnCopy.oncontextmenu = (e) => handleCopy(e, true, btnCopy); 
    }

    const btnAddNote = document.getElementById('btn-add-note');
    if (btnAddNote) {
        btnAddNote.onclick = () => {
            const currentPg = parseInt(pageInput.value, 10);
            const overlay = document.querySelector(`#page-wrapper-${currentPg} .notes-overlay`);
            if (overlay) {
                addNoteToUI(overlay, currentPg, 50, 10, '', false);
            }
        };
    }

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

    const btnFullscreen = document.getElementById('btn-fullscreen');
    if (btnFullscreen) {
        btnFullscreen.onclick = () => {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen().catch(err => {
                    console.log(`Erro ao ativar Fullscreen: ${err.message}`);
                });
            } else {
                document.exitFullscreen();
            }
        };
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

function handleKeydown(event) {
    if (document.activeElement?.tagName === 'TEXTAREA' || document.activeElement?.tagName === 'INPUT') {
        if (event.key === 'Escape') document.activeElement.blur();
        return;
    }

    if (event.ctrlKey && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        if (typeof window.toggleWebSearch === 'function') {
            window.toggleWebSearch();
        }
        return;
    }
    
    if (event.ctrlKey && event.key.toLowerCase() === 'z') {
        if (undoAnnotation()) event.preventDefault();
        return;
    }

    if (event.ctrlKey && ['+', '-', '=', '0'].includes(event.key)) {
        event.preventDefault();
        if (event.key === '+' || event.key === '=') updateZoom(state.currentScale + 0.1);
        if (event.key === '-') updateZoom(state.currentScale - 0.1);
        if (event.key === '0') updateZoom(1);
        return;
    }
    if (event.key.toLowerCase() === 'h') cycleHeaderMode();

    const currentPage = getCurrentPageNumber();

    if (event.key === 'ArrowRight') {
        event.preventDefault();
        const next = Math.min(currentPage + 1, state.pdfDoc ? state.pdfDoc.numPages : currentPage + 1);
        const wrapper = document.getElementById(`page-wrapper-${next}`);
        const viewport = document.getElementById('viewport');
        if (wrapper && viewport) {
            pageInput.value = next;
            const y = wrapper.offsetTop - 42;
            viewport.scrollTo({ top: y });
        }
    }

    if (event.key === 'ArrowLeft') {
        event.preventDefault();
        const prev = Math.max(1, currentPage - 1);
        const wrapper = document.getElementById(`page-wrapper-${prev}`);
        const viewport = document.getElementById('viewport');
        if (wrapper && viewport) {
            pageInput.value = prev;
            const y = wrapper.offsetTop - 42;
            viewport.scrollTo({ top: y, behavior: 'smooth' });
        }
    }
}