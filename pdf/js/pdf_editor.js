import * as PDFLib from '../lib/pdf_lib/pdf-lib.min.js';
import { loadPDF } from './pdf-engine.js';
import { state } from './state.js';

const { PDFDocument, degrees } = window.PDFLib || PDFLib;

async function getCurrentPdfBytes() {
    if (state.pdfDoc) {
        if (state.pdfDoc.annotationStorage.size > 0) {
            return await state.pdfDoc.saveDocument();
        } else {
            return await state.pdfDoc.getData();
        }
    }
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
async function syncStorageAfterEdit(action, p1, p2, keepNotes = false) {
    return new Promise(resolve => {
        chrome.storage.local.get(null, (items) => {
            const prefix = `${state.currentFilename}_pg`;
            const newStorage = {};
            const keysToRemove = [];

            Object.keys(items).forEach(key => {
                if (!key.startsWith(prefix)) {
                    newStorage[key] = items[key]; 
                    return;
                }

                const parts = key.substring(prefix.length).split('_');
                const pageNum = parseInt(parts[0], 10);
                const suffix = parts.slice(1).join('_');
                
                let newPageNum = pageNum;

                if (action === 'DELETE') {
                    if (pageNum === p1) {
                        if (!keepNotes) return;
                    } else if (pageNum > p1) {
                        newPageNum = pageNum - 1;
                    }
                } 
                else if (action === 'MOVE') {
                    const from = p1; const to = p2;
                    if (pageNum === from) newPageNum = to;
                    else if (from < to && pageNum > from && pageNum <= to) newPageNum = pageNum - 1;
                    else if (from > to && pageNum >= to && pageNum < from) newPageNum = pageNum + 1;
                }
                else if (action === 'INSERT') {
                    const insertAt = p1;
                    const numAdded = p2;
                    if (pageNum >= insertAt) {
                        newPageNum = pageNum + numAdded;
                    }
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
export async function deleteSinglePage(pageNum, keepNotes) {
    try {
        const bytes = await getCurrentPdfBytes();
        const pdfDoc = await PDFDocument.load(bytes);
        pdfDoc.removePage(pageNum - 1);
        
        await syncStorageAfterEdit('DELETE', pageNum, null, keepNotes);
        
        const modifiedBytes = await pdfDoc.save();
        reloadViewerWithNewBytes(modifiedBytes, Math.max(1, pageNum - 1));
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
        reloadViewerWithNewBytes(modifiedBytes, pageNum);
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
        reloadViewerWithNewBytes(modifiedBytes, toPage);
    } catch (e) { console.error("Erro ao reordenar:", e); }
}

async function reloadViewerWithNewBytes(bytes, targetPage = null) {
    state.pdfBytes = bytes;
    const pageToScroll = targetPage || document.getElementById('page-input').value || 1;

    await loadPDF(bytes.slice(0), state.currentFilename);

    setTimeout(() => {
        const wrapper = document.getElementById(`page-wrapper-${pageToScroll}`);
        const viewport = document.getElementById('viewport');
        if (wrapper && viewport) {
            document.getElementById('page-input').value = pageToScroll;
            viewport.scrollTo({ top: Math.max(0, wrapper.offsetTop - 42), behavior: 'auto' });
        }
    }, 150);
}

export async function mergePDFs(newPdfBytes, insertAtPage) {
    try {
        const bytes = await getCurrentPdfBytes();
        const mainPdf = await PDFDocument.load(bytes);
        const importedPdf = await PDFDocument.load(newPdfBytes);

        const numNewPages = importedPdf.getPageCount();
        const totalMainPages = mainPdf.getPageCount();

        let insertIdx = totalMainPages; 
        let shiftStartingFrom = totalMainPages + 1; 

        if (insertAtPage && insertAtPage >= 1 && insertAtPage <= totalMainPages) {
            insertIdx = insertAtPage - 1;
            shiftStartingFrom = insertAtPage;
        }

        const copiedPages = await mainPdf.copyPages(importedPdf, importedPdf.getPageIndices());

        for (let i = 0; i < copiedPages.length; i++) {
            if (insertIdx === totalMainPages) {
                mainPdf.addPage(copiedPages[i]);
            } else {
                mainPdf.insertPage(insertIdx + i, copiedPages[i]);
            }
        }

        if (insertIdx < totalMainPages) {
            await syncStorageAfterEdit('INSERT', shiftStartingFrom, numNewPages);
        }

        const modifiedBytes = await mainPdf.save();
        reloadViewerWithNewBytes(modifiedBytes, shiftStartingFrom);
        
    } catch (e) {
        console.error("Erro ao juntar PDFs:", e);
        alert("Ocorreu um erro ao tentar juntar os documentos. Tenta novamente.");
    }
}