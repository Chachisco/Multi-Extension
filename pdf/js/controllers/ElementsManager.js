import { PdfElement, ElementType } from '../models/PdfElement.js';
import { storageService } from '../services/StorageService.js';
import { pdfParser } from '../services/PdfParser.js';


export class ElementsManager extends EventTarget {
    constructor(filename, storage = storageService) {
        super();
        this.filename = filename;
        this.storage = storage;
        this.automaticElements = []; // Detetados no texto do PDF
        this.manualElements = [];    // Criados pelo utilizador
        this.activeFilter = 'Tudo';
        this.activeSort = 'Agrupado';
        this.searchQuery = '';
    }

    setAutomaticElements(elements) {
        this.automaticElements = elements.map(e => (e instanceof PdfElement ? e : new PdfElement(e)));
        this._emitChange();
    }

    async loadAutomaticElements(pdfDoc) {
        const detected = await pdfParser.extractElements(pdfDoc);
        this.setAutomaticElements(detected);
        return detected;
    }

    async loadManualElements() {
        const allPages = await this.storage.loadAllForFile(this.filename, 'elements');
        this.manualElements = [];

        for (const { pageNum, data } of allPages) {
            data.forEach(item => {
                this.manualElements.push(new PdfElement({
                    id: item.id,
                    pageNum,
                    type: item.type,
                    fullText: item.fullText || item.title,
                    isCaption: true,
                    isManual: true,
                    htmlY: item.y
                }));
            });
        }

        this._emitChange();
        return this.manualElements;
    }

    async addManualElement({ pageNum, targetY, text, type }) {
        const newEl = new PdfElement({
            pageNum,
            type: type || ElementType.FIGURE,
            fullText: text,
            isCaption: true,
            isManual: true,
            htmlY: targetY
        });

        this.manualElements.push(newEl);

        const pageItems = await this.storage.loadPageItems(this.filename, pageNum, 'elements');
        pageItems.push(newEl.toJSON());
        await this.storage.savePageItems(this.filename, pageNum, 'elements', pageItems);

        this._emitChange();
        return newEl;
    }

    async removeManualElement(elementId, pageNum) {
        this.manualElements = this.manualElements.filter(e => e.id !== elementId);
        
        const pageItems = await this.storage.loadPageItems(this.filename, pageNum, 'elements');
        const updated = pageItems.filter(item => item.id !== elementId);
        await this.storage.savePageItems(this.filename, pageNum, 'elements', updated);

        this._emitChange();
    }

    setFilter(filter) {
        this.activeFilter = filter;
        this._emitChange();
    }

    setSort(sort) {
        this.activeSort = sort;
        this._emitChange();
    }

    setSearch(query) {
        this.searchQuery = query;
        this._emitChange();
    }

    getVisibleElements() {
        const combined = [...this.automaticElements, ...this.manualElements];

        const filtered = combined.filter(el => {
            const matchesType = this.activeFilter === 'Tudo' || el.type === this.activeFilter;
            const matchesQuery = el.matchesSearch(this.searchQuery);
            return matchesType && matchesQuery;
        });

        if (this.activeSort === 'Texto') {
            return filtered.sort((a, b) => a.pageNum === b.pageNum ? a.y - b.y : a.pageNum - b.pageNum);
        }

        return {
            captions: filtered.filter(f => f.isCaption),
            mentions: filtered.filter(f => !f.isCaption)
        };
    }

    _emitChange() {
        const event = new CustomEvent('elements-updated');
        this.dispatchEvent(event);
        window.dispatchEvent(new CustomEvent('elements-updated'));
    }
}