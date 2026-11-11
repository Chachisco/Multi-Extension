/**
 * Base Class for objects anchored in PDF page
 */
export class BaseItem {
     /**
     * @param {Object} params
     * @param {string} [params.id]
     * @param {number} params.pageNum - Número da página (base 1)
     * @param {number} [params.x=0] - Posição horizontal percentual (0 a 100)
     * @param {number} [params.y=0] - Posição vertical percentual (0 a 100)
     */
    constructor({ id = null, pageNum = 1, x = 0, y = 0 } = {}) {
        this.id = id || BaseItem.generateId();
        this.pageNum = Number(pageNum) || 1;
        this.x = Number(x) || 0;
        this.y = Number(y) || 0;
        this.createdAt = Date.now();
    }

    static generateId() {
        return `${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 9)}`;
    }

    /**
     * Valida se as coordenadas e página são válidas.
     * @returns {boolean}
     */
    isValid() {
        return !isNaN(this.pageNum) && this.pageNum >= 1 &&
               !isNaN(this.x) && !isNaN(this.y);
    }

    toJSON() {
        return {
            id: this.id,
            pageNum: this.pageNum,
            x: this.x,
            y: this.y
        };
    }
}