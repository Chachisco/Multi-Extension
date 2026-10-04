import { state } from './state.js';
import { saveState } from './storage.js';
import { addNoteToUI } from './notes.js';
import { undo, redo } from './history.js';
import { mergePDFs } from './pdf_editor.js';
import { setupDrawingTools } from './drawing.js';
import { applyAnnotation } from './annotations.js';
import { setupTextBoxes, createTextBox, activeTextBox, saveTextBoxesForPage } from './textboxes.js';
import { updateZoom, fitWidth, fitHeight, rotatePages } from './pdf-engine.js';
import * as PDFLib from '../lib/pdf_lib/pdf-lib.min.js';
const { PDFDocument, rgb, PDFName, PDFString, PDFHexString } = window.PDFLib || PDFLib;

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

function deactivateAllTools() {
    state.annotationActive = false;
    state.freehandActive = false;
    state.textModeActive = false;
    state.eraserActive = false;

    document.body.classList.remove('cursor-pen', 'cursor-eraser', 'cursor-text');

    document.getElementById('annotation-options')?.classList.add('hidden');
    document.getElementById('text-options')?.classList.add('hidden');
    
    ['btn-annotate', 'btn-draw', 'btn-text-box', 'btn-eraser'].forEach(id => {
        document.getElementById(id)?.classList.remove('tool-active');
    });
    
    document.querySelectorAll('.drawing-canvas').forEach(c => c.classList.remove('active'));
    document.querySelectorAll('.annotation-layer').forEach(l => l.classList.remove('eraser-active'));

    document.querySelectorAll('.opt-mode, .opt-mode-divider').forEach(el => el.style.display = '');
}

function toggleAnnotation() {
    const wasActive = state.annotationActive;
    deactivateAllTools();
    if (!wasActive) {
        state.annotationActive = true;
        document.body.classList.add('cursor-pen');
        document.getElementById('btn-annotate').classList.add('tool-active');
        document.getElementById('annotation-options').classList.remove('hidden');
    }
}

function toggleFreehand() {
    const wasActive = state.freehandActive;
    deactivateAllTools();
    if (!wasActive) {
        state.freehandActive = true;
        document.body.classList.add('cursor-pen');
        document.getElementById('btn-draw').classList.add('tool-active');
        
        document.querySelectorAll('.opt-mode, .opt-mode-divider').forEach(el => el.style.display = 'none');
        
        document.getElementById('annotation-options').classList.remove('hidden');
        document.querySelectorAll('.drawing-canvas').forEach(c => c.classList.add('active'));
    }
}

function toggleTextMode() {
    const wasActive = state.textModeActive;
    deactivateAllTools();
    if (!wasActive) {
        state.textModeActive = true;
        document.body.classList.add('cursor-text'); // Muda o rato
        document.getElementById('btn-text-box').classList.add('tool-active');
        document.getElementById('text-options').classList.remove('hidden');
    }
}

function toggleEraser() {
    const wasActive = state.eraserActive;
    deactivateAllTools();
    if (!wasActive) {
        state.eraserActive = true;
        document.body.classList.add('cursor-eraser'); // Muda o rato
        document.getElementById('btn-eraser').classList.add('tool-active');
        document.querySelectorAll('.annotation-layer').forEach(l => l.classList.add('eraser-active'));
    }
}

export function setupUI() {
    // Annotations
    document.getElementById('btn-annotate').onclick = toggleAnnotation;
    document.getElementById('btn-draw').onclick = toggleFreehand;
    document.getElementById('btn-text-box').onclick = toggleTextMode;
    document.getElementById('btn-eraser').onclick = toggleEraser;

    setupDrawingTools();
    setupTextBoxes();

    document.getElementById('opt-text-size').onchange = (e) => { state.currentTextSize = e.target.value; };

    container.addEventListener('click', event => {
        if (state.textModeActive && event.target.closest('.page-wrapper') && !event.target.closest('.free-text-box')) {
            const wrapper = event.target.closest('.page-wrapper');
            const rect = wrapper.getBoundingClientRect();
            const x = ((event.clientX - rect.left) / rect.width) * 100;
            const y = ((event.clientY - rect.top) / rect.height) * 100;
            const overlay = wrapper.querySelector('.textboxes-overlay');
            createTextBox(overlay, wrapper.dataset.pageNumber, x, y, '');
            // setTextModeActive(!state.textModeActive);
        }
    });
    
    document.getElementById('opt-text-size').onchange = (e) => { 
        state.currentTextSize = e.target.value; 
        if (activeTextBox) {
            activeTextBox.dataset.size = state.currentTextSize;
            activeTextBox.style.setProperty('--saved-font-size', `${state.currentTextSize}px`);
            const pageNum = activeTextBox.closest('.page-wrapper').dataset.pageNumber;
            saveTextBoxesForPage(pageNum, activeTextBox.parentElement);
        }
    };

    document.querySelectorAll('.opt-text-color').forEach(btn => {
        btn.onmousedown = (e) => e.preventDefault(); // Impede o botão de roubar o Focus da Caixa!
        btn.onclick = () => {
            document.querySelectorAll('.opt-text-color').forEach(i => i.classList.remove('active'));
            btn.classList.add('active');
            state.currentTextColor = btn.dataset.val;
            
            if (activeTextBox) {
                activeTextBox.dataset.color = state.currentTextColor;
                activeTextBox.querySelector('textarea').style.color = state.currentTextColor;
                const pageNum = activeTextBox.closest('.page-wrapper').dataset.pageNumber;
                saveTextBoxesForPage(pageNum, activeTextBox.parentElement);
            }
        };
    });
    
    document.querySelectorAll('.opt-text-align').forEach(btn => {
        btn.onmousedown = (e) => e.preventDefault();
        btn.onclick = () => {
            document.querySelectorAll('.opt-text-align').forEach(i => i.classList.remove('active'));
            btn.classList.add('active');
            state.currentTextAlign = btn.dataset.val;
            
            if (activeTextBox) {
                activeTextBox.dataset.align = state.currentTextAlign;
                activeTextBox.querySelector('textarea').style.textAlign = state.currentTextAlign;
                const pageNum = activeTextBox.closest('.page-wrapper').dataset.pageNumber;
                saveTextBoxesForPage(pageNum, activeTextBox.parentElement);
            }
        };
    });

    document.getElementById('opt-text-widget').onmousedown = (e) => e.preventDefault();
    document.getElementById('opt-text-widget').onclick = (e) => {
        state.currentTextIsWidget = !state.currentTextIsWidget;
        e.currentTarget.classList.toggle('active', state.currentTextIsWidget);
        
        if (activeTextBox) {
            activeTextBox.dataset.isWidget = state.currentTextIsWidget;
            activeTextBox.classList.toggle('is-widget', state.currentTextIsWidget);
            activeTextBox.querySelector('textarea').placeholder = state.currentTextIsWidget ? "Widget Editável" : "Escreve...";
            const pageNum = activeTextBox.closest('.page-wrapper').dataset.pageNumber;
            saveTextBoxesForPage(pageNum, activeTextBox.parentElement);
        }
    };
    
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
        jumpTo(val, { align: 'top' });
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
        document.getElementById('btn-dl-normal').onclick = () => downloadNormal(true);
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

    // ==========================================
    // Preview de burn-in
    // ==========================================
    const modalPreview = document.getElementById('modal-preview');
    const btnPreviewCancel = document.getElementById('btn-preview-cancel');
    const btnPreviewConfirm = document.getElementById('btn-preview-confirm');
    const noteRadios = document.querySelectorAll('input[name="note-export-type"]');

    if (noteRadios.length > 0) noteRadios.forEach(r => r.onchange = () => downloadBurnIn());

    if (btnPreviewCancel) {
        btnPreviewCancel.onclick = () => {
            modalPreview.classList.add('hidden');
            if (window.pendingPreviewUrl) URL.revokeObjectURL(window.pendingPreviewUrl);
            window.pendingBurnInBlob = null;
            window.pendingPreviewUrl = null;
        };
    }

    if (btnPreviewConfirm) {
        btnPreviewConfirm.onclick = async () => {
            modalPreview.classList.add('hidden');
            if (window.pendingBurnInBlob) {
                const finalChosenName = await triggerExtensionDownload(window.pendingBurnInBlob, window.pendingBurnInName, true);
                
                if (finalChosenName) {
                    await syncStorageToNewFile(state.currentFilename, finalChosenName, false);
                }
            }
            if (window.pendingPreviewUrl) URL.revokeObjectURL(window.pendingPreviewUrl);
            window.pendingBurnInBlob = null;
            window.pendingPreviewUrl = null;
        };
    }

    // ==========================================
    // Preview de referências
    // ==========================================
    const refPreview = document.getElementById('reference-preview');
    
    // 1. Botões de Ação
    document.getElementById('btn-close-ref')?.addEventListener('click', () => {
        refPreview.classList.add('hidden');
        document.body.classList.remove('split-mode'); // Desliga o lado-a-lado ao fechar
    });

    document.getElementById('btn-ref-prev')?.addEventListener('click', () => {
        if (window.currentPreviewPage > 1) window.showReferencePreview(window.currentPreviewPage - 1);
    });

    document.getElementById('btn-ref-next')?.addEventListener('click', () => {
        if (state.pdfDoc && window.currentPreviewPage < state.pdfDoc.numPages) {
            window.showReferencePreview(window.currentPreviewPage + 1);
        }
    });

    document.getElementById('btn-ref-zoom-in')?.addEventListener('click', () => {
        window.currentPreviewScale = Math.min(5.0, window.currentPreviewScale + 0.25);
        window.showReferencePreview(window.currentPreviewPage);
    });

    document.getElementById('btn-ref-zoom-out')?.addEventListener('click', () => {
        window.currentPreviewScale = Math.max(0.5, window.currentPreviewScale - 0.25);
        window.showReferencePreview(window.currentPreviewPage);
    });

    document.getElementById('btn-ref-split')?.addEventListener('click', () => {
        document.body.classList.toggle('split-mode');
    });

    const resizers = document.querySelectorAll('#reference-preview > [class^="resizer"]');
    let isResizing = false; 
    let origW = 0, origH = 0, origX = 0, origY = 0, currResizer = null;

    if (resizers.length > 0 && refPreview) {
        resizers.forEach(resizer => {
            resizer.addEventListener('mousedown', (e) => {
                e.preventDefault();
                isResizing = true;
                currResizer = resizer.className;
                origW = refPreview.getBoundingClientRect().width;
                origH = refPreview.getBoundingClientRect().height;
                origX = e.pageX;
                origY = e.pageY;
                refPreview.style.transition = 'none';
            });
        });

        window.addEventListener('mousemove', (e) => {
            if (!isResizing || document.body.classList.contains('split-mode')) return; // Bloqueia resize manual se estiver lado-a-lado
            
            if (currResizer.includes('left')) {
                const newWidth = origW + (origX - e.pageX);
                if (newWidth > 300) refPreview.style.width = newWidth + 'px';
            }
            if (currResizer.includes('top')) {
                const newHeight = origH + (origY - e.pageY);
                if (newHeight > 400) refPreview.style.height = newHeight + 'px';
            }
        });

        window.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                refPreview.style.transition = 'opacity 0.2s, transform 0.2s';
            }
        });
    }

    setupGlobalEvents();
} 


function setupGlobalEvents() {
    window.addEventListener('keydown', handleKeydown, { capture: true });

    window.isShiftPressed = false;
    window.addEventListener('keydown', e => { if (e.key === 'Shift') window.isShiftPressed = true; });
    window.addEventListener('keyup', e => { if (e.key === 'Shift') window.isShiftPressed = false; });
    window.addEventListener('blur', () => { window.isShiftPressed = false; });

    document.addEventListener('mousedown', (e) => {
        if (window.isShiftPressed) {
            let target = e.target;
            if (target.tagName !== 'A' && target.parentElement?.tagName === 'A') {
                target = target.parentElement;
            }
            if (target.tagName === 'A') {
                window.lastClickedLinkText = target.innerText || target.textContent || "";
            }
        }
    });

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
        if (event.ctrlKey) {
            event.preventDefault();
            queueWheelZoom(event.deltaY > 0 ? -0.1 : 0.1);
            return;
        }

        if (event.shiftKey && state.focusMode > 0) {
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
                    top: state.focusSize * Math.sign(event.deltaY) * 1.2,
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
    const isTyping = document.activeElement?.tagName === 'INPUT' || 
                     document.activeElement?.tagName === 'TEXTAREA' || 
                     document.activeElement?.isContentEditable;
     if (event.ctrlKey && event.key.toLowerCase() === 'a') { //ctrl + 'a' -> selecionar o conteúdo do pdf inteiro, excluindo pagina e zoom
        if (isTyping) return;

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

    if (isTyping) {
        if (event.key === 'Escape') document.activeElement.blur();
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

    if (event.key === 'ArrowDown') { // '↓' -> moves to the next page
        event.preventDefault();
        const ruler = document.getElementById('reading-ruler');
        if (ruler?.classList.contains('mode-line')) {
            document.getElementById('viewport').scrollBy({ top: getFocusLineHeight(ruler), behavior: 'smooth' });
        } else {
            const next = Math.min(currentPage + 1, state.pdfDoc ? state.pdfDoc.numPages : currentPage + 1);
            jumpTo(next, { align: 'top' });
        }
    }

    if (event.key === 'ArrowUp') { // '↑' -> moves to the next page
        event.preventDefault();
        const ruler = document.getElementById('reading-ruler');
        if (ruler?.classList.contains('mode-line')) {
            document.getElementById('viewport').scrollBy({ top: -getFocusLineHeight(ruler), behavior: 'smooth' });
        } else {
            const prev = Math.max(1, currentPage - 1);
            jumpTo(next, { align: 'top' });
        }
    }
    if (event.key === 'ArrowRight' && !event.altKey){
        event.preventDefault();
        if (state.focusMode === 2) { 
            const ruler = document.getElementById('reading-ruler');
            const viewport = document.getElementById('viewport');
            
            if (ruler?.classList.contains('mode-line') && viewport) {
                viewport.scrollBy({
                    top: state.focusSize * 1.2, 
                    behavior: 'auto'
                });
            }
        }
        else {
            const next = Math.min(currentPage + 1, state.pdfDoc ? state.pdfDoc.numPages : currentPage + 1);
            jumpTo(next, { align: 'top' });
        }
    }
    if (event.key === 'ArrowLeft' && !event.altKey){
        event.preventDefault();

        if (state.focusMode === 2) { 
            const ruler = document.getElementById('reading-ruler');
            const viewport = document.getElementById('viewport');
            
            if (ruler?.classList.contains('mode-line') && viewport) {
                viewport.scrollBy({
                    top: state.focusSize * -1.45,
                    behavior: 'auto'
                });
            }
        } else {
            const prev = Math.max(1, currentPage - 1);
            jumpTo(prev, { align: 'top' });
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
        let safeName = suggestedFilename.replace(/[<>:"\/\\|?*]+/g, '_');
        let finalSuggestedName = safeName;
        if (!finalSuggestedName.toLowerCase().endsWith('.pdf')) {
            finalSuggestedName += '.pdf';
        }
        const url = URL.createObjectURL(blob);
        
        chrome.downloads.download({
            url: url,
            filename: finalSuggestedName,
            saveAs: useSaveAs
        }, (downloadId) => {
            if (chrome.runtime.lastError || !downloadId) {
                console.error("Download cancelado/com erro:", chrome.runtime.lastError.message);
                URL.revokeObjectURL(url);
                resolve(null);
                return;
            }

            const listener = (downloadDelta) => {
                if (downloadDelta.id === downloadId && downloadDelta.filename) {
                    chrome.downloads.onChanged.removeListener(listener);
                    URL.revokeObjectURL(url); 
                    
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


async function syncStorageToNewFile(oldFilename, newFilename, copyNotesOver) {
    if (!oldFilename || !newFilename) return;
    
    const items = await new Promise(resolve => chrome.storage.local.get(null, resolve));
    
    const oldPrefix = `${oldFilename}_pg`;
    const newPrefix = `${newFilename}_pg`; 
    
    const keysToRemove = [];
    const newStorage = {};

    Object.keys(items).forEach(key => {
        if (key.startsWith(newPrefix)) keysToRemove.push(key);
    });

    if (copyNotesOver) {
        Object.keys(items).forEach(key => {
            if (key.startsWith(oldPrefix)) {
                const suffix = key.substring(oldPrefix.length);
                newStorage[`${newPrefix}${suffix}`] = items[key];
            }
        });
    }

    chrome.storage.local.remove(keysToRemove, () => {
        if (Object.keys(newStorage).length > 0) {
            chrome.storage.local.set(newStorage, () => console.log(`Storage sincronizado para: ${newFilename}`));
        } else {
            console.log(`Storage limpo com sucesso para: ${newFilename}`);
        }
    });
}

export async function downloadNormal(requestSaveAs = false) {
    if (!state.pdfDoc) return;
    
    const data = state.pdfDoc.annotationStorage.size > 0 
        ? await state.pdfDoc.saveDocument() 
        : await state.pdfDoc.getData();
        
    const blob = new Blob([data], { type: 'application/pdf' });
    const safeName = document.title !== 'UniPDF Pro' ? document.title : 'document.pdf';
    
    const finalName = await triggerExtensionDownload(blob, safeName, requestSaveAs);

    if (finalName && finalName !== state.currentFilename) {
        const shouldCopyNotes = !requestSaveAs;
        await syncStorageToNewFile(state.currentFilename, finalName, shouldCopyNotes);
        
        if (shouldCopyNotes) {
            state.currentFilename = finalName;
            document.title = finalName;
        }
    }
}

export async function downloadBurnIn() {
    if (!state.pdfBytes) return;

    try {
        let baseData;
        if (state.pdfDoc.annotationStorage.size > 0) {
            baseData = await state.pdfDoc.saveDocument();
        } else {
            baseData = await state.pdfDoc.getData();
        }

        const pdfDoc = await PDFDocument.load(baseData);
        const pages = pdfDoc.getPages();
        const helveticaFont = await pdfDoc.embedFont(window.PDFLib.StandardFonts.Helvetica);
        const items = await new Promise(resolve => chrome.storage.local.get(null, resolve));
        const prefix = `${state.currentFilename}_pg`;

        for (let i = 0; i < pages.length; i++) {
            const pageNum = i + 1;
            const page = pages[i];
            const { width, height } = page.getSize();

            // a) highlights
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

            // b) desenhos livres
            const drawings = items[`${prefix}${pageNum}_drawings`] || [];
            drawings.forEach(d => {
                if (!d.path || d.path.length < 2) return;
                const r = parseInt(d.color.slice(1,3), 16) / 255;
                const g = parseInt(d.color.slice(3,5), 16) / 255;
                const b = parseInt(d.color.slice(5,7), 16) / 255;

                const validPoints = d.path.filter(p => typeof p.x === 'number' && typeof p.y === 'number' && !isNaN(p.x) && !isNaN(p.y));
                if (validPoints.length < 2) return;

                for (let j = 0; j < validPoints.length - 1; j++) {
                    const p1 = validPoints[j];
                    const p2 = validPoints[j + 1];
                    
                    page.drawLine({
                        start: { x: p1.x * width, y: height - (p1.y * height) },
                        end:   { x: p2.x * width, y: height - (p2.y * height) },
                        color: rgb(r, g, b),
                        thickness: Number(d.size) || 3
                    });
                }
            });

            // c) notas estilo "post-it"
            const exportType = document.querySelector('input[name="note-export-type"]:checked')?.value || 'native';
            const notes = items[`${prefix}${pageNum}_notes`] || [];
            
            notes.forEach(n => {
                if (n.exportable === false) return;

                const rx = (n.x / 100) * width;
                const ry = height - ((n.y / 100) * height); 
                const rawText = n.text || "Nota Vazia";

                if (exportType === 'native') {
                    let hexString = 'FEFF';
                    for (let i = 0; i < rawText.length; i++) {
                        hexString += ('0000' + rawText.charCodeAt(i).toString(16)).slice(-4);
                    }

                    let authorString = 'FEFF';
                    const authorName = "User PDF viewer";
                    for (let i = 0; i < authorName.length; i++) {
                        authorString += ('0000' + authorName.charCodeAt(i).toString(16)).slice(-4);
                    }

                    const annotObj = pdfDoc.context.obj({
                        Type: 'Annot',
                        Subtype: 'Text',
                        Rect: [rx, ry - 20, rx + 20, ry],
                        Contents: PDFHexString.of(hexString),
                        T: PDFHexString.of(authorString),
                        C: [0.99, 0.96, 0.2],
                        Name: PDFName.of('Comment'),
                        Open: false
                    });

                    const annotRef = pdfDoc.context.register(annotObj);
                    let annotsArray = page.node.get(PDFName.of('Annots'));
                    if (!annotsArray) {
                        annotsArray = pdfDoc.context.obj([]);
                        page.node.set(PDFName.of('Annots'), annotsArray);
                    }
                    annotsArray.push(annotRef);
                }
                else if (exportType === 'draw') {
                    const words = rawText.replace(/\n/g, ' \n ').split(' ');
                    let lines = [];
                    let currentLine = '';

                    words.forEach(word => {
                        if (word === '\n') { lines.push(currentLine); currentLine = ''; } 
                        else if ((currentLine + word).length > 35) { lines.push(currentLine); currentLine = word + ' '; } 
                        else { currentLine += word + ' '; }
                    });
                    if (currentLine) lines.push(currentLine);

                    let maxTextWidth = 0;
                    lines.forEach(l => {
                        const textWidth = helveticaFont.widthOfTextAtSize(l.trim(), 10);
                        if (textWidth > maxTextWidth) maxTextWidth = textWidth;
                    });

                    const boxWidth = Math.max(70, maxTextWidth + 20);
                    const boxHeight = Math.max(30, lines.length * 14 + 16); 
                    
                    page.drawRectangle({
                        x: rx, y: ry - 10 - boxHeight, 
                        width: boxWidth, height: boxHeight,
                        color: rgb(0.99, 0.96, 0.6), borderColor: rgb(0.9, 0.7, 0), 
                        borderWidth: 1, opacity: 0.85, borderOpacity: 0.95
                    });
                    lines.forEach((lineText, idx) => {
                        page.drawText(lineText.trim(), {
                            x: rx + 10, y: ry - 25 - (idx * 14), 
                            size: 10, font: helveticaFont, color: rgb(0.1, 0.1, 0.1)
                        });
                    });
                }
            });

            // d) caixas de texto
            const textboxes = items[`${prefix}${pageNum}_textboxes`] || [];
            
            // Só pedimos acesso aos formulários globais do PDF se precisarmos deles!
            let form = null;
            if (textboxes.some(tb => tb.isWidget)) {
                form = pdfDoc.getForm() || pdfDoc.addForm();
            }

            textboxes.forEach(tb => {
                const rx = (tb.x / 100) * width;
                const ry = height - ((tb.y / 100) * height); 
                const realW = parseFloat(tb.width);
                const realH = parseFloat(tb.height);
                
                const r = parseInt(tb.color.slice(1,3), 16) / 255;
                const g = parseInt(tb.color.slice(3,5), 16) / 255;
                const b = parseInt(tb.color.slice(5,7), 16) / 255;
                
                if (tb.isWidget) {
                    const textField = form.createTextField(`widget_${Date.now()}_${Math.random()}`);
                    textField.setText(tb.text || '');
                    
                    if (tb.align === 'center') textField.setAlignment(window.PDFLib.TextAlignment.Center);
                    else if (tb.align === 'right') textField.setAlignment(window.PDFLib.TextAlignment.Right);

                    textField.addToPage(page, {
                        x: rx, y: ry - realH, width: realW, height: realH,
                        textColor: rgb(r, g, b),
                        borderColor: rgb(0,0,0),
                        borderWidth: 1
                    });
                    
                } else {
                    if (!tb.text || tb.text.trim() === '') return;
                    const lines = tb.text.split('\n');
                    
                    lines.forEach((lineText, idx) => {
                        const fontSize = Number(tb.size) || 12;
                        const textW = helveticaFont.widthOfTextAtSize(lineText, fontSize);
                        
                        let drawX = rx + 4; // margin-left
                        if (tb.align === 'center') drawX = rx + (realW / 2) - (textW / 2);
                        if (tb.align === 'right') drawX = rx + realW - textW - 4;

                        page.drawText(lineText, {
                            x: drawX, 
                            y: ry - fontSize - 2 - (idx * (fontSize * 1.2)), 
                            size: fontSize, font: helveticaFont, color: rgb(r, g, b)
                        });
                    });
                }
            });
        }

        const finalBytes = await pdfDoc.save();
        const blob = new Blob([finalBytes], { type: 'application/pdf' });
        const safeName = document.title !== 'UniPDF Pro' ? document.title : 'document.pdf';
        const previewUrl = URL.createObjectURL(blob);
        window.pendingBurnInBlob = blob;
        window.pendingBurnInName = safeName;
        window.pendingPreviewUrl = previewUrl;
        
        document.getElementById('preview-iframe').src = previewUrl + '#toolbar=1&navpanes=1&view=FitH';
        document.getElementById('modal-preview').classList.remove('hidden');

    } catch (e) {
        console.error("Erro ao gerar PDF com notas:", e);
        alert("Ocorreu um erro ao exportar as notas.");
    }
}


export async function downloadWithNotes() {
    if (!state.pdfBytes) return;
    const data = await state.pdfDoc.saveDocument();
    const blob = new Blob([data], { type: 'application/pdf' });
    const safeName = document.title !== 'UniPDF Pro' ? `Exportado_${document.title}` : 'Exportado_document.pdf';
    
    const finalChosenName = await triggerExtensionDownload(blob, safeName, true);
    
    if (finalChosenName) {
        await syncStorageToNewFile(state.currentFilename, finalChosenName, true);
    }
}
