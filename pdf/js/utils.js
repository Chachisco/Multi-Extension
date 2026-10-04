import { state } from './state.js';

/**
 * Viaja para qualquer ponto do PDF de forma segura.
 * @param {number} pageNum - A página de destino
 * @param {Object} options - { pdfY, htmlY, align ('top'|'center'|'bottom'), behavior, flashX, flashW }
 */

export async function jumpTo(pageNum, options = {}) {
    const {
        pdfY = null,
        htmlY = null,
        align = 'center',
        behavior = 'smooth',
        flashX = null,
        flashW = null
    } = options;

    const wrapper = document.getElementById(`page-wrapper-${pageNum}`);
    const viewport = document.getElementById('viewport');
    const pageInput = document.getElementById('page-input');

    if (!wrapper || !viewport) return;
    if (pageInput) pageInput.value = pageNum;

    let targetY = wrapper.offsetTop;

    if (pdfY !== null) {
        const page = await state.pdfDoc.getPage(pageNum);
        const vp = page.getViewport({ scale: state.currentScale, rotation: (page.rotate || 0) + state.pageRotation });
        targetY += vp.height - (pdfY * state.currentScale);
    } 
    else if (htmlY !== null) {
        targetY += (htmlY / 100) * wrapper.clientHeight;
    }


    if (align === 'center') {
        targetY -= (viewport.clientHeight / 2);
    } else if (align === 'top') {
        targetY -= 60;
    } else if (align === 'bottom') {
        targetY -= viewport.clientHeight;
        targetY += 60;
    }

    targetY = Math.max(0, targetY);
    const maxScroll = viewport.scrollHeight - viewport.clientHeight;
    targetY = Math.min(targetY, maxScroll);
    viewport.scrollTo({ top: targetY, behavior });

    if (pdfY !== null && typeof window.flashHighlight === 'function') {
        window.flashHighlight(pageNum, flashX, pdfY, flashW, align === 'top');
    }
}