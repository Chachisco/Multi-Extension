import { BaseItem } from './BaseItem.js';

export class StickyNote extends BaseItem {
    constructor({
        id = null,
        pageNum,
        x = 50,
        y = 10,
        text = '',
        width = '',
        height = '',
        isPinned = false,
        isLocked = false,
        isExportable = true,
        groupId = 'default',
        color = '#f1c40f'
    } = {}) {
        super({ id, pageNum, x, y });
        this.text = text || '';
        this.width = width || '';
        this.height = height || '';
        this.isPinned = Boolean(isPinned);
        this.isLocked = Boolean(isLocked);
        this.isExportable = Boolean(isExportable);
        this.groupId = groupId;
        this.color = color;
    }

    togglePin() {
        this.isPinned = !this.isPinned;
        return this.isPinned;
    }

    toggleLock() {
        this.isLocked = !this.isLocked;
        return this.isLocked;
    }

    toggleExportable() {
        this.isExportable = !this.isExportable;
        return this.isExportable;
    }

    toJSON() {
        return {
            id: this.id,
            x: this.x,
            y: this.y,
            width: this.width,
            height: this.height,
            text: this.text,
            pinned: this.isPinned,
            locked: this.isLocked,
            exportable: this.isExportable,
            groupId: this.groupId,
            color: this.color
        };
    }

    static fromJSON(raw, pageNum) {
        if (!raw) return null;
        return new StickyNote({
            id: raw.id,
            pageNum: pageNum ?? raw.pageNum ?? 1,
            x: raw.x ?? 50,
            y: raw.y ?? 10,
            text: raw.text ?? '',
            width: raw.width ?? '',
            height: raw.height ?? '',
            isPinned: raw.pinned ?? raw.isPinned ?? false,
            isLocked: raw.locked ?? raw.isLocked ?? false,
            isExportable: raw.exportable ?? raw.isExportable ?? true,
            groupId: raw.groupId ?? 0,
            color: raw.color ?? '#f1c40f'
        });
    }
}