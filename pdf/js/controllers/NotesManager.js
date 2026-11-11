import { StickyNote } from '../models/Note.js';
import { FreeTextBox } from '../models/TextBox.js';
import { storageService } from '../services/StorageService.js';

export class NotesManager extends EventTarget {
    constructor(filename, history, storage = storageService) {
        super();
        this.filename = filename;
        this.storage = storage;
        this.history = history;
        this.notesCache = new Map();     // pageNum -> StickyNote[]
        this.textBoxesCache = new Map(); // pageNum -> FreeTextBox[]
    }

    // =========================================================
    // 1. STICKY NOTES (POST-ITS)
    // =========================================================
    async loadNotesForPage(pageNum) {
        if (this.notesCache.has(pageNum)) {
            return this.notesCache.get(pageNum);
        }

        const raw = await this.storage.loadPageItems(this.filename, pageNum, 'notes');
        const notes = raw.map(item => StickyNote.fromJSON(item, pageNum));
        this.notesCache.set(pageNum, notes);
        return notes;
    }

    async addNote(pageNum, { x = 50, y = 10, text = '', isPinned = false } = {}) {
        const notes = await this.loadNotesForPage(pageNum);
        const note = new StickyNote({ pageNum, x, y, text, isPinned });
        notes.push(note);

        await this.storage.savePageItems(this.filename, pageNum, 'notes', notes);

        this.history.record({
            label: 'Adicionar Nota',
            undo: async () => {
                await this.deleteNote(note.id, pageNum, false);
            },
            redo: async () => {
                const list = await this.loadNotesForPage(pageNum);
                list.push(note);
                await this.storage.savePageItems(this.filename, pageNum, 'notes', list);
                this._emitNotesChange();
            }
        });

        this._emitNotesChange();
        return note;
    }

    async updateNote(pageNum, noteId, updaterFn) {
        const notes = await this.loadNotesForPage(pageNum);
        const note = notes.find(n => n.id === noteId);
        if (!note) return false;

        updaterFn(note);
        await this.storage.savePageItems(this.filename, pageNum, 'notes', notes);
        this._emitNotesChange();
        return true;
    }

    async deleteNote(noteId, pageNum, recordHistory = true) {
        const notes = await this.loadNotesForPage(pageNum);
        const idx = notes.findIndex(n => n.id === noteId);
        if (idx === -1) return false;
        if (notes[idx].isLocked) return false;

        const removed = notes[idx];
        const updatedNotes = notes.filter((_, index) => index !== idx);
        await this.storage.savePageItems(this.filename, pageNum, 'notes', updatedNotes);
        notes.splice(0, notes.length, ...updatedNotes);

        if (recordHistory) {
            this.history.record({
                label: 'Apagar Nota',
                undo: async () => {
                    const list = await this.loadNotesForPage(pageNum);
                    const restored = [...list];
                    restored.splice(Math.min(idx, restored.length), 0, removed);
                    await this.storage.savePageItems(this.filename, pageNum, 'notes', restored);
                    list.splice(0, list.length, ...restored);
                    this._emitNotesChange();
                },
                redo: async () => {
                    await this.deleteNote(noteId, pageNum, false);
                }
            });
        }

        this._emitNotesChange();
        return true;
    }

    // =========================================================
    // 2. FREE TEXT BOXES (CAIXAS DE TEXTO LIVRE E WIDGETS)
    // =========================================================
    async loadTextBoxesForPage(pageNum) {
        if (this.textBoxesCache.has(pageNum)) {
            return this.textBoxesCache.get(pageNum);
        }

        const raw = await this.storage.loadPageItems(this.filename, pageNum, 'textboxes');
        const boxes = raw
            .map(item => FreeTextBox.fromJSON(item, pageNum))
            .filter(box => box.isWidget || box.text.trim());
        if (boxes.length !== raw.length) {
            await this.storage.savePageItems(this.filename, pageNum, 'textboxes', boxes);
        }
        this.textBoxesCache.set(pageNum, boxes);
        return boxes;
    }

    async addTextBox(pageNum, params) {
        const boxes = await this.loadTextBoxesForPage(pageNum);
        const box = new FreeTextBox({ pageNum, ...params });
        boxes.push(box);

        await this.storage.savePageItems(this.filename, pageNum, 'textboxes', boxes);
        this.history.record({
            label: 'Adicionar caixa de texto',
            undo: async () => this.deleteTextBox(pageNum, box.id, false),
            redo: async () => {
                const list = await this.loadTextBoxesForPage(pageNum);
                list.push(box);
                await this.storage.savePageItems(this.filename, pageNum, 'textboxes', list);
                this._emitTextBoxesChange(true);
            }
        });
        this._emitTextBoxesChange();
        return box;
    }

    async saveTextBoxes(pageNum, boxesList, shouldRefresh = false) {
        const savedBoxes = boxesList.filter(box => box.isWidget || box.text?.trim());
        this.textBoxesCache.set(pageNum, savedBoxes);
        await this.storage.savePageItems(this.filename, pageNum, 'textboxes', savedBoxes);
        this._emitTextBoxesChange(shouldRefresh);
    }

    async deleteTextBox(pageNum, boxId, recordHistory = true) {
        const boxes = await this.loadTextBoxesForPage(pageNum);
        const index = boxes.findIndex(box => box.id === boxId);
        if (index === -1) return false;
        const removed = boxes[index];
        const updated = boxes.filter(box => box.id !== boxId);
        await this.storage.savePageItems(this.filename, pageNum, 'textboxes', updated);
        boxes.splice(0, boxes.length, ...updated);

        if (recordHistory) {
            this.history.record({
                label: 'Apagar caixa de texto',
                undo: async () => {
                    const list = await this.loadTextBoxesForPage(pageNum);
                    const restored = [...list];
                    restored.splice(Math.min(index, restored.length), 0, removed);
                    await this.storage.savePageItems(this.filename, pageNum, 'textboxes', restored);
                    list.splice(0, list.length, ...restored);
                    this._emitTextBoxesChange(true);
                },
                redo: async () => this.deleteTextBox(pageNum, boxId, false)
            });
        }

        this._emitTextBoxesChange(true);
        return true;
    }

    _emitNotesChange() {
        this.dispatchEvent(new CustomEvent('notes-updated'));
        window.dispatchEvent(new CustomEvent('notes-updated'));
    }

    _emitTextBoxesChange(shouldRefresh = false) {
        const event = new CustomEvent('textboxes-updated', { detail: { shouldRefresh } });
        this.dispatchEvent(event);
        window.dispatchEvent(new CustomEvent('textboxes-updated', { detail: { shouldRefresh } }));
    }
}