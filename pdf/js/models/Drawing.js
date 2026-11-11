import { BaseItem } from './BaseItem.js';

export class Drawing extends BaseItem {
    /**
     * @param {Object} params
     * @param {string} [params.id]
     * @param {number} params.pageNum
     * @param {Array<{x: number, y: number}>} [params.path=[]] - Pontos normalizados (0 a 1)
     * @param {string} [params.color='#ffeb3b']
     * @param {number} [params.size=4]
     */
    constructor({ id = null, pageNum, path = [], color = '#ffeb3b', size = 4 } = {}) {
        super({ id, pageNum, x: 0, y: 0 });
        this.path = Array.isArray(path) ? path : [];
        this.color = color || '#ffeb3b';
        this.size = Number(size) || 4;
    }

    addPoint(x, y) {
        if (typeof x === 'number' && typeof y === 'number') {
            this.path.push({ x, y });
        }
    }

    isValid() {
        return super.isValid() && this.path.length >= 2;
    }

    toJSON() {
        return {
            id: this.id,
            path: this.path,
            color: this.color,
            size: this.size
        };
    }

    static fromJSON(raw, pageNum) {
        if (!raw) return null;
        return new Drawing({
            id: raw.id,
            pageNum: pageNum ?? raw.pageNum ?? 1,
            path: raw.path ?? [],
            color: raw.color ?? '#ffeb3b',
            size: raw.size ?? 4
        });
    }
}