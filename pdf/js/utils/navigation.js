import { appState } from '../core/AppState.js';
import { storageService } from '../services/StorageService.js';
import { logger } from '../services/LoggerService.js';

let lastJumpTime = 0;

/**
 * Viaja para qualquer ponto do PDF de forma segura.
 * @param {number} pageNum - A página de destino
 * @param {Object} options - { pdfY, htmlY, align ('top'|'center'|'bottom'), behavior, flashX, flashW, noFlash, origin }
 */
export async function jumpTo(pageNum, options = {}) {
    const {
        pdfY = null, htmlY = null, align = 'center', behavior = 'smooth',
        noFlash = false, flashX = null, flashW = null, origin = 'baseline'
    } = options;

    let finalBehavior = behavior;
    const now = Date.now();
    
    // Detetor de Duplo Clique / Setas em massa
    if (now - lastJumpTime < 350) finalBehavior = 'auto';
    lastJumpTime = now;

    const wrapper = document.getElementById(`page-wrapper-${pageNum}`);
    const viewport = document.getElementById('viewport');
    const pageInput = document.getElementById('page-input');

    if (!wrapper || !viewport) return;
    if (pageInput) pageInput.value = pageNum;
    const filename = appState.currentSession?.filename;
    if (filename) {
        storageService.adapter.set(filename, pageNum)
            .catch(error => logger.error('Não foi possível guardar a última página.', error));
    }

    let targetY = wrapper.offsetTop;

    if (pdfY !== null) {
        const page = await appState.currentSession.pdfDoc.getPage(pageNum);
        const vp = page.getViewport({ scale: appState.currentScale, rotation: (page.rotate || 0) + appState.pageRotation });
        targetY += vp.height - (pdfY * appState.currentScale);
    } else if (htmlY !== null) {
        targetY += (htmlY / 100) * wrapper.clientHeight;
    }

    if (align === 'center') targetY -= (viewport.clientHeight / 2);
    else if (align === 'top') targetY -= 5;
    else if (align === 'bottom') { targetY -= viewport.clientHeight; targetY += 5; }

    targetY = Math.max(0, Math.min(targetY, viewport.scrollHeight - viewport.clientHeight));
    
    viewport.scrollTo({ top: targetY, behavior: finalBehavior });

    if ((pdfY !== null || htmlY !== null) && typeof window.flashHighlight === 'function' && !noFlash) {
        flashHighlight(pageNum, { pdfX: flashX, pdfY, htmlY, pdfW: flashW, origin });
    }
}

/**
 * Função interna para desenhar a caixa amarela/vermelha temporária
 */
export async function flashHighlight(pageNum, options = {}) {
    const { pdfX = null, pdfY = null, htmlY = null, pdfW = null, origin = 'baseline' } = options;
    if (pdfY === null && htmlY === null) return;
    
    const wrapper = document.getElementById(`page-wrapper-${pageNum}`);
    if (!wrapper) return;

    const page = await appState.currentSession.pdfDoc.getPage(pageNum);
    const vp = page.getViewport({ scale: appState.currentScale, rotation: (page.rotate || 0) + appState.pageRotation });

    const safeX = pdfX ?? 30; 
    const safeW = pdfW ?? (origin === 'top' ? 350 : 150);
    const htmlX = safeX * appState.currentScale;
    const htmlW = safeW * appState.currentScale;

    let finalHtmlY = 0;
    let boxHeight = 16 * appState.currentScale;

    if (pdfY !== null) {
        finalHtmlY = vp.height - (pdfY * appState.currentScale);
        if (origin === 'baseline') finalHtmlY -= (boxHeight * 0.8); 
        else if (origin === 'top') { finalHtmlY += (2 * appState.currentScale); boxHeight = 20 * appState.currentScale; }
    } else if (htmlY !== null) {
        finalHtmlY = (htmlY / 100) * wrapper.clientHeight;
        boxHeight = 20 * appState.currentScale; 
    }

    const flashBox = document.getElementById('jump-highlight');
    if (!flashBox) return;

    if (flashBox.hideTimeout) clearTimeout(flashBox.hideTimeout);
    if (flashBox.fadeTimeout) clearTimeout(flashBox.fadeTimeout);

    wrapper.appendChild(flashBox);
    flashBox.style.cssText = `left: ${htmlX - 5}px; top: ${finalHtmlY}px; width: ${htmlW + 10}px; height: ${boxHeight}px; opacity: 1; transition: none;`;
    flashBox.classList.remove('hidden');

    void flashBox.offsetHeight; // Reflow
    
    flashBox.style.transition = 'opacity 1.5s ease-in-out';
    flashBox.fadeTimeout = setTimeout(() => { flashBox.style.opacity = '0'; }, 1200);
    flashBox.hideTimeout = setTimeout(() => { flashBox.classList.add('hidden'); }, 2700);
}