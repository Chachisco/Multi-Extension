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
        flashW = null,
        origin = 'baseline'
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
        targetY -= 5;
    } else if (align === 'bottom') {
        targetY -= viewport.clientHeight;
        targetY += 5;
    }

    targetY = Math.max(0, targetY);
    const maxScroll = viewport.scrollHeight - viewport.clientHeight;
    targetY = Math.min(targetY, maxScroll);
    viewport.scrollTo({ top: targetY, behavior });

    if (pdfY !== null || htmlY !== null) {
        flashHighlight(pageNum, { pdfX: flashX, pdfY, htmlY, pdfW: flashW, origin });
    }
}

/**
 * Função interna para desenhar a caixa amarela temporária
 * @param {string} origin
 */
export async function flashHighlight(pageNum, options = {}) {
    const {
        pdfX = null,
        pdfY = null,
        htmlY = null,
        pdfW = null,
        origin = 'baseline'
    } = options;

    if (pdfY === null && htmlY === null) return;
    
    const wrapper = document.getElementById(`page-wrapper-${pageNum}`);
    if (!wrapper) return;

    const page = await state.pdfDoc.getPage(pageNum);
    const vp = page.getViewport({ scale: state.currentScale, rotation: (page.rotate || 0) + state.pageRotation });

    const safeX = pdfX ?? 30; 
    const safeW = pdfW ?? (origin === 'top' ? 350 : 150);

    const htmlX = safeX * state.currentScale;
    const htmlW = safeW * state.currentScale;

    let finalHtmlY = 0;
    let boxHeight = 16 * state.currentScale;

    if (pdfY !== null) {
        finalHtmlY = vp.height - (pdfY * state.currentScale);
        if (origin === 'baseline') {
            finalHtmlY -= (boxHeight * 0.8); 
        } else if (origin === 'top') {
            finalHtmlY += (2 * state.currentScale); 
            boxHeight = 20 * state.currentScale;
        }
    } else if (htmlY !== null) {
        finalHtmlY = (htmlY / 100) * wrapper.clientHeight;
        boxHeight = 20 * state.currentScale; 
    }

    const flashBox = document.getElementById('jump-highlight');
    if (!flashBox) return;

    if (flashBox.hideTimeout) clearTimeout(flashBox.hideTimeout);
    if (flashBox.fadeTimeout) clearTimeout(flashBox.fadeTimeout);

    wrapper.appendChild(flashBox);
    
    flashBox.style.left = `${htmlX - 5}px`;
    flashBox.style.top = `${finalHtmlY}px`;
    flashBox.style.width = `${htmlW + 10}px`;
    flashBox.style.height = `${boxHeight}px`;
    
    flashBox.classList.remove('hidden');
    flashBox.style.transition = 'none';
    flashBox.style.opacity = '1';

    void flashBox.offsetHeight;
    flashBox.style.transition = 'opacity 1.5s ease-in-out';

    flashBox.fadeTimeout = setTimeout(() => { flashBox.style.opacity = '0'; }, 1200);
    flashBox.hideTimeout = setTimeout(() => { flashBox.classList.add('hidden'); }, 2700);
}