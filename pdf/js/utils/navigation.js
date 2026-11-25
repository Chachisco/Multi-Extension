import { appState } from '../core/AppState.js';
import { storageService } from '../services/StorageService.js';
import { logger } from '../services/LoggerService.js';

let lastJumpTime = 0;

/**
 * Viaja para qualquer ponto do PDF de forma segura.
 * @param {number} pageNum - A página de destino
 * @param {Object} options - { pdfY, htmlY, align ('top'|'center'|'bottom'), behavior, flashX, flashW, noFlash, origin }
 */
// Em js/utils/navigation.js:

export async function jumpTo(pageNum, options = {}) {
    const {
        pdfY = null,
        htmlY = null,
        align = 'center',
        behavior = 'smooth',
        noFlash = false,
        origin = 'baseline',
        rects = null
    } = options;

    const flashX = options.flashX ?? options.pdfX ?? null;
    const flashW = options.flashW ?? options.pdfW ?? null;
    const flashH = options.flashH ?? options.pdfH ?? null;

    let finalBehavior = behavior;
    const now = Date.now();
    if (now - lastJumpTime < 350) finalBehavior = 'auto';
    lastJumpTime = now;

    const wrapper = document.getElementById(`page-wrapper-${pageNum}`);
    const viewport = document.getElementById('viewport');
    const pageInput = document.getElementById('page-input');

    if (!wrapper || !viewport) return;
    if (pageInput) pageInput.value = pageNum;

    const documentId = appState.currentSession?.id;
    if (documentId) {
        storageService.adapter.set(documentId, pageNum)
            .catch(error => logger.error('Não foi possível guardar a última página.', error));
    }

    let targetY = wrapper.offsetTop;

    if (rects && rects.length > 0) {
        // Se tiver retângulos, o scroll aponta exatamente para o topo do primeiro retângulo
        targetY += (rects[0].y / 100) * wrapper.clientHeight;
    } else if (pdfY !== null) {
        const page = await appState.currentSession.pdfDoc.getPage(pageNum);
        const vp = page.getViewport({ scale: appState.currentScale, rotation: (page.rotate || 0) + appState.pageRotation });
        const [, vy] = vp.convertToViewportPoint(0, pdfY);
        targetY += vy;
    } else if (htmlY !== null) {
        targetY += (htmlY / 100) * wrapper.clientHeight;
    }

    if (align === 'center') targetY -= (viewport.clientHeight / 2);
    else if (align === 'top') targetY -= 5;
    else if (align === 'bottom') { targetY -= viewport.clientHeight; targetY += 5; }

    targetY = Math.max(0, Math.min(targetY, viewport.scrollHeight - viewport.clientHeight));
    viewport.scrollTo({ top: targetY, behavior: finalBehavior });

    if (!noFlash) {
        flashHighlight(pageNum, { pdfX: flashX, pdfY, htmlY, pdfW: flashW, pdfH: flashH, origin, rects });
    }
}

/**
 * Função interna para desenhar a caixa amarela/vermelha temporária
 */
export async function flashHighlight(pageNum, options = {}) {
    const {
        pdfX = null,
        pdfY = null,
        htmlY = null,
        pdfW = null,
        pdfH = null,
        origin = 'baseline',
        rects = null
    } = options;

    if (pdfY === null && htmlY === null && (!rects || !rects.length)) return;

    const wrapper = document.getElementById(`page-wrapper-${pageNum}`);
    if (!wrapper) return;

    // Limpa flashes anteriores ativos
    wrapper.querySelectorAll('.jump-highlight-active').forEach(el => el.remove());

    const boxesToDraw = [];

    if (Array.isArray(rects) && rects.length > 0) {
        rects.forEach(r => {
            boxesToDraw.push({
                x: (r.x / 100) * wrapper.clientWidth,
                y: (r.y / 100) * wrapper.clientHeight,
                w: (r.w / 100) * wrapper.clientWidth,
                h: (r.h / 100) * wrapper.clientHeight
            });
        });
    } 
    else {
        const session = appState.currentSession;
        if (!session?.pdfDoc) return;

        const page = await session.pdfDoc.getPage(pageNum);
        const vp = page.getViewport({ scale: appState.currentScale, rotation: (page.rotate || 0) + appState.pageRotation });

        // Usa a altura real da fonte se existir, senão usa 18px proporcionais
        const boxHeight = (pdfH ? pdfH * appState.currentScale : 18 * appState.currentScale);
        let htmlX = 30 * appState.currentScale;
        let finalHtmlY = 0;
        let htmlW = (pdfW ? pdfW * appState.currentScale : 180 * appState.currentScale);

        if (pdfY !== null) {
            const safeX = pdfX ?? 30;
            const [vx, vy] = vp.convertToViewportPoint(safeX, pdfY);
            htmlX = vx;
            finalHtmlY = vy;

            if (origin === 'baseline') {
                finalHtmlY -= (boxHeight * 0.85);
            } else if (origin === 'top') {
                finalHtmlY += (2 * appState.currentScale);
            }
        } else if (htmlY !== null) {
            finalHtmlY = (htmlY / 100) * wrapper.clientHeight;
            htmlX = 10;
            htmlW = 140 * appState.currentScale;
        }

        boxesToDraw.push({
            x: htmlX,
            y: finalHtmlY,
            w: htmlW,
            h: boxHeight
        });
    }

    boxesToDraw.forEach(b => {
        const box = document.createElement('div');
        box.className = 'jump-highlight-active';
        box.style.cssText = `
            position: absolute;
            left: ${b.x - 2}px;
            top: ${b.y - 1}px;
            width: ${b.w + 4}px;
            height: ${b.h + 2}px;
            background-color: rgba(251, 230, 39, 0.55);
            border-radius: 3px;
            pointer-events: none;
            z-index: 99;
            transition: opacity 1.2s ease-out;
        `;
        wrapper.appendChild(box);

        setTimeout(() => box.style.opacity = '0', 1000);
        setTimeout(() => box.remove(), 2300);
    });
}