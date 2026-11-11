import { BaseItem } from './BaseItem.js';

export class BibliographyItem extends BaseItem {
    /**
     * @param {Object} params
     * @param {string} [params.id]
     * @param {number} params.pageNum
     * @param {number} params.num - Número ordinal da referência (ex: 1, 2...)
     * @param {number} [params.style=1] - 1 para [1], 2 para 1.
     * @param {string} params.text - Conteúdo textual da referência
     * @param {number} [params.pdfX=null]
     * @param {number} [params.pdfY=null]
     * @param {number} [params.pdfW=null]
     */
    constructor({
        id = null,
        pageNum,
        num,
        style = 1,
        text = '',
        pdfX = null,
        pdfY = null,
        pdfW = null
    } = {}) {
        super({ id, pageNum, x: 0, y: 0 });
        this.num = Number(num);
        this.style = Number(style) || 1; // 1: '[1]', 2: '1.'
        this.text = (text || '').trim();
        this.pdfX = pdfX !== null ? Number(pdfX) : null;
        this.pdfY = pdfY !== null ? Number(pdfY) : null;
        this.pdfW = pdfW !== null ? Number(pdfW) : null;
    }

    getFormattedLabel() {
        return this.style === 1 ? `[${this.num}]` : `${this.num}.`;
    }

    toJSON() {
        return {
            id: this.id,
            pageNum: this.pageNum,
            num: this.num,
            style: this.style,
            text: this.text,
            pdfX: this.pdfX,
            pdfY: this.pdfY,
            pdfW: this.pdfW
        };
    }
}