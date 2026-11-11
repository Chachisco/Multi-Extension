import { BaseItem } from "./BaseItem.js";
/**
 * FreeTextBox: Text inserted on PDF or editable Widget.
 */
export class FreeTextBox extends BaseItem {
    /**
     * @param {Object} params
     * @param {string} [params.id]
     * @param {number} params.pageNum
     * @param {number} params.x
     * @param {number} params.y
     * @param {string} [params.width='150px']
     * @param {string} [params.height='30px']
     * @param {string} [params.text='']
     * @param {number} [params.size=12]
     * @param {string} [params.color='#000000']
     * @param {string} [params.align='left']
     * @param {boolean} [params.isWidget=false]
     */
    constructor({
        id = null,
        pageNum,
        x = 0,
        y = 0,
        width = '150px',
        height = '30px',
        text = '',
        size = 12,
        color = '#000000',
        align = 'left',
        isWidget = false
    } = {}) {
        super({ id, pageNum, x, y });
        this.width = width || '150px';
        this.height = height || '30px';
        this.text = text || '';
        this.size = Number(size) || 12;
        this.color = color || '#000000';
        this.align = align || 'left';
        this.isWidget = Boolean(isWidget);
    }

    toJSON() {
        return {
            id: this.id,
            x: this.x,
            y: this.y,
            width: this.width,
            height: this.height,
            text: this.text,
            size: this.size,
            color: this.color,
            align: this.align,
            isWidget: this.isWidget
        };
    }

    static fromJSON(raw, pageNum) {
        if (!raw) return null;
        return new FreeTextBox({
            id: raw.id,
            pageNum: pageNum ?? raw.pageNum ?? 1,
            x: raw.x ?? 0,
            y: raw.y ?? 0,
            width: raw.width ?? '150px',
            height: raw.height ?? '30px',
            text: raw.text ?? '',
            size: raw.size ?? 12,
            color: raw.color ?? '#000000',
            align: raw.align ?? 'left',
            isWidget: raw.isWidget ?? false
        });
    }
}