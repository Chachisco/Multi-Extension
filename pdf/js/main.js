import { appState } from './core/AppState.js';
import { pdfEngine } from './core/PdfEngine.js';
import { storageService } from './services/StorageService.js';
import { i18n, t } from './services/I18nService.js';
import { logger } from './services/LoggerService.js';
import { ShortcutManager } from './controllers/ShortcutManager.js';
import { Toolbar } from './ui/Toolbar.js';
import { Sidebar } from './ui/Sidebar.js';
import { Overlays } from './ui/Overlays.js';
import { Modals, modals } from './ui/Modals.js';
import { jumpTo } from './utils/navigation.js';

// Expõe auxiliares no objeto global (para compatibilidade e debugging)
window.pdfViewerState = appState;
window.pdfJumpTo = jumpTo;
window.showReferencePreview = (pageNum, title, destY) => modals.showReferencePreview(pageNum, title, destY);

let fallbackOverlay = null;
let currentSourceUrl = null;
let burnInPreviewRequestId = 0;

// =========================================================================
// 1. INICIALIZAÇÃO DA APLICAÇÃO
// =========================================================================
async function init() {
    // 1. Traduz o HTML estático no arranque
    i18n.translateDOM();

    // 2. Inicializa os componentes de UI
    const toolbar = new Toolbar(appState, pdfEngine);
    const sidebar = new Sidebar(appState, pdfEngine);
    const overlays = new Overlays(appState, pdfEngine);

    const shortcuts = new ShortcutManager(appState, pdfEngine);

    window.addEventListener('pdf-render-error', event => {
        const { pageNum, error } = event.detail;
        const reason = error instanceof Error ? error.message : String(error);
        const message = t(
            'pdf_render_failed',
            'Não foi possível apresentar a página $1: $2',
            [pageNum, reason]
        );
        logger.error(message, error);
        showFallbackScreen(currentSourceUrl, message);
    });

    // 3. Configura handlers de download, impressão e fusão
    setupDownloadActions();
    setupFileInput();

    // 4. Carrega o ficheiro PDF
    const fileUrl = new URLSearchParams(window.location.search).get('file');

    if (fileUrl) {
        await loadPdfFromUrl(fileUrl);
    } else {
        showFallbackScreen(null, t('no_file_opened', 'Nenhum documento aberto. Escolhe um ficheiro do teu computador.'));
    }
}

// =========================================================================
// 2. CARREGAMENTO DO FICHEIRO PDF
// =========================================================================
async function loadPdfFromUrl(fileUrl) {
    let decodedUrl = fileUrl;
    try {
        const sourceUrl = new URL(fileUrl);
        decodedUrl = decodeURIComponent(fileUrl);
        currentSourceUrl = sourceUrl.href;

        const isLocalBlob = sourceUrl.protocol === 'blob:';
        const filename = decodeURIComponent(sourceUrl.pathname.split('/').pop() || '') || 'documento.pdf';
        const uniqueId = isLocalBlob ? `temp_${Date.now()}` : decodedUrl;

        logger.setDocument(filename);
        logger.info(t('loading_pdf', 'A carregar documento: $1', [filename]));

        await pdfEngine.loadDocument(sourceUrl.href, uniqueId, filename);
        hideFallbackScreen();

        // Restaura estado anterior de visualização (zoom, rotação, última página)
        await restoreViewerState(uniqueId);

    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        const message = t(
            'error_loading_pdf_details',
            'Não foi possível carregar o PDF: $1',
            [reason]
        );
        logger.error(message, error);
        showFallbackScreen(currentSourceUrl || decodedUrl, message);
    }
}

async function restoreViewerState(filename) {
    const zoomKey = `${filename}_zoom`;
    const rotKey = `${filename}_rotation`;
    const lastPageKey = filename;

    const saved = await storageService.adapter.getMultiple([zoomKey, rotKey, lastPageKey]);

    if (saved[zoomKey]) appState.setScale(saved[zoomKey]);
    if (saved[rotKey]) appState.setRotation(saved[rotKey]);
    pdfEngine.updateZoom(appState.currentScale);

    if (saved[lastPageKey]) {
        setTimeout(() => jumpTo(saved[lastPageKey], { align: 'top' }), 400);
    }
}

// =========================================================================
// 3. AÇÕES DE DOWNLOAD, EXPORTAÇÃO E FUSÃO (PDF-LIB)
// =========================================================================
function setupDownloadActions() {
    // 1. Guardar Normal
    document.getElementById('btn-dl-save')?.addEventListener('click', () => downloadDocument(false));
    document.getElementById('btn-dl-normal')?.addEventListener('click', () => downloadDocument(true));
    document.getElementById('btn-dl-export')?.addEventListener('click', exportDocumentWithNotes);

    // 2. Imprimir
    document.getElementById('btn-print')?.addEventListener('click', async () => {
        const session = appState.currentSession;
        if (!session?.pdfDoc) return;

        logger.info(t('preparing_print', 'A preparar documento para impressão...'));
        try {
            const data = await session.pdfDoc.getData();
            const blob = new Blob([data], { type: 'application/pdf' });
            const blobUrl = URL.createObjectURL(blob);

            const iframe = document.getElementById('print-iframe');
            iframe.onload = () => {
                iframe.contentWindow.print();
                setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
            };
            iframe.src = blobUrl;
        } catch (e) {
            logger.error(t('print_failed', 'Falha ao imprimir o documento.'), e);
        }
    });

    // 3. Evento de Merge de PDFs (disparado pelo Modals.js)
    window.addEventListener('merge-pdf-requested', async e => {
        const { bytes: importedBytes, targetPage } = e.detail;
        await handleMergePDF(importedBytes, targetPage);
    });
    window.addEventListener('page-edit-requested', e => {
        handlePageEditRequest(e.detail).catch(error => logger.error('Não foi possível editar as páginas do PDF.', error));
    });
    window.addEventListener('reorder-page', e => {
        handlePageEditRequest({ action: 'move', ...e.detail })
            .catch(error => logger.error('Não foi possível reordenar as páginas do PDF.', error));
    });

    // 4. Burn-In (Embutir Notas e Desenhos)
    document.getElementById('btn-dl-burn')?.addEventListener('click', async () => {
        await handleBurnInPreview();
    });
    document.querySelectorAll('input[name="note-export-type"]').forEach(input => {
        input.addEventListener('change', () => {
            if (!modals.modalPreview?.classList.contains('hidden')) {
                handleBurnInPreview();
            }
        });
    });
    window.addEventListener('burn-in-preview-cancelled', () => {
        burnInPreviewRequestId++;
    });
}

async function getCurrentPdfBytes(pdfDoc) {
    return pdfDoc.annotationStorage?.size > 0
        ? pdfDoc.saveDocument()
        : pdfDoc.getData();
}

async function downloadDocument(useSaveAs = false) {
    const session = appState.currentSession;
    if (!session?.pdfDoc) return;

    try {
        const data = await getCurrentPdfBytes(session.pdfDoc);
        const blob = new Blob([data], { type: 'application/pdf' });
        const name = document.title !== 'UniPDF Pro' ? document.title : 'documento.pdf';

        const downloadedFilename = await triggerBrowserDownload(blob, name, useSaveAs);
        if (downloadedFilename) logger.success(t('file_saved', 'Documento guardado com sucesso.'));
    } catch (e) {
        logger.error(t('save_failed', 'Erro ao guardar o documento.'), e);
    }
}

async function exportDocumentWithNotes() {
    const session = appState.currentSession;
    if (!session?.pdfDoc) return;
    if (typeof chrome === 'undefined' || !chrome.downloads) {
        logger.error('A exportação de notas requer a extensão e a API de transferências do browser.');
        return;
    }

    try {
        const data = await getCurrentPdfBytes(session.pdfDoc);
        const blob = new Blob([data], { type: 'application/pdf' });
        const baseName = (session.displayTitle || session.filename || 'documento.pdf').replace(/\.pdf$/i, '');
        const newFilename = await downloadAndGetFilename(blob, `Exportado_${baseName}.pdf`, true);
        if (!newFilename) return;

        const exportedDocumentId = `${newFilename}_${blob.size}`;
        const allItems = await storageService.adapter.getAll();
        const oldPrefix = `${session.filename}_pg`;
        const newPrefix = `${exportedDocumentId}_pg`;
        const copiedItems = {};
        for (const [key, value] of Object.entries(allItems)) {
            if (key.startsWith(oldPrefix)) {
                copiedItems[`${newPrefix}${key.slice(oldPrefix.length)}`] = value;
            }
        }
        if (Object.keys(copiedItems).length) await storageService.adapter.setMultiple(copiedItems);
        await storageService.registerDocument(exportedDocumentId, {
            title: newFilename,
            pageCount: session.pdfDoc.numPages
        });
        logger.success(t('notes_exported', 'PDF exportado com as notas e anotações associadas.'));
    } catch (error) {
        logger.error(t('notes_export_failed', 'Não foi possível exportar o PDF com as notas.'), error);
    }
}

function downloadAndGetFilename(blob, filename, saveAs) {
    return new Promise(resolve => {
        const url = URL.createObjectURL(blob);
        let downloadId = null;
        let settled = false;
        let downloadedFilename = null;
        const listener = delta => {
            if (delta.id !== downloadId) return;
            if (delta.filename?.current) downloadedFilename = delta.filename.current;
            if (delta.state?.current === 'interrupted') finish(null);
            if (delta.state?.current === 'complete' && downloadedFilename) {
                finish(downloadedFilename.split(/[\\/]/).pop());
            }
        };
        const finish = result => {
            if (settled) return;
            settled = true;
            chrome.downloads.onChanged.removeListener(listener);
            URL.revokeObjectURL(url);
            resolve(result);
        };

        chrome.downloads.download({ url, filename, saveAs }, id => {
            if (chrome.runtime.lastError || !id) {
                logger.error('O browser não iniciou o download.', chrome.runtime.lastError?.message || 'Sem ID de download.');
                finish(null);
                return;
            }
            downloadId = id;
            chrome.downloads.onChanged.addListener(listener);
            chrome.downloads.search({ id }, items => {
                if (chrome.runtime.lastError) {
                    logger.error('Não foi possível obter o nome do ficheiro transferido.', chrome.runtime.lastError.message);
                    finish(null);
                    return;
                }
                const item = items?.[0];
                if (item?.filename) downloadedFilename = item.filename;
                if (item?.state === 'interrupted') finish(null);
                else if (item?.state === 'complete' && downloadedFilename) {
                    finish(downloadedFilename.split(/[\\/]/).pop());
                }
            });
        });
    });
}

async function handleMergePDF(newPdfBytes, insertAtPage) {
    const session = appState.currentSession;
    if (!session?.pdfDoc || !window.PDFLib) return;

    logger.info(t('merging_pdfs', 'A juntar ficheiros PDF...'));

    try {
        const { PDFDocument } = window.PDFLib;
        const mainBytes = await session.pdfDoc.getData();
        const mainPdf = await PDFDocument.load(mainBytes);
        const importedPdf = await PDFDocument.load(newPdfBytes);

        const totalMain = mainPdf.getPageCount();
        const numNew = importedPdf.getPageCount();
        let insertIdx = totalMain;

        if (insertAtPage && insertAtPage >= 1 && insertAtPage <= totalMain) {
            insertIdx = insertAtPage - 1;
        }

        const copiedPages = await mainPdf.copyPages(importedPdf, importedPdf.getPageIndices());

        copiedPages.forEach((p, idx) => {
            if (insertIdx === totalMain) mainPdf.addPage(p);
            else mainPdf.insertPage(insertIdx + idx, p);
        });

        const finalBytes = await mainPdf.save();
        if (insertIdx < totalMain) {
            await storageService.syncAfterPageEdit(session.filename, 'INSERT', insertIdx + 1, numNew);
        }
        await pdfEngine.loadDocument(finalBytes, session.filename);
        logger.success(t('merge_complete', 'PDF fundido com sucesso!'));

    } catch (e) {
        logger.error(t('merge_error', 'Falha ao juntar os documentos.'), e);
    }
}

async function handlePageEditRequest({ action, pageNum, from, to }) {
    const session = appState.currentSession;
    const PDFLib = window.PDFLib;
    if (!session?.pdfDoc || !PDFLib) throw new Error('O PDF ou a biblioteca de edição não está disponível.');
    if (!['delete', 'rotate', 'move'].includes(action)) {
        throw new Error(`Ação de página não reconhecida: ${action}`);
    }

    const totalPages = session.pdfDoc.numPages;
    const sourcePage = action === 'move' ? Number(from) : Number(pageNum);
    const targetPage = Number(to);
    if (!Number.isInteger(sourcePage) || sourcePage < 1 || sourcePage > totalPages) {
        throw new RangeError('A página indicada não existe.');
    }
    if (action === 'move' && (!Number.isInteger(targetPage) || targetPage < 1 || targetPage > totalPages || sourcePage === targetPage)) {
        throw new RangeError('A página de destino indicada não é válida.');
    }
    if (action === 'delete' && totalPages <= 1) {
        logger.warn(t('cannot_delete_last_page', 'Não podes apagar a última página do PDF.'));
        return;
    }
    if (session.isSigned &&
        !confirm(t('signed_pdf_edit_confirm', 'Este PDF tem uma assinatura digital. A edição irá invalidá-la. Queres continuar?'))) {
        return;
    }
    if (action === 'delete' && !confirm(t('confirm_delete_page', 'Tens a certeza que queres apagar a página $1?', [sourcePage]))) return;

    let keepNotes = false;
    if (action === 'delete') {
        const notes = await storageService.loadPageItems(session.filename, sourcePage, 'notes');
        if (notes.length) {
            keepNotes = !confirm(t(
                'confirm_delete_page_notes',
                'A página $1 tem notas. Escolhe OK para apagá-las ou Cancelar para as passar à página seguinte.',
                [sourcePage]
            ));
        }
    }

    const sourceBytes = session.pdfDoc.annotationStorage?.size
        ? await session.pdfDoc.saveDocument()
        : await session.pdfDoc.getData();
    const pdfDoc = await PDFLib.PDFDocument.load(sourceBytes);

    if (action === 'rotate') {
        const page = pdfDoc.getPage(sourcePage - 1);
        page.setRotation(PDFLib.degrees(page.getRotation().angle + 90));
    } else if (action === 'delete') {
        pdfDoc.removePage(sourcePage - 1);
    } else {
        const reordered = await PDFLib.PDFDocument.create();
        const indices = Array.from({ length: totalPages }, (_, index) => index);
        const [moved] = indices.splice(sourcePage - 1, 1);
        indices.splice(targetPage - 1, 0, moved);
        const pages = await reordered.copyPages(pdfDoc, indices);
        pages.forEach(page => reordered.addPage(page));
        const bytes = await reordered.save();
        await storageService.syncAfterPageEdit(session.filename, 'MOVE', sourcePage, targetPage);
        await pdfEngine.loadDocument(bytes, session.filename, session.displayTitle);
        requestAnimationFrame(() => jumpTo(targetPage, { align: 'top', behavior: 'auto' }));
        logger.success(t('pdf_page_edit_success', 'Página atualizada com sucesso.'));
        return;
    }

    const bytes = await pdfDoc.save();
    if (action === 'delete') {
        await storageService.syncAfterPageEdit(session.filename, 'DELETE', sourcePage, null, keepNotes);
    }
    await pdfEngine.loadDocument(bytes, session.filename, session.displayTitle);
    requestAnimationFrame(() => jumpTo(action === 'delete' ? Math.max(1, sourcePage - 1) : sourcePage, {
        align: 'top',
        behavior: 'auto'
    }));
    logger.success(t('pdf_page_edit_success', 'Página atualizada com sucesso.'));
}

async function handleBurnInPreview() {
    const session = appState.currentSession;
    if (!session?.pdfDoc || !window.PDFLib) return;

    const requestId = ++burnInPreviewRequestId;
    if (modals.btnPreviewConfirm) modals.btnPreviewConfirm.disabled = true;
    logger.info(t('generating_burn_in', 'A gerar pré-visualização com anotações embutidas...'));

    try {
        const { PDFDocument } = window.PDFLib;
        const baseData = await getCurrentPdfBytes(session.pdfDoc);
        const pdfDoc = await PDFDocument.load(baseData);
        await drawStoredOverlays(pdfDoc);

        const finalBytes = await pdfDoc.save();
        const blob = new Blob([finalBytes], { type: 'application/pdf' });
        const previewUrl = URL.createObjectURL(blob);
        if (requestId !== burnInPreviewRequestId) {
            URL.revokeObjectURL(previewUrl);
            return;
        }

        modals.openBurnInPreview(previewUrl, () => {
            triggerBrowserDownload(blob, `BurnIn_${document.title}`, true)
                .catch(error => logger.error(t('save_failed', 'Erro ao guardar o documento.'), error));
        });
        if (modals.btnPreviewConfirm) modals.btnPreviewConfirm.disabled = false;

    } catch (e) {
        logger.error(t('burn_in_error', 'Erro ao gerar o PDF embutido.'), e);
        if (requestId === burnInPreviewRequestId && modals.btnPreviewConfirm) {
            modals.btnPreviewConfirm.disabled = false;
        }
    }
}

function colorFromHex(hex, rgb) {
    const value = /^#[\da-f]{6}$/i.test(hex || '') ? hex : '#000000';
    return rgb(
        parseInt(value.slice(1, 3), 16) / 255,
        parseInt(value.slice(3, 5), 16) / 255,
        parseInt(value.slice(5, 7), 16) / 255
    );
}

async function drawStoredOverlays(pdfDoc) {
    const session = appState.currentSession;
    const PDFLib = window.PDFLib;
    const allItems = await storageService.adapter.getAll();
    const font = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);
    const prefix = `${session.filename}_pg`;
    const noteExportType = document.querySelector('input[name="note-export-type"]:checked')?.value || 'native';

    for (let index = 0; index < pdfDoc.getPageCount(); index++) {
        const pageNum = index + 1;
        const page = pdfDoc.getPage(index);
        const { width, height } = page.getSize();
        const read = type => allItems[`${prefix}${pageNum}_${type}`] || [];

        for (const annotation of read('annotations')) {
            const x = (annotation.x / 100) * width;
            const y = height - ((annotation.y + annotation.height) / 100) * height;
            const w = (annotation.width / 100) * width;
            const h = (annotation.height / 100) * height;
            const color = colorFromHex(annotation.color, PDFLib.rgb);
            if (annotation.mode === 'underline') {
                page.drawLine({ start: { x, y }, end: { x: x + w, y }, color, thickness: annotation.size || 2 });
            } else {
                page.drawRectangle({ x, y, width: w, height: h, color, opacity: 0.4 });
            }
        }

        for (const stroke of read('drawings')) {
            if (!Array.isArray(stroke.path) || stroke.path.length < 2) continue;
            const color = colorFromHex(stroke.color, PDFLib.rgb);
            for (let i = 0; i < stroke.path.length - 1; i++) {
                const start = stroke.path[i];
                const end = stroke.path[i + 1];
                page.drawLine({
                    start: { x: start.x * width, y: height - start.y * height },
                    end: { x: end.x * width, y: height - end.y * height },
                    color,
                    thickness: Number(stroke.size) || 3
                });
            }
        }

        for (const box of read('textboxes')) {
            const text = box.text || '';
            if (!text.trim()) continue;
            const fontSize = Number(box.size) || 12;
            const boxWidth = Number.parseFloat(box.width) || 150;
            const x = box.x * width / 100;
            const y = height - box.y * height / 100;
            const color = colorFromHex(box.color, PDFLib.rgb);
            text.split('\n').forEach((line, lineIndex) => {
                const lineWidth = font.widthOfTextAtSize(line, fontSize);
                let drawX = x + 4;
                if (box.align === 'center') drawX = x + (boxWidth - lineWidth) / 2;
                if (box.align === 'right') drawX = x + boxWidth - lineWidth - 4;
                page.drawText(line, { x: drawX, y: y - fontSize - lineIndex * fontSize * 1.2, size: fontSize, font, color });
            });
        }

        if (noteExportType === 'none') continue;
        for (const note of read('notes')) {
            if (note.isExportable === false || note.exportable === false) continue;
            const x = note.x * width / 100;
            const y = height - note.y * height / 100;
            const noteText = note.text || 'Nota vazia';

            if (noteExportType === 'native' && PDFLib.PDFHexString && PDFLib.PDFName) {
                const toHex = text => {
                    let hex = 'FEFF';
                    for (let index = 0; index < text.length; index++) {
                        hex += text.charCodeAt(index).toString(16).padStart(4, '0');
                    }
                    return hex;
                };
                const annotation = pdfDoc.context.obj({
                    Type: 'Annot',
                    Subtype: 'Text',
                    Rect: [x, y - 20, x + 20, y],
                    Contents: PDFLib.PDFHexString.of(toHex(noteText)),
                    T: PDFLib.PDFHexString.of(toHex('UniPDF Pro')),
                    C: [0.99, 0.96, 0.2],
                    Name: PDFLib.PDFName.of('Comment'),
                    Open: false
                });
                const ref = pdfDoc.context.register(annotation);
                page.node.addAnnot(ref);
                continue;
            }

            const lines = noteText.split(/\r?\n/).flatMap(line => {
                const chunks = [];
                let remaining = line;
                while (remaining.length > 35) {
                    let splitAt = remaining.lastIndexOf(' ', 35);
                    if (splitAt < 1) splitAt = 35;
                    chunks.push(remaining.slice(0, splitAt));
                    remaining = remaining.slice(splitAt).trimStart();
                }
                chunks.push(remaining);
                return chunks;
            });
            const boxWidth = Math.max(100, Math.min(220, Math.max(...lines.map(line => font.widthOfTextAtSize(line, 10))) + 20));
            const boxHeight = Math.max(42, lines.length * 13 + 18);
            page.drawRectangle({
                x,
                y: y - boxHeight,
                width: boxWidth,
                height: boxHeight,
                color: colorFromHex(note.color, PDFLib.rgb),
                borderColor: PDFLib.rgb(0.9, 0.7, 0),
                borderWidth: 1
            });
            lines.forEach((line, lineIndex) => page.drawText(line, {
                x: x + 10,
                y: y - 20 - lineIndex * 13,
                size: 10,
                font,
                color: PDFLib.rgb(0.1, 0.1, 0.1)
            }));
        }
    }
}

async function triggerBrowserDownload(blob, filename, saveAs = false) {
    if (typeof chrome !== 'undefined' && chrome.downloads) {
        return downloadAndGetFilename(blob, filename, saveAs);
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return null;
}

// =========================================================================
// 4. INPUT LOCAL DE FICHEIRO E ECRÃ DE FALLBACK
// =========================================================================
function setupFileInput() {
    const fileInput = document.getElementById('file-input');
    if (!fileInput) return;

    fileInput.onchange = async () => {
        const file = fileInput.files?.[0];
        if (!file) return;

        try {
            const buffer = await file.arrayBuffer();
            const uniqueName = `${file.name}_${file.size}`;
            await pdfEngine.loadDocument(buffer, uniqueName, file.name);
            currentSourceUrl = null;
            hideFallbackScreen();
        } catch (e) {
            logger.error('Erro ao abrir ficheiro local', e);
            const reason = e instanceof Error ? e.message : String(e);
            showFallbackScreen(null, t(
                'error_opening_local_pdf',
                'Não foi possível abrir o ficheiro escolhido: $1',
                [reason]
            ));
        }
    };
}

function showFallbackScreen(originalUrl = null, message = null) {
    if (!fallbackOverlay) {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed; inset:0; background:#252526; z-index:9999; display:flex; flex-direction:column; align-items:center; justify-content:center; color:white; font-family:sans-serif; padding:24px; box-sizing:border-box;';

        const title = document.createElement('h2');
        title.textContent = 'UniPDF Pro';
        title.style.margin = '0 0 10px';

        const description = document.createElement('p');
        description.id = 'fallback-message';
        description.style.cssText = 'margin:0 0 25px; color:#bbb; text-align:center; max-width:700px; overflow-wrap:anywhere;';

        const buttons = document.createElement('div');
        buttons.style.cssText = 'display:flex; flex-wrap:wrap; justify-content:center; gap:12px;';

        const createButton = (id, label, background) => {
            const button = document.createElement('button');
            button.id = id;
            button.textContent = label;
            button.style.cssText = `padding:10px 20px; font-size:14px; cursor:pointer; background:${background}; color:white; border:none; border-radius:4px;`;
            buttons.appendChild(button);
            return button;
        };

        const chooseButton = createButton('btn-fallback-local', t('btn_choose_file', 'Escolher Ficheiro'), '#0376db');
        chooseButton.style.fontWeight = 'bold';
        chooseButton.onclick = () => {
            const input = document.getElementById('file-input');
            if (input) {
                input.value = '';
                input.click();
            }
        };

        const openButton = createButton('btn-fallback-web', t('btn_open_without_extension', 'Continuar sem extensão'), '#555');

        const closeButton = createButton('btn-fallback-close', t('btn_close_window', 'Fechar'), '#555');
        closeButton.onclick = () => window.close();

        overlay.append(title, description, buttons);
        document.body.appendChild(overlay);
        fallbackOverlay = overlay;
    }

    fallbackOverlay.querySelector('#fallback-message').textContent =
        message || t('no_file_opened', 'Nenhum documento aberto. Escolhe um ficheiro do teu computador.');
    const openButton = fallbackOverlay.querySelector('#btn-fallback-web');
    let targetUrl = null;
    try {
        const url = originalUrl ? new URL(originalUrl) : null;
        if (url && ['http:', 'https:', 'file:'].includes(url.protocol)) {
            url.searchParams.set('bypass_ext', 'true');
            targetUrl = url.href;
        }
    } catch (error) {
        logger.warn('O link original não é válido para abrir sem a extensão.', error);
    }
    openButton.hidden = !targetUrl;
    openButton.onclick = () => {
        if (!targetUrl) return;
        if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
            chrome.tabs.create({ url: targetUrl }, tab => {
                if (chrome.runtime.lastError) {
                    logger.error('Não foi possível abrir o PDF sem a extensão.', chrome.runtime.lastError.message);
                } else if (!tab) {
                    logger.error('O browser não confirmou a abertura do PDF sem a extensão.');
                }
            });
            return;
        }
        window.open(targetUrl, '_blank', 'noopener');
    };
}

function hideFallbackScreen() {
    fallbackOverlay?.remove();
    fallbackOverlay = null;
}

init();