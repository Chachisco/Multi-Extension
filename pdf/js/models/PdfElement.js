import { BaseItem } from './BaseItem.js';

export const ElementType = Object.freeze({
    FIGURE: 'Figura',
    TABLE: 'Tabela',
    EQUATION: 'Equação',
    OTHER: 'Outros'
});

export class PdfElement extends BaseItem {
    /**
     * @param {Object} params
     * @param {string} [params.id]
     * @param {number} params.pageNum
     * @param {string} params.type - 'Figura' | 'Tabela' | 'Equação' | 'Outros'
     * @param {string} params.fullText - Texto da legenda ou citação
     * @param {string} [params.matchText=''] - Correspondência exata da etiqueta (ex: "Fig. 1")
     * @param {boolean} [params.isCaption=true] - Se é legenda verdadeira ou apenas citação no texto
     * @param {boolean} [params.isManual=false] - Se foi adicionado manualmente pelo utilizador
     * @param {number|null} [params.destX=null] - Coordenada X no espaço de pontos PDF
     * @param {number|null} [params.destY=null] - Coordenada Y no espaço de pontos PDF
     * @param {number|null} [params.destW=null] - Largura no espaço de pontos PDF
     * @param {number|null} [params.htmlY=null] - Posição Y percentual na página HTML (0 a 100)
     */
    constructor({
        id = null,
        pageNum,
        type = ElementType.FIGURE,
        fullText = '',
        matchText = '',
        isCaption = true,
        isManual = false,
        destX = null,
        destY = null,
        destW = null,
        htmlY = null
    } = {}) {
        super({
            id,
            pageNum,
            x: 0,
            y: htmlY !== null ? htmlY : (destY ?? 0)
        });

        this.type = this._normalizeType(type);
        this.fullText = (fullText || '').trim();
        this.matchText = (matchText || '').trim();
        this.isCaption = Boolean(isCaption);
        this.isMention = !this.isCaption;
        this.isManual = Boolean(isManual);

        // Coordenadas físicas do PDF (se extraído automaticamente)
        this.destX = destX !== null ? Number(destX) : null;
        this.destY = destY !== null ? Number(destY) : null;
        this.destW = destW !== null ? Number(destW) : null;

        // Coordenada visual percentual de ecrã (se inserido manualmente)
        this.htmlY = htmlY !== null ? Number(htmlY) : null;
    }

    _normalizeType(type) {
        if (!type) return ElementType.FIGURE;
        const normalized = String(type).trim();
        if (normalized.startsWith('Fig')) return ElementType.FIGURE;
        if (normalized.startsWith('Tab') || normalized === 'Quadro') return ElementType.TABLE;
        if (normalized.startsWith('Eq') || normalized === 'Fórmula') return ElementType.EQUATION;
        return ElementType.OTHER;
    }

    /**
     * returns type of element color
     */
    getColor() {
        switch (this.type) {
            case ElementType.TABLE: return '#8be28b';
            case ElementType.FIGURE: return '#0376db';
            case ElementType.EQUATION: return '#c678dd';
            default: return '#d68910';
        }
    }

    /**
     * Retorna se o elemento corresponde a uma pesquisa textual.
     * @param {string} query
     * @returns {boolean}
     */
    matchesSearch(query) {
        if (!query) return true;
        const term = query.toLowerCase();
        return this.fullText.toLowerCase().includes(term) ||
               this.matchText.toLowerCase().includes(term) ||
               this.type.toLowerCase().includes(term);
    }

    /**
     * Saving format
     */
    toJSON() {
        return {
            id: this.id,
            pageNum: this.pageNum,
            type: this.type,
            title: this.fullText,
            fullText: this.fullText,
            matchText: this.matchText,
            isCaption: this.isCaption,
            isManual: this.isManual,
            destX: this.destX,
            destY: this.destY,
            destW: this.destW,
            y: this.htmlY !== null ? this.htmlY : this.y,
            x: 0
        };
    }

    /**
     * Reconstruct from saved format
     */
    static fromLegacyStorage(raw, pageNum) {
        if (!raw) return null;
        return new PdfElement({
            id: raw.id,
            pageNum: pageNum ?? raw.pageNum ?? 1,
            type: raw.type,
            fullText: raw.title || raw.fullText || '',
            matchText: raw.matchText || '',
            isCaption: raw.isCaption ?? true,
            isManual: true,
            htmlY: raw.y ?? 0
        });
    }
}