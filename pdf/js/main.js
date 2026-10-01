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

        const uniqueId = `${file.name}_${file.size}`;
        state.currentFilename = uniqueId; 

        await openSource(buffer.slice(0), file.name);
    }
};

async function openLocalFile() {
    try {
        const [handle] = await window.showOpenFilePicker({
            types: [{ description: 'Documentos PDF', accept: { 'application/pdf': ['.pdf'] } }]
        });
        
        const file = await handle.getFile();
        const buffer = await file.arrayBuffer();

        state.fileHandle = handle; 
        state.originalFilename = file.name;
        state.currentFilename = `${file.name}_${file.size}`;
        state.pdfBytes = buffer;

        await openSource(buffer.slice(0), file.name);
    } catch (err) {
        if (err.name !== 'AbortError') console.error("Erro ao abrir ficheiro:", err);
    }
}

async function init() {
    setupAnnotationOptions();
    setupUI();
    setupNotes();
    
    const fileUrl = new URLSearchParams(window.location.search).get('file');
    
    if (fileUrl) {
        const decodedUrl = decodeURIComponent(fileUrl);
        
        try {
            const isLocalBlob = decodedUrl.startsWith('blob:');
            const uniqueId = isLocalBlob ? 'documento_local_temp' : decodedUrl;
            
            state.currentFilename = uniqueId;

            const filename = decodedUrl.split('/').pop().split(/[?#]/)[0] || "documento.pdf";
            await openSource(decodedUrl, filename);
            
            if (state.pdfDoc.annotationStorage.size > 0) {
                state.pdfBytes = await state.pdfDoc.saveDocument();
            } else {
                state.pdfBytes = await state.pdfDoc.getData();
            }
        } catch (error) {
            console.error("Erro ao carregar o PDF do URL:", error);
            
            const choice = confirm(
                "Erro ao carregar o pdf, continuar sem extensão?.\n\n" +
                "• Pressiona [OK] para abrir o link sem a extensão.\n" +
                "• Pressiona [Cancelar] para escolheres um ficheiro local."
            );

            if (choice) {
                const separator = decodedUrl.includes('?') ? '&' : '?';
                window.location.href = decodedUrl + separator + "bypass_ext=true";
            } else {
                openLocalFile(); 
            }
        }
    } else {
        openLocalFile();
    }
}

function showFallbackScreen(originalUrl) {
    const overlay = document.createElement('div');
    overlay.style.cssText = "position:fixed; top:0; left:0; width:100vw; height:100vh; background:#252526; z-index:9999; display:flex; flex-direction:column; align-items:center; justify-content:center; color:white; font-family:sans-serif;";
    
    const title = document.createElement('h2');
    title.textContent = originalUrl ? "Acesso Bloqueado pelo Site" : "UniPDF Pro";
    title.style.marginBottom = "10px";
    
    const msg = document.createElement('p');
    msg.textContent = originalUrl 
        ? "O site (CORS/Cloudflare) impediu a extensão de carregar o PDF de forma invisível." 
        : "Nenhum documento aberto. Escolhe um ficheiro do teu computador.";
    msg.style.marginBottom = "30px";
    msg.style.color = "#bbb";

    const btnContainer = document.createElement('div');
    btnContainer.style.display = "flex";
    btnContainer.style.gap = "15px";

    // BOTÃO 1: Abrir ficheiro do PC (Como é um clique real, o browser já deixa abrir a janela!)
    const btnLocal = document.createElement('button');
    btnLocal.textContent = "Abrir ficheiro do PC";
    btnLocal.style.cssText = "padding:10px 20px; font-size:14px; cursor:pointer; background:#0376db; color:white; border:none; border-radius:4px; font-weight:bold;";
    btnLocal.onclick = () => {
        overlay.remove();
        openLocalFile();
    };
    btnContainer.appendChild(btnLocal);

    // BOTÃO 2: Abrir link original (Apenas se viermos de um URL)
    if (originalUrl) {
        const btnWeb = document.createElement('button');
        btnWeb.textContent = "Abrir link no Browser";
        btnWeb.style.cssText = "padding:10px 20px; font-size:14px; cursor:pointer; background:#555; color:white; border:none; border-radius:4px; font-weight:bold;";
        btnWeb.onclick = () => {
            // A MAGIA ANTI-LOOP: Adicionamos a tag bypass_ext=true
            const separator = originalUrl.includes('?') ? '&' : '?';
            window.location.href = originalUrl + separator + 'bypass_ext=true';
        };
        btnContainer.appendChild(btnWeb);
    }

    overlay.appendChild(title);
    overlay.appendChild(msg);
    overlay.appendChild(btnContainer);
    document.body.appendChild(overlay);
}



init();