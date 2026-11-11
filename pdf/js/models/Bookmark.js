import { BaseItem } from './BaseItem.js';


export class Bookmark extends BaseItem {
    /**
     * @param {Object} params
     * @param {string} [params.id]
     * @param {number} params.pageNum
     * @param {number} params.y - Posição vertical percentual (0-100)
     * @param {number} [params.x=0]
     * @param {string} [params.title='Marcador sem nome']
     * @param {string} [params.groupId='default']
     * @param {string} [params.color='#666666']
     */
    constructor({ id = null, pageNum, y, x = 0, title = '', groupId = 'default', color = '#666666' } = {}) {
        super({ id, pageNum, x, y });
        this.title = (title || 'Marcador sem nome').trim();
        this.groupId = groupId || 'default';
        this.color = color;
        this.type = 'bookmark';
    }

    setTitle(newTitle) {
        if (typeof newTitle === 'string' && newTitle.trim().length > 0) {
            this.title = newTitle.trim();
        }
    }

    setPosition(y, x = 0) {
        this.y = Math.max(0, Math.min(100, Number(y) || 0));
        this.x = Math.max(0, Math.min(100, Number(x) || 0));
    }

    /**
     * Saving format
     */
    toJSON() {
        return {
            id: this.id,
            x: this.x,
            y: this.y,
            title: this.title,
            type: 'bookmark',
            groupId: this.groupId,
            color: this.color
        };
    }

    /**
     * Reconstruct from saved format
     */
    static fromJSON(raw, pageNum) {
        if (!raw) return null;
        return new Bookmark({
            id: raw.id,
            pageNum: pageNum ?? raw.pageNum ?? 1,
            x: raw.x ?? 0,
            y: raw.y ?? 0,
            title: raw.title ?? '',
            groupId: raw.groupId ?? 'default',
            color: raw.color ?? '#666666'
        });
    }
}