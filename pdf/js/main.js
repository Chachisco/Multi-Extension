import { state } from './state.js';
import { readViewerState } from './storage.js';
import { setupAnnotationOptions, loadAnnotationsForPage } from './annotations.js';
import { addNoteToUI } from './notes.js';
import { loadPDF, updateZoom } from './pdf-engine.js';
import { setupUI, setHeaderMode } from './ui.js';

const container = document.getElementById('pages-container');
const viewport = document.getElementById('viewport');
const fileInput = document.getElementById('file-input');

function setupNotes() {
    container.onclick = event => {
        if (event.target.closest('.sticky-note') || event.target.tagName === 'TEXTAREA') return;
        if (!event.ctrlKey) {
            document.querySelectorAll('.sticky-note.active').forEach(note => {
                if (!note.classList.contains('pinned')) note.classList.remove('active');
            });
            return;
        }
        const wrapper = event.target.closest('.page-wrapper');
        if (!wrapper) return;
        const rect = wrapper.getBoundingClientRect();
        addNoteToUI(wrapper.querySelector('.notes-overlay'), wrapper.dataset.pageNumber, ((event.clientX - rect.left) / rect.width) * 100, ((event.clientY - rect.top) / rect.height) * 100, '');
    };
    viewport.onclick = () => document.querySelectorAll('.sticky-note.active').forEach(note => {
        if (!note.classList.contains('pinned')) note.classList.remove('active');
    });
}

async function restoreViewerState() {
    const saved = await readViewerState();
    if (saved[state.currentFilename + '_zoom']) state.currentScale = saved[state.currentFilename + '_zoom'];
    if (Number.isFinite(saved[state.currentFilename + '_rotation'])) {
        state.pageRotation = saved[state.currentFilename + '_rotation'];
    }
    setHeaderMode(saved.global_header_mode || 'ghost');
    updateZoom(state.currentScale);
    if (saved[state.currentFilename]) {
        setTimeout(() => document.getElementById(`page-wrapper-${saved[state.currentFilename]}`)?.scrollIntoView(), 500);
    }
}

async function openSource(source, filename) {
    await loadPDF(source, filename);
    await restoreViewerState();
}

fileInput.onchange = async () => {
    const file = fileInput.files?.[0];
    if (file) {
        const buffer = await file.arrayBuffer();
        state.pdfBytes = buffer;
        await openSource(buffer.slice(0), file.name);
    }
};

async function init() {
    setupAnnotationOptions();
    setupUI();
    setupNotes();
    
    const fileUrl = new URLSearchParams(window.location.search).get('file');
    
    if (fileUrl) {
        const decodedUrl = decodeURIComponent(fileUrl);
        
        try {
            const filename = decodedUrl.split('/').pop().split(/[?#]/)[0] || "documento.pdf";
            await openSource(decodedUrl, filename);
            
            if (state.pdfDoc.annotationStorage.size > 0) {
                state.pdfBytes = await state.pdfDoc.saveDocument();
            } else {
                state.pdfBytes = await state.pdfDoc.getData();
            }
        } catch (error) {
            console.error("Erro ao carregar o PDF do URL:", error);
            alert("Não foi possível abrir o PDF. Se for um ficheiro do teu computador, vai a chrome://extensions e certifica-te que a opção 'Permitir acesso aos URLs dos ficheiros' está ativada nesta extensão!");
            fileInput.click();
        }
    } else {
        fileInput.click();
    }
}

init();