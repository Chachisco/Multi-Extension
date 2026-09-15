import * as pdfjsLib from '../lib/build/pdf.mjs';

function stopEvent(event) {
    event.stopPropagation();
}

export class TextLayerBuilder {
    static textLayers = new Map();
    static selectionController = null;

    constructor({ pdfPage, abortSignal = null }) {
        this.pdfPage = pdfPage;
        this.abortSignal = abortSignal;
        this.div = document.createElement('div');
        this.div.tabIndex = 0;
        this.div.className = 'textLayer';
        this.textLayer = null;
        this.renderingDone = false;
    }

    async render({ viewport }) {
        this.cancel();
        this.textLayer = new pdfjsLib.TextLayer({
            textContentSource: this.pdfPage.streamTextContent({
                includeMarkedContent: true,
                disableNormalization: true
            }),
            container: this.div,
            viewport
        });
        await this.textLayer.render();
        this.renderingDone = true;

        const endOfContent = document.createElement('div');
        endOfContent.className = 'endOfContent';
        this.div.append(endOfContent);
        this.bindSelection(endOfContent);
        TextLayerBuilder.textLayers.set(this.div, endOfContent);
    }

    bindSelection(endOfContent) {
        const options = this.abortSignal ? { signal: this.abortSignal } : undefined;
        this.div.addEventListener('mousedown', () => {
            this.div.classList.add('selecting');
        }, options);
        this.div.addEventListener('copy', event => {
            const selection = document.getSelection();
            event.clipboardData?.setData('text/plain', selection?.toString() || '');
            stopEvent(event);
        }, options);
        TextLayerBuilder.enableSelectionListener();
    }

    cancel() {
        this.textLayer?.cancel();
        this.textLayer = null;
        this.renderingDone = false;
        this.div.replaceChildren();
        TextLayerBuilder.textLayers.delete(this.div);
    }

    static enableSelectionListener() {
        if (this.selectionController) return;
        const controller = new AbortController();
        this.selectionController = controller;
        const { signal } = controller;
        let isPointerDown = false;
        let previousRange = null;

        const reset = (end, textLayer) => {
            textLayer.append(end);
            end.style.width = '';
            end.style.height = '';
            textLayer.classList.remove('selecting');
        };

        document.addEventListener('pointerdown', () => {
            isPointerDown = true;
        }, { signal });
        document.addEventListener('pointerup', () => {
            isPointerDown = false;
            this.textLayers.forEach(reset);
        }, { signal });
        window.addEventListener('blur', () => {
            isPointerDown = false;
            this.textLayers.forEach(reset);
        }, { signal });
        document.addEventListener('keyup', () => {
            if (!isPointerDown) this.textLayers.forEach(reset);
        }, { signal });
        document.addEventListener('selectionchange', () => {
            const selection = document.getSelection();
            if (!selection || selection.rangeCount === 0) {
                this.textLayers.forEach(reset);
                return;
            }

            const activeLayers = new Set();
            for (let index = 0; index < selection.rangeCount; index++) {
                const range = selection.getRangeAt(index);
                for (const textLayer of this.textLayers.keys()) {
                    if (!activeLayers.has(textLayer) && range.intersectsNode(textLayer)) {
                        activeLayers.add(textLayer);
                    }
                }
            }

            for (const [textLayer, end] of this.textLayers) {
                if (activeLayers.has(textLayer)) textLayer.classList.add('selecting');
                else reset(end, textLayer);
            }

            if (!isPointerDown || !selection.rangeCount) return;
            const range = selection.getRangeAt(0);
            const modifyStart = previousRange && (
                range.compareBoundaryPoints(Range.END_TO_END, previousRange) === 0
                || range.compareBoundaryPoints(Range.START_TO_END, previousRange) === 0
            );
            let anchor = modifyStart ? range.startContainer : range.endContainer;
            if (anchor.nodeType === Node.TEXT_NODE) anchor = anchor.parentNode;
            if (anchor.classList?.contains('highlight')) anchor = anchor.parentNode;

            if (!modifyStart && range.endOffset === 0) {
                do {
                    while (!anchor.previousSibling) anchor = anchor.parentNode;
                    anchor = anchor.previousSibling;
                } while (!anchor.childNodes.length);
            }

            const parentTextLayer = anchor.parentElement?.closest('.textLayer');
            const end = this.textLayers.get(parentTextLayer);
            if (end) {
                end.style.width = parentTextLayer.style.width;
                end.style.height = parentTextLayer.style.height;
                end.style.userSelect = 'text';
                anchor.parentElement.insertBefore(end, modifyStart ? anchor : anchor.nextSibling);
            }
            previousRange = range.cloneRange();
        }, { signal });
    }
}
