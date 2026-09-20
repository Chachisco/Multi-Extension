// --- START OF FILE text-layer-builder.js ---

import * as pdfjsLib from '../lib/pdf_js/build/pdf.mjs';

export class TextLayerBuilder {
    constructor({ pdfPage }) {
        this.pdfPage = pdfPage;
        this.div = document.createElement('div');
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
    }

    cancel() {
        this.textLayer?.cancel();
        this.textLayer = null;
        this.renderingDone = false;
        this.div.innerHTML = '';
    }
}