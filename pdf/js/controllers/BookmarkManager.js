import { Bookmark } from '../models/Bookmark.js';
import { storageService } from '../services/StorageService.js';

export class BookmarkManager extends EventTarget {
    /**
     * @param {string} filename - O identificador único deste PDF
     * @param {HistoryManager} history
     * @param {StorageService} [storage]
     */
    constructor(filename, history, storage = storageService) {
        super();
        this.filename = filename;
        this.history = history;
        this.storage = storage;
        this.cache = new Map(); // pageNum -> Bookmark[]
    }

    async loadPageBookmarks(pageNum) {
        if (this.cache.has(pageNum)) return this.cache.get(pageNum);

        const rawList = await this.storage.loadPageItems(this.filename, pageNum, 'bookmarks');
        const bookmarks = rawList
            .filter(item => !item.type || item.type === 'bookmark')
            .map(item => Bookmark.fromJSON(item, pageNum));

        this.cache.set(pageNum, bookmarks);
        return bookmarks;
    }

    async getAllBookmarks() {
        const pages = await this.storage.loadAllForFile(this.filename, 'bookmarks');
        const bookmarks = [];

        pages.forEach(({ pageNum, data }) => {
            const pageBookmarks = data
                .filter(item => !item.type || item.type === 'bookmark')
                .map(item => Bookmark.fromJSON(item, pageNum));
            this.cache.set(pageNum, pageBookmarks);
            bookmarks.push(...pageBookmarks);
        });

        return bookmarks.sort((a, b) => a.pageNum - b.pageNum || a.y - b.y);
    }

    async addBookmark(pageNum, y, title = '', options = {}) {
        const bookmarks = await this.loadPageBookmarks(pageNum);
        const newBookmark = new Bookmark({ pageNum, y, x: 0, title, ...options });

        bookmarks.push(newBookmark);
        await this._persistPage(pageNum);

        this.history.record({
            label: 'Adicionar Marcador',
            undo: async () => this.removeBookmark(newBookmark.id, pageNum, false),
            redo: async () => {
                const list = await this.loadPageBookmarks(pageNum);
                list.push(newBookmark);
                await this._persistPage(pageNum);
                this.dispatchEvent(new CustomEvent('bookmarks-updated'));
            }
        });

        this._emitChange();
        return newBookmark;
    }

    async removeBookmark(bookmarkId, pageNum, recordHistory = true) {
        const bookmarks = await this.loadPageBookmarks(pageNum);
        const index = bookmarks.findIndex(b => b.id === bookmarkId);
        if (index === -1) return false;

        const [removed] = bookmarks.splice(index, 1);
        await this._persistPage(pageNum);

        if (recordHistory) {
            this.history.record({
                label: 'Remover Marcador',
                undo: async () => {
                    const list = await this.loadPageBookmarks(pageNum);
                    list.splice(index, 0, removed);
                    await this._persistPage(pageNum);
                    this._emitChange();
                },
                redo: async () => this.removeBookmark(bookmarkId, pageNum, false)
            });
        }

        this._emitChange();
        return true;
    }

    async updateTitle(bookmarkId, pageNum, title) {
        const bookmark = (await this.loadPageBookmarks(pageNum)).find(b => b.id === bookmarkId);
        if (!bookmark || !title?.trim()) return false;

        const previousTitle = bookmark.title;
        const newTitle = title.trim();
        if (previousTitle === newTitle) return true;

        const applyTitle = async value => {
            bookmark.setTitle(value);
            await this._persistPage(pageNum);
            this._emitChange();
        };

        await applyTitle(newTitle);
        this.history.record({
            label: 'Renomear Marcador',
            undo: () => applyTitle(previousTitle),
            redo: () => applyTitle(newTitle)
        });
        return true;
    }

    _emitChange() {
        this.dispatchEvent(new CustomEvent('bookmarks-updated'));
        window.dispatchEvent(new CustomEvent('bookmarks-updated'));
    }

    async _persistPage(pageNum) {
        const list = this.cache.get(pageNum) || [];
        await this.storage.savePageItems(this.filename, pageNum, 'bookmarks', list);
    }
}