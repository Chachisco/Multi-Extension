import { state } from './state.js';
import { readViewerState } from './storage.js';
import { setupAnnotationOptions, loadAnnotationsForPage } from './annotations.js';
import { addNoteToUI } from './notes.js';
import { loadPDF, updateZoom } from './pdf-engine.js';
import { setupUI, setHeaderMode, showNotification } from './ui.js';
import { addBookmarkToUI, saveBookmarksForPage } from './bookmarks.js'
import { jumpTo } from './utils.js';

const container = document.getElementById('pages-container');
const viewport = document.getElementById('viewport');
const fileInput = document.getElementById('file-input');
let fallbackOverlay = null;

function setupNotes() {
    let startX = 0;
    let startY = 0;

    container.addEventListener('mousedown', (event) => {
        startX = event.clientX;
        startY = event.clientY;
    });

    container.addEventListener('mouseup', event => {
        // Calcula a distância que o rato percorreu (teorema de Pitágoras ou distância simples)
        const travelX = Math.abs(event.clientX - startX);
        const travelY = Math.abs(event.clientY - startY);
        
        // Se viajou mais de 5 píxeis, é porque o utilizador estava a selecionar texto ou a arrastar!
        // Ignora imediatamente a criação de notas ou bookmarks!
        if (travelX > 5 || travelY > 5) return;
        // Ignora cliques que não sejam Ctrl ou Shift
        if (!event.ctrlKey && !event.shiftKey) {
            // Fecha notas/popups abertos
            document.querySelectorAll('.sticky-note.active').forEach(note => {
                if (!note.classList.contains('pinned')) note.classList.remove('active');
            });
            document.querySelectorAll('.bookmark-popup').forEach(p => p.classList.add('hidden'));
            return;
        }

        const wrapper = event.target.closest('.page-wrapper');
        if (!wrapper) return;
        const rect = wrapper.getBoundingClientRect();
        const x = ((event.clientX - rect.left) / rect.width) * 100;
        const y = ((event.clientY - rect.top) / rect.height) * 100;
        
        if (event.shiftKey) {
            const selectionObj = window.getSelection();
            const selectionText = selectionObj.toString().trim();
            const suggestedTitle = selectionText ? selectionText.substring(0, 30) : '';
            
            let targetY = y;
            if (selectionText && selectionObj.rangeCount > 0) {
                const range = selectionObj.getRangeAt(0);
                const rect = range.getClientRects()[0];
                if (rect) {
                    const wrapperRect = wrapper.getBoundingClientRect();
                    targetY = ((rect.top - wrapperRect.top) / wrapperRect.height) * 100;
                }
            }
            
            const bookmarksOverlay = wrapper.querySelector('.bookmarks-overlay');
            addBookmarkToUI(bookmarksOverlay, wrapper.dataset.pageNumber, x, targetY, suggestedTitle, 'bookmark');
            saveBookmarksForPage(wrapper.dataset.pageNumber, bookmarksOverlay);
            window.getSelection().removeAllRanges();
            return;
        }

        // Se Ctrl + Click -> Cria Nota!
        if (event.ctrlKey && !event.target.closest('.sticky-note')) {
            addNoteToUI(wrapper.querySelector('.notes-overlay'), wrapper.dataset.pageNumber, '', x, y);
        }
    });
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
        setTimeout(() => jumpTo(saved[state.currentFilename], { align: 'top' }), 500);
    }
}

async function openSource(source, filename) {
    await loadPDF(source, filename);
    await restoreViewerState();
}

fileInput.onchange = async () => {
    const file = fileInput.files?.[0];
    if (!file) return;

    try {
        const buffer = await file.arrayBuffer();
        state.pdfBytes = buffer;
        state.currentFilename = `${file.name}_${file.size}`;
        await openSource(buffer.slice(0), file.name);
        hideFallbackScreen();
    } catch (error) {
        console.error("Erro ao abrir ficheiro:", error);
        showNotification(`Não foi possível abrir o ficheiro: ${error.message || error}`, 'error');
        showFallbackScreen(null, "Não foi possível abrir este ficheiro. Escolhe outro PDF.");
    }
};

async function openLocalFile() {
    fileInput.value = '';
    fileInput.click();
}

async function init() {
    setupAnnotationOptions();
    setupUI();
    setupNotes();
    
    const fileUrl = new URLSearchParams(window.location.search).get('file');
    
    if (fileUrl) {
        let decodedUrl = fileUrl;
        
        try {
            decodedUrl = decodeURIComponent(fileUrl);
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
            try {
                const { PDFDocument } = window.PDFLib || PDFLib;
                const tempPdf = await PDFDocument.load(state.pdfBytes, { ignoreEncryption: true });
                const form = tempPdf.getForm();
                state.isSigned = form && form.getFields().some(f => f.constructor.name.includes('Signature'));
                
                if (state.isSigned) {
                    showNotification("Documento com Assinatura Digital detetado. Algumas ações foram bloqueadas.", "warning");
                }
            } catch(e) {
                console.warn("Não foi possível verificar assinaturas:", e);
                showNotification("Não foi possível verificar a assinatura digital do documento.", 'warning');
            }
        } catch (error) {
            console.error("Erro ao carregar o PDF do URL:", error);
            showNotification(`Não foi possível carregar o PDF: ${error.message || error}`, 'error');
            showFallbackScreen(decodedUrl, "Não foi possível carregar este PDF. Podes escolher outro ficheiro ou abrir o link no navegador.");
        }
    } else {
        showFallbackScreen();
    }
}

function hideFallbackScreen() {
    fallbackOverlay?.remove();
    fallbackOverlay = null;
}

function showFallbackScreen(originalUrl = null, message = null) {
    if (fallbackOverlay) {
        fallbackOverlay.querySelector('p').textContent = message || (originalUrl
            ? "O site (CORS/Cloudflare) impediu a extensão de carregar o PDF de forma invisível."
            : "Nenhum documento aberto. Escolhe um ficheiro do teu computador.");
        return;
    }

    const overlay = document.createElement('div');
    overlay.style.cssText = "position:fixed; top:0; left:0; width:100vw; height:100vh; background:#252526; z-index:9999; display:flex; flex-direction:column; align-items:center; justify-content:center; color:white; font-family:sans-serif;";
    
    const title = document.createElement('h2');
    title.textContent = originalUrl ? "Ocorreu um erro ao carregar o pdf" : "UniPDF Pro";
    title.style.marginBottom = "10px";
    
    const msg = document.createElement('p');
    msg.textContent = message || (originalUrl
        ? "O site (CORS/Cloudflare) impediu a extensão de carregar o PDF de forma invisível." 
        : "Nenhum documento aberto. Escolhe um ficheiro do teu computador.");
    msg.style.marginBottom = "30px";
    msg.style.color = "#bbb";

    const btnContainer = document.createElement('div');
    btnContainer.style.display = "flex";
    btnContainer.style.gap = "15px";

    // O seletor é aberto pelo clique do utilizador, evitando bloqueios do navegador.
    const btnLocal = document.createElement('button');
    btnLocal.textContent = "Escolher ficheiro";
    btnLocal.style.cssText = "padding:10px 20px; font-size:14px; cursor:pointer; background:#0376db; color:white; border:none; border-radius:4px; font-weight:bold;";
    btnLocal.onclick = () => {
        openLocalFile();
    };
    btnContainer.appendChild(btnLocal);

    const btnClose = document.createElement('button');
    btnClose.textContent = "Fechar janela";
    btnClose.style.cssText = "padding:10px 20px; font-size:14px; cursor:pointer; background:#555; color:white; border:none; border-radius:4px; font-weight:bold;";
    btnClose.onclick = () => {
        if (chrome?.tabs) {
            chrome.tabs.getCurrent(tab => tab?.id ? chrome.tabs.remove(tab.id) : window.close());
        } else {
            window.close();
        }
    };
    btnContainer.appendChild(btnClose);

    // Permite continuar no navegador quando a extensão não consegue carregar o URL.
    if (originalUrl) {
        const btnWeb = document.createElement('button');
        btnWeb.textContent = "Abrir sem extensão";
        btnWeb.style.cssText = "padding:10px 20px; font-size:14px; cursor:pointer; background:#555; color:white; border:none; border-radius:4px; font-weight:bold;";
        btnWeb.onclick = () => {
            const separator = originalUrl.includes('?') ? '&' : '?';
            window.location.href = originalUrl + separator + 'bypass_ext=true';
        };
        btnContainer.appendChild(btnWeb);
    }

    overlay.appendChild(title);
    overlay.appendChild(msg);
    overlay.appendChild(btnContainer);
    document.body.appendChild(overlay);
    fallbackOverlay = overlay;
}



init();