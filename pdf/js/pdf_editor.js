import * as PDFLib from '../lib/pdf_lib/pdf-lib.min.js';
import { loadPDF } from './pdf-engine.js';
import { state } from './state.js';

const { PDFDocument, degrees } = window.PDFLib || PDFLib;

async function getCurrentPdfBytes() {
    if (state.pdfBytes) return state.pdfBytes.slice(0);
    const fileUrl = new URLSearchParams(window.location.search).get('file');
    if (!fileUrl) throw new Error("Ficheiro não encontrado.");
    const res = await fetch(fileUrl);
    const bytes = await res.arrayBuffer();
    state.pdfBytes = bytes;
    return bytes;
}

// ==========================================
// 1. LÓGICA PARA SINCRONIZAR A BASE DE DADOS
// ==========================================
async function syncStorageAfterEdit(action, p1, p2) {
    return new Promise(resolve => {
        chrome.storage.local.get(null, (items) => {
            const prefix = `${state.currentFilename}_pg`;
            const newStorage = {};
            const keysToRemove = [];

            Object.keys(items).forEach(key => {
                if (!key.startsWith(prefix)) {
                    newStorage[key] = items[key]; // Mantém chaves não relacionadas
                    return;
                }

                // Extrai o número da página (ex: "meupdf_pg3_notes" -> 3)
                const parts = key.substring(prefix.length).split('_');
                const pageNum = parseInt(parts[0], 10);
                const suffix = parts.slice(1).join('_');
                
                let newPageNum = pageNum;

                if (action === 'DELETE') {
                    if (pageNum === p1) return; // Se for a página apagada, descarta os dados
                    if (pageNum > p1) newPageNum = pageNum - 1;
                } 
                else if (action === 'MOVE') {
                    const from = p1; const to = p2;
                    if (pageNum === from) newPageNum = to;
                    else if (from < to && pageNum > from && pageNum <= to) newPageNum = pageNum - 1;
                    else if (from > to && pageNum >= to && pageNum < from) newPageNum = pageNum + 1;
                }

                if (newPageNum !== pageNum) {
                    keysToRemove.push(key);
                }
                newStorage[`${prefix}${newPageNum}_${suffix}`] = items[key];
            });

            chrome.storage.local.remove(keysToRemove, () => {
                chrome.storage.local.set(newStorage, resolve);
            });
        });
    });
}

// ==========================================
// 2. FUNÇÕES DE EDIÇÃO DO PDF
// ==========================================
export async function deleteSinglePage(pageNum) {
    try {
        const bytes = await getCurrentPdfBytes();
        const pdfDoc = await PDFDocument.load(bytes);
        pdfDoc.removePage(pageNum - 1);
        
        await syncStorageAfterEdit('DELETE', pageNum, null);
        
        const modifiedBytes = await pdfDoc.save();
        reloadViewerWithNewBytes(modifiedBytes);
    } catch (e) { console.error("Erro ao apagar:", e); }
}

export async function rotateSinglePage(pageNum, angleDelta) {
    try {
        const bytes = await getCurrentPdfBytes();
        const pdfDoc = await PDFDocument.load(bytes);
        const page = pdfDoc.getPage(pageNum - 1);
        const currentRotation = page.getRotation().angle;
        page.setRotation(degrees(currentRotation + angleDelta));
        
        const modifiedBytes = await pdfDoc.save();
        reloadViewerWithNewBytes(modifiedBytes);
    } catch (e) { console.error("Erro ao rodar:", e); }
}

export async function reorderPDFPages(fromPage, toPage) {
    try {
        const bytes = await getCurrentPdfBytes();
        const pdfDoc = await PDFDocument.load(bytes);
        
        const newPdf = await PDFDocument.create();
        const pageIndices = [];
        for (let idx = 0; idx < pdfDoc.getPageCount(); idx++) {
            pageIndices.push(idx);
        }

        const [movedIdx] = pageIndices.splice(fromPage - 1, 1);
        pageIndices.splice(toPage - 1, 0, movedIdx);

        const copiedPages = await newPdf.copyPages(pdfDoc, pageIndices);
        copiedPages.forEach(p => newPdf.addPage(p));

        await syncStorageAfterEdit('MOVE', fromPage, toPage);

        const modifiedBytes = await newPdf.save();
        reloadViewerWithNewBytes(modifiedBytes);
    } catch (e) { console.error("Erro ao reordenar:", e); }
}

function reloadViewerWithNewBytes(bytes) {
    state.pdfBytes = bytes;
    loadPDF(bytes.slice(0), state.currentFilename);
}