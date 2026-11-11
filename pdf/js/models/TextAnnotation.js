import { BaseItem } from './BaseItem.js';

export class TextAnnotation extends BaseItem {
    /**
     * @param {Object} params
     * @param {string} [params.id]
     * @param {number} params.pageNum
     * @param {string} [params.mode='highlight'] - 'highlight' | 'underline'
     * @param {string} [params.color='#ffeb3b']
     * @param {number} [params.size=4]
     * @param {number} params.x - Percentual horizontal na folha (0 a 100)
     * @param {number} params.y - Percentual vertical na folha (0 a 100)
     * @param {number} params.width - Largura percentual (0 a 100)
     * @param {number} params.height - Altura percentual (0 a 100)
     */
    constructor({
        id = null,
        pageNum,
        mode = 'highlight',
        color = '#ffeb3b',
        size = 4,
        x = 0,
        y = 0,
        width = 0,
        height = 0
    } = {}) {
        super({ id, pageNum, x, y });
        this.mode = mode === 'underline' ? 'underline' : 'highlight';
        this.color = color || '#ffeb3b';
        this.size = Number(size) || 4;
        this.width = Number(width) || 0;
        this.height = Number(height) || 0;
    }

    /**
     * Generates id jey used for cache management.
     */
    getStorageId() {
        return JSON.stringify([
            this.mode,
            this.color,
            this.size,
            this.x,
            this.y,
            this.width,
            this.height
        ]);
    }

    toJSON() {
        return {
            id: this.id,
            mode: this.mode,
            color: this.color,
            size: this.size,
            x: this.x,
            y: this.y,
            width: this.width,
            height: this.height
        };
    }

    static fromJSON(raw, pageNum) {
        if (!raw) return null;
        return new TextAnnotation({
            id: raw.id,
            pageNum: pageNum ?? raw.pageNum ?? 1,
            mode: raw.mode,
            color: raw.color,
            size: raw.size,
            x: raw.x,
            y: raw.y,
            width: raw.width,
            height: raw.height
        });
    }
}