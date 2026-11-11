import { appState } from '../core/AppState.js';
import { pdfEngine } from '../core/PdfEngine.js';
import { parseRichText } from '../utils/formatting.js';
import { jumpTo } from '../utils/navigation.js';
import { logger } from '../services/LoggerService.js';
import { t } from '../services/I18nService.js';
import { storageService } from '../services/StorageService.js';
import { SelectionToolbar } from './SelectionToolbar.js';
import { modals } from './Modals.js';
import { EraserController } from './EraserController.js';

function segmentIntersectsRect(start, end, rect) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    let min = 0;
    let max = 1;

    for (const [direction, distance] of [
        [-dx, start.x - rect.left],
        [dx, rect.right - start.x],
        [-dy, start.y - rect.top],
        [dy, rect.bottom - start.y]
    ]) {
        if (direction === 0) {
            if (distance < 0) return false;
            continue;
        }

        const ratio = distance / direction;
        if (direction < 0) min = Math.max(min, ratio);
        else max = Math.min(max, ratio);
        if (min > max) return false;
    }

    return true;
}

function pointSegmentDistance(point, start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    if (dx === 0 && dy === 0) return Math.hypot(point.x - start.x, point.y - start.y);
    const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

function segmentsIntersect(a, b, c, d) {
    const cross = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    const onSegment = (p, q, r) =>
        q.x >= Math.min(p.x, r.x) && q.x <= Math.max(p.x, r.x) &&
        q.y >= Math.min(p.y, r.y) && q.y <= Math.max(p.y, r.y);
    const abC = cross(a, b, c);
    const abD = cross(a, b, d);
    const cdA = cross(c, d, a);
    const cdB = cross(c, d, b);

    if (abC === 0 && onSegment(a, c, b)) return true;
    if (abD === 0 && onSegment(a, d, b)) return true;
    if (cdA === 0 && onSegment(c, a, d)) return true;
    if (cdB === 0 && onSegment(c, b, d)) return true;
    return (abC > 0) !== (abD > 0) && (cdA > 0) !== (cdB > 0);
}

function segmentDistance(a, b, c, d) {
    if (segmentsIntersect(a, b, c, d)) return 0;
    return Math.min(
        pointSegmentDistance(a, c, d),
        pointSegmentDistance(b, c, d),
        pointSegmentDistance(c, a, b),
        pointSegmentDistance(d, a, b)
    );
}

export class Overlays {
    constructor(state = appState, engine = pdfEngine) {
        this.state = state;
        this.engine = engine;
        this.container = document.getElementById('pages-container');
        this.notesSidebar = document.getElementById('notes-sidebar');

        // Estado do desenho livre
        this.isDrawing = false;
        this.currentPath = [];
        this.activeCanvas = null;
        this.activeCtx = null;
        this.currentDrawingPage = null;
        this.pendingDrawingStrokes = new Map();

        // Caixa de texto ativa
        this.activeTextBox = null;
        this.selectionToolbar = new SelectionToolbar();
        this.selectedObject = null;
        this.annotationElements = new WeakMap();
        this.eraserController = new EraserController({
            container: this.container,
            isEnabled: () => this.state.eraserActive,
            onError: error => logger.error('Não foi possível aplicar a borracha.', error)
        });
        this.eraserController.registerProvider(this._createAnnotationEraserProvider());
        this.eraserController.registerProvider(this._createDrawingEraserProvider());

        this._initEvents();
    }

    _initEvents() {
        // Escuta quando o PdfEngine termina de renderizar uma página
        window.addEventListener('page-rendered', e => {
            const { pageNum, wrapper } = e.detail;
            this.renderPageOverlays(pageNum, wrapper);
        });

        // Clique na folha para criar Caixas de Texto (se a ferramenta de texto estiver ativa)
        this.container.addEventListener('click', e => this._handlePageClick(e));
        this.container.addEventListener('mousedown', e => {
            this.pointerStart = { x: e.clientX, y: e.clientY };
            this.selectionAtPointerStart = e.altKey ? window.getSelection()?.toString().trim() || '' : '';
        });
        this.container.addEventListener('mouseup', e => this._handleModifiedPageClick(e));
        document.addEventListener('pointerdown', e => {
            if (e.target.closest('.pdf-selection-toolbar, .free-text-box, .pdf-bookmark-icon')) return;
            this._clearSelection();
            if (e.target.closest('.sticky-note')) return;
            document.querySelectorAll('.sticky-note.active:not(.pinned)').forEach(note => note.classList.remove('active'));
        });
        window.addEventListener('create-sticky-note', () => this.createStickyNote());
        window.addEventListener('session-changed', () => {
            this.eraserController.cancel();
            document.querySelectorAll('.sticky-note.active:not(.pinned)').forEach(note => note.classList.remove('active'));
        });
        this.state.addEventListener('tools-deactivated', () => this.eraserController.cancel());

        // Seleção de texto para criar Destaques / Sublinhados
        document.addEventListener('mouseup', () => {
            if (this.state.annotationActive) this._applyTextAnnotation();
        });

        // Atualização da régua lateral quando notas ou marcadores mudam
        window.addEventListener('notes-updated', () => {
            this._refreshPageOverlays('notes').catch(error => logger.error('Não foi possível atualizar as notas visíveis.', error));
            this.updateRulerMarkers().catch(error => logger.error('Não foi possível atualizar a régua de notas.', error));
        });
        window.addEventListener('bookmarks-updated', () => {
            this._refreshPageOverlays('bookmarks').catch(error => logger.error('Não foi possível atualizar os marcadores visíveis.', error));
            this.updateRulerMarkers().catch(error => logger.error('Não foi possível atualizar a régua de marcadores.', error));
        });
        window.addEventListener('textboxes-updated', event => {
            if (event.detail?.shouldRefresh) {
                this._refreshPageOverlays('textboxes').catch(error => logger.error('Não foi possível atualizar as caixas de texto visíveis.', error));
            }
        });
    }

    // =========================================================================
    // 1. RENDERIZAÇÃO COMPLETA DAS CAMADAS DE UMA PÁGINA
    // =========================================================================
    async renderPageOverlays(pageNum, wrapper) {
        const session = this.state.currentSession;
        if (!session) return;

        // 1. Carrega Marcadores Visuais da página
        await this._loadBookmarks(pageNum, wrapper);

        // 2. Carrega Sticky Notes
        await this._loadNotes(pageNum, wrapper);

        // 3. Carrega Caixas de Texto Livres
        await this._loadTextBoxes(pageNum, wrapper);

        // 4. Restaura desenhos e anotações persistentes
        await this._loadAnnotations(pageNum, wrapper);
        await this._loadDrawings(pageNum, wrapper);

        // 5. Inicializa o Canvas de Desenho Livre
        this._setupDrawingLayer(pageNum, wrapper);

        // 6. Configura os Botões Flutuantes da Página (Rodar, Apagar, Copiar)
        this._setupPageActionButtons(pageNum, wrapper);

        // 7. Atualiza a régua lateral
        this.updateRulerMarkers();
    }

    async _refreshPageOverlays(layer) {
        const loaders = {
            notes: this._loadNotes.bind(this),
            bookmarks: this._loadBookmarks.bind(this),
            textboxes: this._loadTextBoxes.bind(this)
        };
        const load = loaders[layer];
        if (!load) return;

        const viewportRect = this.engine.viewport?.getBoundingClientRect();
        const wrappers = [...this.container.querySelectorAll('.page-wrapper')].filter(wrapper => {
            if (wrapper.dataset.rendered === 'true') return true;
            if (!viewportRect) return false;
            const rect = wrapper.getBoundingClientRect();
            return rect.bottom > viewportRect.top && rect.top < viewportRect.bottom;
        });
        await Promise.all(wrappers.map(wrapper => load(
            Number(wrapper.dataset.pageNumber),
            wrapper
        )));
    }

    // =========================================================================
    // 2. STICKY NOTES (POST-ITS AMARELOS)
    // =========================================================================
    async _loadNotes(pageNum, wrapper) {
        const overlay = wrapper.querySelector('.notes-overlay');
        if (!overlay || !this.state.currentSession?.notes) return;
        overlay.innerHTML = '';

        const notes = await this.state.currentSession.notes.loadNotesForPage(pageNum);
        notes.forEach(note => this._createStickyNoteDOM(overlay, pageNum, note));
    }

    _createStickyNoteDOM(overlay, pageNum, note) {
        const el = document.createElement('div');
        el.className = 'sticky-note';
        el.dataset.noteId = note.id;
        if (note.isPinned) { el.classList.add('active', 'pinned'); }
        if (note.isLocked) el.classList.add('locked');
        if (!note.isExportable) el.classList.add('ghost-note');

        el.style.left = `${note.x}%`;
        el.style.top = `${note.y}%`;

        el.innerHTML = `
            <div class="note-popup">
                <div class="note-header">
                    <button class="eye-btn" title="${note.isExportable ? t('note_public', 'Pública') : t('note_private', 'Privada')}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    </button>
                    <button class="copy-btn" title="${t('note_copy', 'Copiar')}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                    </button>
                    <button class="lock-btn" title="${t('note_lock', 'Trancar')}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                    </button>
                    <button class="pin-btn" title="${t('note_pin', 'Fixar')}">
                        <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>
                    </button>
                    <button class="del-btn" title="${t('note_delete', 'Apagar')}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                </div>
                <div class="note-editor" contenteditable="${!note.isLocked}"></div>
            </div>
        `;

        const editor = el.querySelector('.note-editor');
        editor.dataset.raw = note.text;
        editor.innerHTML = note.text ? parseRichText(note.text) : '';
        if (note.width) editor.style.width = note.width;
        if (note.height) editor.style.height = note.height;

        this._bindStickyNoteEvents(el, editor, pageNum, note, overlay);
        overlay.appendChild(el);
    }

    _bindStickyNoteEvents(el, editor, pageNum, note, overlay) {
        const manager = this.state.currentSession.notes;

        // Alternar Abertura / Fecho
        el.onclick = e => {
            e.stopPropagation();
            document.querySelectorAll('.sticky-note.active:not(.pinned)').forEach(n => {
                if (n !== el) n.classList.remove('active');
            });
            el.classList.add('active');
        };

        // Edição de Texto e Rich Text
        editor.onfocus = () => { if (!note.isLocked) editor.innerText = editor.dataset.raw; };
        editor.onblur = () => {
            if (note.isLocked) return;
            editor.dataset.raw = editor.innerText;
            editor.innerHTML = parseRichText(editor.dataset.raw);
            manager.updateNote(pageNum, note.id, n => {
                n.text = editor.dataset.raw;
                n.width = editor.style.width;
                n.height = editor.style.height;
            });
        };
        editor.addEventListener('paste', e => {
            e.preventDefault();
            const text = e.clipboardData?.getData('text/plain') || '';
            document.execCommand('insertText', false, text);
        });
        editor.addEventListener('keydown', e => {
            if (e.key === 'Escape') {
                if (!note.isPinned) el.classList.remove('active');
                editor.blur();
            }
            if (e.ctrlKey && (e.key === 'Delete' || e.key === 'Backspace')) {
                e.preventDefault();
                el.querySelector('.del-btn').click();
            }
        });

        // Botões de Ação
        el.querySelector('.eye-btn').onclick = e => {
            e.stopPropagation();
            const exportable = note.toggleExportable();
            el.classList.toggle('ghost-note', !exportable);
            e.currentTarget.title = exportable ? t('note_public', 'Pública') : t('note_private', 'Privada');
            manager.updateNote(pageNum, note.id, n => n.isExportable = exportable);
        };

        el.querySelector('.lock-btn').onclick = e => {
            e.stopPropagation();
            const locked = note.toggleLock();
            el.classList.toggle('locked', locked);
            editor.contentEditable = !locked;
            if (locked) editor.blur();
            manager.updateNote(pageNum, note.id, n => n.isLocked = locked);
        };

        el.querySelector('.pin-btn').onclick = e => {
            e.stopPropagation();
            const pinned = note.togglePin();
            el.classList.toggle('pinned', pinned);
            manager.updateNote(pageNum, note.id, n => n.isPinned = pinned);
        };

        el.querySelector('.del-btn').onclick = async e => {
            e.stopPropagation();
            try {
                if (await manager.deleteNote(note.id, pageNum)) el.remove();
            } catch (error) {
                logger.error('Não foi possível apagar a nota.', error);
            }
        };

        // Copiar Texto (Clique: Formatado, Shift+Clique: RAW)
        el.querySelector('.copy-btn').onclick = async e => {
            e.stopPropagation();
            const isRaw = e.shiftKey;
            const textToCopy = isRaw ? editor.dataset.raw : editor.innerText;
            try {
                await navigator.clipboard.writeText(textToCopy);
                logger.success(isRaw ? t('copied_raw', 'Copiado (Markdown)!') : t('copied_text', 'Copiado!'));
            } catch (error) {
                logger.error(t('note_copy_failed', 'Não foi possível copiar o conteúdo da nota.'), error);
            }
        };

        // Arrasto do Post-it
        this._makeDraggable(el, overlay, (newX, newY) => {
            note.x = newX;
            note.y = newY;
            manager.updateNote(pageNum, note.id, n => { n.x = newX; n.y = newY; });
        });
    }

    // =========================================================================
    // 3. CAIXAS DE TEXTO LIVRE E WIDGETS
    // =========================================================================
    async _loadTextBoxes(pageNum, wrapper) {
        const overlay = wrapper.querySelector('.textboxes-overlay');
        if (!overlay || !this.state.currentSession?.notes) return;
        if (this.selectedObject && overlay.contains(this.selectedObject)) this._clearSelection();
        overlay.innerHTML = '';

        const boxes = await this.state.currentSession.notes.loadTextBoxesForPage(pageNum);
        boxes.forEach(box => this._createTextBoxDOM(overlay, pageNum, box));
    }

    _createTextBoxDOM(overlay, pageNum, box, startEditing = false) {
        const el = document.createElement('div');
        el.className = 'free-text-box';
        el.dataset.textboxId = box.id;
        el.tabIndex = 0;
        el.style.left = `${box.x}%`;
        el.style.top = `${box.y}%`;
        el.style.width = box.width;
        el.style.height = box.height;
        el.style.setProperty('--saved-font-size', `${box.size}px`);

        if (box.isWidget) el.classList.add('is-widget');

        const textarea = document.createElement('textarea');
        textarea.className = 'free-text-input';
        textarea.value = box.text;
        textarea.style.color = box.color;
        textarea.style.textAlign = box.align;
        textarea.placeholder = box.isWidget ? t('widget_placeholder', 'Campo de Formulário') : t('write_placeholder', 'Escreve...');

        el.appendChild(textarea);
        overlay.appendChild(el);

        let saveQueue = Promise.resolve();
        const save = () => {
            box.text = textarea.value;
            box.width = el.style.width;
            box.height = el.style.height;
            saveQueue = saveQueue.then(async () => {
                const manager = this.state.currentSession?.notes;
                if (!manager) return;
                const boxes = await manager.loadTextBoxesForPage(pageNum);
                if (!boxes.some(item => item.id === box.id)) boxes.push(box);
                await manager.saveTextBoxes(pageNum, boxes);
            }).catch(error => {
                logger.error('Não foi possível guardar a caixa de texto.', error);
            });
            return saveQueue;
        };

        textarea.addEventListener('input', save);
        const resizeObserver = new ResizeObserver(() => save());
        resizeObserver.observe(el);

        const showSelectionToolbar = () => {
            this._clearSelection();
            this.selectedObject = el;
            el.classList.add('is-selected');
            el.focus({ preventScroll: true });
            this.selectionToolbar.show(el, [
                {
                    label: t('selection_edit', 'Editar'),
                    icon: 'edit',
                    onClick: () => {
                        this.selectionToolbar.hide();
                        el.classList.add('is-editing');
                        textarea.focus();
                    }
                },
                {
                    label: t('selection_delete', 'Apagar'),
                    icon: 'delete',
                    onClick: async () => {
                        await saveQueue;
                        const deleted = await this._removeTextBox(pageNum, box.id);
                        if (!deleted) return;
                        this._clearSelection();
                        el.remove();
                        resizeObserver.disconnect();
                    }
                }
            ]);
        };

        const startTextEditing = () => {
            showSelectionToolbar();
            this.selectionToolbar.hide();
            el.classList.add('is-editing');
            textarea.focus();
        };

        el.ondblclick = startTextEditing;

        el.onkeydown = async e => {
            if (e.key === 'Enter' && !el.classList.contains('is-editing')) {
                e.preventDefault();
                startTextEditing();
                return;
            }
            if ((e.key === 'Delete' || e.key === 'Backspace') && !el.classList.contains('is-editing')) {
                e.preventDefault();
                await saveQueue;
                const deleted = await this._removeTextBox(pageNum, box.id);
                if (!deleted) return;
                this._clearSelection();
                el.remove();
                resizeObserver.disconnect();
            }
        };

        textarea.onblur = async () => {
            el.classList.remove('is-editing');
            if (textarea.value.trim() === '' && !box.isWidget) {
                this._clearSelection();
                el.remove();
                resizeObserver.disconnect();
                await saveQueue;
                await this._removeTextBox(pageNum, box.id);
            } else if (this.selectedObject === el) {
                this.selectionToolbar.show(el, [
                    { label: t('selection_edit', 'Editar'), icon: 'edit', onClick: startTextEditing },
                    {
                        label: t('selection_delete', 'Apagar'),
                        icon: 'delete',
                        onClick: async () => {
                            await saveQueue;
                            const deleted = await this._removeTextBox(pageNum, box.id);
                            if (!deleted) return;
                            this._clearSelection();
                            el.remove();
                            resizeObserver.disconnect();
                        }
                    }
                ]);
            }
        };

        this._makeDraggable(el, overlay, (newX, newY) => {
            box.x = newX;
            box.y = newY;
            save();
        }, showSelectionToolbar);

        if (startEditing) startTextEditing();
    }

    async _removeTextBox(pageNum, boxId) {
        const manager = this.state.currentSession?.notes;
        if (!manager) return false;
        try {
            await manager.deleteTextBox(pageNum, boxId);
            return true;
        } catch (error) {
            logger.error('Não foi possível apagar a caixa de texto.', error);
            return false;
        }
    }

    // =========================================================================
    // 4. CAMADA DE DESENHO LIVRE E BORRACHA
    // =========================================================================
    _setupDrawingLayer(pageNum, wrapper) {
        const canvas = wrapper.querySelector('.drawing-canvas');
        if (!canvas) return;

        const pageCanvas = wrapper.querySelector('canvas:not(.drawing-canvas)');
        canvas.width = pageCanvas.width;
        canvas.height = pageCanvas.height;
        canvas.style.width = pageCanvas.style.width;
        canvas.style.height = pageCanvas.style.height;
        const ctx = canvas.getContext('2d');
        canvas.classList.toggle('active', this.state.freehandActive);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        this._redrawPageStrokes(
            ctx,
            this.state.drawings[pageNum] || [],
            canvas.width,
            canvas.height,
            this.pendingDrawingStrokes.get(pageNum)
        );

        canvas.onmousedown = e => {
            if (!this.state.freehandActive) return;
            this.isDrawing = true;
            this.activeCanvas = canvas;
            this.activeCtx = ctx;
            this.currentDrawingPage = pageNum;

            const rect = canvas.getBoundingClientRect();
            const point = { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
            this.currentPath = [point];

            ctx.beginPath();
            ctx.moveTo(point.x * canvas.width, point.y * canvas.height);
            ctx.strokeStyle = this.state.currentAnnotationColor;
            ctx.lineWidth = this.state.currentAnnotationSize;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
        };

        canvas.onmousemove = e => {
            if (!this.isDrawing || this.activeCanvas !== canvas) return;
            const rect = canvas.getBoundingClientRect();
            const point = { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
            this.currentPath.push(point);

            this.activeCtx.lineTo(point.x * canvas.width, point.y * canvas.height);
            this.activeCtx.stroke();
        };

        const finish = () => {
            if (!this.isDrawing) return;
            this.isDrawing = false;
            if (this.currentPath.length >= 2) {
                const stroke = {
                    path: [...this.currentPath],
                    color: this.state.currentAnnotationColor,
                    size: this.state.currentAnnotationSize
                };
                this.state.drawings[pageNum] = this.state.drawings[pageNum] || [];
                this.state.drawings[pageNum].push(stroke);
                const session = this.state.currentSession;
                storageService.savePageItems(session.filename, pageNum, 'drawings', this.state.drawings[pageNum])
                    .catch(error => logger.error('Não foi possível guardar o desenho.', error));
            }
            this.currentPath = [];
        };

        canvas.onmouseup = finish;
        canvas.onmouseleave = finish;
    }

    _redrawPageStrokes(ctx, strokes, width, height, pendingStrokes = new Set()) {
        strokes.forEach(s => {
            if (s.path.length < 2) return;
            ctx.beginPath();
            ctx.strokeStyle = pendingStrokes.has(s) ? '#888888' : s.color;
            ctx.lineWidth = s.size;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.moveTo(s.path[0].x * width, s.path[0].y * height);
            s.path.slice(1).forEach(p => ctx.lineTo(p.x * width, p.y * height));
            ctx.stroke();
        });
    }

    async _loadDrawings(pageNum, wrapper) {
        const session = this.state.currentSession;
        const canvas = wrapper.querySelector('.drawing-canvas');
        if (!session || !canvas) return;
        this.state.drawings[pageNum] = await session.notes.storage.loadPageItems(
            session.filename,
            pageNum,
            'drawings'
        );
    }

    // =========================================================================
    // 5. DESTAQUES E SUBLINHADOS (SELEÇÃO DE TEXTO)
    // =========================================================================
    _applyTextAnnotation() {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || !sel.rangeCount) return;

        const range = sel.getRangeAt(0);
        const source = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
            ? range.commonAncestorContainer
            : range.commonAncestorContainer.parentElement;
        const wrapper = source?.closest('.page-wrapper');
        if (!wrapper || !wrapper.querySelector('.textLayer')?.contains(range.startContainer)) return;

        const pageNum = parseInt(wrapper.dataset.pageNumber, 10);
        const layer = wrapper.querySelector('.annotation-layer');
        const wrapperRect = wrapper.getBoundingClientRect();

        const rects = [...range.getClientRects()].filter(r => r.width && r.height);
        const annotations = this.state.annotations[pageNum] || [];
        rects.forEach(r => {
            const annotation = {
                mode: this.state.currentAnnotationMode,
                color: this.state.currentAnnotationColor,
                size: this.state.currentAnnotationSize,
                x: ((r.left - wrapperRect.left) / wrapperRect.width) * 100,
                y: ((r.top - wrapperRect.top) / wrapperRect.height) * 100,
                width: (r.width / wrapperRect.width) * 100,
                height: (r.height / wrapperRect.height) * 100
            };
            const mark = document.createElement('div');
            mark.className = `annotation-mark ${this.state.currentAnnotationMode}`;
            this._styleAnnotation(mark, annotation);
            this.annotationElements.set(mark, { pageNum, annotation });
            layer.appendChild(mark);
            annotations.push(annotation);
        });

        this.state.annotations[pageNum] = annotations;
        sel.removeAllRanges();
        this._saveAnnotations(pageNum);
    }

    _styleAnnotation(mark, annotation) {
        mark.className = `annotation-mark ${annotation.mode}`;
        mark.style.left = `${annotation.x}%`;
        mark.style.top = `${annotation.y}%`;
        mark.style.width = `${annotation.width}%`;
        mark.style.height = `${annotation.height}%`;
        mark.style.backgroundColor = annotation.color;
        mark.style.color = annotation.color;
        mark.style.borderBottomWidth = `${annotation.size}px`;
    }

    async _loadAnnotations(pageNum, wrapper) {
        const session = this.state.currentSession;
        const layer = wrapper.querySelector('.annotation-layer');
        if (!session || !layer) return;

        const annotations = await session.notes.storage.loadPageItems(session.filename, pageNum, 'annotations');
        this.state.annotations[pageNum] = annotations;
        layer.innerHTML = '';
        annotations.forEach(annotation => {
            const mark = document.createElement('div');
            this._styleAnnotation(mark, annotation);
            this.annotationElements.set(mark, { pageNum, annotation });
            layer.appendChild(mark);
        });
    }

    _createAnnotationEraserProvider() {
        return {
            getTargets: () => [...this.container.querySelectorAll('.annotation-layer.eraser-active .annotation-mark')]
                .map(element => {
                    const annotation = this.annotationElements.get(element);
                    return annotation ? { id: element, element, ...annotation } : null;
                })
                .filter(Boolean),
            hitTest: (target, start, end) => segmentIntersectsRect(start, end, target.element.getBoundingClientRect()),
            setPending: (target, pending) => target.element.classList.toggle('eraser-pending', pending),
            commit: async targets => {
                const session = this.state.currentSession;
                const removedByPage = new Map();
                targets.forEach(({ pageNum, annotation, element }) => {
                    element.remove();
                    if (!removedByPage.has(pageNum)) removedByPage.set(pageNum, new Set());
                    removedByPage.get(pageNum).add(annotation);
                });
                await Promise.all([...removedByPage].map(([pageNum, removed]) => {
                    this.state.annotations[pageNum] = (this.state.annotations[pageNum] || [])
                        .filter(annotation => !removed.has(annotation));
                    return this._saveAnnotations(pageNum, session);
                }));
            }
        };
    }

    _createDrawingEraserProvider() {
        return {
            getTargets: () => [...this.container.querySelectorAll('.page-wrapper')].flatMap(wrapper => {
                const canvas = wrapper.querySelector('.drawing-canvas');
                const pageNum = Number(wrapper.dataset.pageNumber);
                return (canvas ? this.state.drawings[pageNum] || [] : [])
                    .map(stroke => ({ id: stroke, stroke, canvas, pageNum }));
            }),
            hitTest: (target, start, end) => {
                const rect = target.canvas.getBoundingClientRect();
                const canvasWidth = target.canvas.width || rect.width;
                const radius = 8 + (Math.abs(target.stroke.size) * rect.width / canvasWidth) / 2;
                const toScreen = point => ({
                    x: rect.left + point.x * rect.width,
                    y: rect.top + point.y * rect.height
                });
                const path = target.stroke.path.map(toScreen);
                if (path.length === 1) return pointSegmentDistance(path[0], start, end) <= radius;
                return path.slice(1).some((point, index) =>
                    segmentDistance(start, end, path[index], point) <= radius
                );
            },
            setPending: (target, pending) => {
                let pendingStrokes = this.pendingDrawingStrokes.get(target.pageNum);
                if (!pendingStrokes) {
                    pendingStrokes = new Set();
                    this.pendingDrawingStrokes.set(target.pageNum, pendingStrokes);
                }
                if (pending) pendingStrokes.add(target.stroke);
                else pendingStrokes.delete(target.stroke);
                if (pendingStrokes.size === 0) this.pendingDrawingStrokes.delete(target.pageNum);
                this._redrawDrawingPage(target.pageNum);
            },
            commit: async targets => {
                const session = this.state.currentSession;
                if (!session) return;
                const removedByPage = new Map();
                targets.forEach(({ pageNum, stroke }) => {
                    if (!removedByPage.has(pageNum)) removedByPage.set(pageNum, new Set());
                    removedByPage.get(pageNum).add(stroke);
                });
                await Promise.all([...removedByPage].map(async ([pageNum, removed]) => {
                    const strokes = this.state.drawings[pageNum] || [];
                    this.state.drawings[pageNum] = strokes.filter(stroke => !removed.has(stroke));
                    this.pendingDrawingStrokes.delete(pageNum);
                    this._redrawDrawingPage(pageNum);
                    await storageService.savePageItems(
                        session.filename,
                        pageNum,
                        'drawings',
                        this.state.drawings[pageNum]
                    );
                }));
            }
        };
    }

    _redrawDrawingPage(pageNum) {
        const canvas = document.querySelector(`#page-wrapper-${pageNum} .drawing-canvas`);
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        this._redrawPageStrokes(
            ctx,
            this.state.drawings[pageNum] || [],
            canvas.width,
            canvas.height,
            this.pendingDrawingStrokes.get(pageNum)
        );
    }

    _saveAnnotations(pageNum, session = this.state.currentSession) {
        if (!session) return;
        return session.notes.storage.savePageItems(
            session.filename,
            pageNum,
            'annotations',
            this.state.annotations[pageNum] || []
        ).catch(error => logger.error('Não foi possível guardar as anotações.', error));
    }

    // =========================================================================
    // 6. MARCADORES VISUAIS DA PÁGINA (BOOKMARKS)
    // =========================================================================
    async _loadBookmarks(pageNum, wrapper) {
        const overlay = wrapper.querySelector('.bookmarks-overlay');
        if (!overlay || !this.state.currentSession?.bookmarks) return;
        if (this.selectedObject && overlay.contains(this.selectedObject)) this._clearSelection();
        overlay.innerHTML = '';

        const manager = this.state.currentSession.bookmarks;
        const bookmarks = await manager.loadPageBookmarks(pageNum);
        bookmarks.forEach(bmk => {
            const icon = document.createElement('div');
            icon.className = 'pdf-bookmark-icon';
            icon.style.top = `${bmk.y}%`;
            icon.title = bmk.title;

            icon.onclick = e => {
                e.stopPropagation();
                this._clearSelection();
                this.selectedObject = icon;
                icon.classList.add('is-selected');
                this.selectionToolbar.show(icon, [
                    {
                        label: t('selection_edit', 'Editar'),
                        icon: 'edit',
                        onClick: async () => {
                            const result = await modals.prompt(t('bookmark_rename', 'Nome do marcador:'), bmk.title);
                            if (result?.text) await manager.updateTitle(bmk.id, pageNum, result.text);
                        }
                    },
                    {
                        label: t('selection_delete', 'Apagar'),
                        icon: 'delete',
                        onClick: async () => {
                            const deleted = await manager.removeBookmark(bmk.id, pageNum);
                            if (deleted) this._clearSelection();
                        }
                    }
                ]);
                jumpTo(pageNum, { htmlY: bmk.y, align: 'center' });
            };
            overlay.appendChild(icon);
        });
    }

    // =========================================================================
    // 7. BOTÕES DE AÇÃO RÁPIDA DA PÁGINA (RODAR, APAGAR, COPIAR)
    // =========================================================================
    _setupPageActionButtons(pageNum, wrapper) {
        const overlay = wrapper.querySelector('.page-actions-overlay');
        if (!overlay) return;

        overlay.innerHTML = `
            <div class="page-actions-buttons">
                <button class="btn-page-preview" title="${t('open_page_preview', 'Abrir pré-visualização')}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                </button>
                <button class="btn-page-copy" title="${t('copy_page_text', 'Copiar texto desta página')}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                </button>
                <button class="btn-page-rotate" title="${t('btn_rotate_page', 'Rodar Página')}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.66-5.65"/></svg>
                </button>
                <button class="btn-page-delete" title="${t('btn_delete_page', 'Apagar Página')}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
            </div>
        `;

        overlay.querySelector('.btn-page-preview').onclick = e => {
            e.stopPropagation();
            window.showReferencePreview?.(pageNum, `Pág. ${pageNum}`);
        };
        overlay.querySelector('.btn-page-copy').onclick = async e => {
            e.stopPropagation();
            const textLayer = wrapper.querySelector('.textLayer');
            if (textLayer) {
                const text = [...textLayer.querySelectorAll('span')].map(span => span.textContent).join(' ');
                try {
                    await navigator.clipboard.writeText(text.trim());
                    logger.success(t('page_text_copied', 'Texto da página copiado!'));
                } catch (error) {
                    logger.error(t('page_text_copy_failed', 'Não foi possível copiar o texto da página.'), error);
                }
            }
        };
        overlay.querySelector('.btn-page-rotate').onclick = e => {
            e.stopPropagation();
            window.dispatchEvent(new CustomEvent('page-edit-requested', { detail: { action: 'rotate', pageNum } }));
        };
        overlay.querySelector('.btn-page-delete').onclick = e => {
            e.stopPropagation();
            window.dispatchEvent(new CustomEvent('page-edit-requested', { detail: { action: 'delete', pageNum } }));
        };
    }

    // =========================================================================
    // 8. RÉGUA LATERAL DE NOTAS E MARCADORES (#notes-sidebar)
    // =========================================================================
    async updateRulerMarkers() {
        if (!this.notesSidebar || !this.state.currentSession?.pdfDoc) return;
        this.notesSidebar.innerHTML = '';
        const total = this.state.currentSession.pdfDoc.numPages;

        const notes = await this.state.currentSession.notes.storage.loadAllForFile(
            this.state.currentSession.filename,
            'notes'
        );
        notes.forEach(({ pageNum, data }) => data.forEach(note => {
            const pct = (((pageNum - 1) + (note.y / 100)) / total) * 100;
            const marker = document.createElement('div');
            marker.className = 'note-marker';
            marker.style.top = `${Math.max(0.5, Math.min(99.2, pct))}%`;
            marker.title = `Nota (Pág. ${pageNum})`;
            marker.onclick = () => jumpTo(pageNum, { htmlY: note.y, align: 'center' });
            this.notesSidebar.appendChild(marker);
        }));

        // 1. Marcadores de Leitura na Régua
        if (this.state.currentSession.bookmarks) {
            const bmks = await this.state.currentSession.bookmarks.getAllBookmarks();
            bmks.forEach(b => {
                const pct = (((b.pageNum - 1) + (b.y / 100)) / total) * 100;
                const marker = document.createElement('div');
                marker.className = 'bookmark-marker';
                marker.style.top = `${Math.max(0.5, Math.min(99.2, pct))}%`;
                marker.title = `Marcador (Pág. ${b.pageNum}): ${b.title}`;
                marker.onclick = () => jumpTo(b.pageNum, { htmlY: b.y, align: 'center' });
                this.notesSidebar.appendChild(marker);
            });
        }
    }

    // =========================================================================
    // 9. AUXILIARES: ARRASTO GENÉRICO E CLIQUE NA PÁGINA
    // =========================================================================
    _handlePageClick(e) {
        if (!this.state.textModeActive) return;
        const wrapper = e.target.closest('.page-wrapper');
        if (!wrapper || e.target.closest('.free-text-box')) return;

        const rect = wrapper.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;
        const pageNum = parseInt(wrapper.dataset.pageNumber, 10);

        this.state.currentSession?.notes.addTextBox(pageNum, {
            x, y,
            size: this.state.currentTextSize,
            color: this.state.currentTextColor,
            align: this.state.currentTextAlign,
            isWidget: this.state.currentTextIsWidget
        }).then(box => this._createTextBoxDOM(wrapper.querySelector('.textboxes-overlay'), pageNum, box, true))
            .catch(error => logger.error('Não foi possível criar a caixa de texto.', error));
    }

    async _handleModifiedPageClick(e) {
        if ((!e.ctrlKey && !e.metaKey && !e.altKey) || !this.pointerStart) return;
        const distance = Math.hypot(e.clientX - this.pointerStart.x, e.clientY - this.pointerStart.y);
        const selectedText = this.selectionAtPointerStart;
        this.pointerStart = null;
        this.selectionAtPointerStart = '';
        if (distance > 5) return;

        const wrapper = e.target.closest('.page-wrapper');
        if (!wrapper || e.target.closest('.sticky-note, .free-text-box, .pdf-links-layer')) return;
        const pageNum = Number(wrapper.dataset.pageNumber);
        const rect = wrapper.getBoundingClientRect();
        const x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
        const y = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));

        if (e.altKey && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            const manager = this.state.currentSession?.bookmarks;
            if (!manager) return;
            await manager.addBookmark(pageNum, y, selectedText.slice(0, 30));
            return;
        }

        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            await this.createStickyNote(pageNum, x, y);
        }
    }

    async createStickyNote(pageNum = null, x = 50, y = 15) {
        const session = this.state.currentSession;
        if (!session?.notes) return;
        const targetPage = pageNum || this._getVisiblePageNumber();
        const wrapper = document.getElementById(`page-wrapper-${targetPage}`);
        const overlay = wrapper?.querySelector('.notes-overlay');
        if (!overlay) return;

        try {
            const note = await session.notes.addNote(targetPage, { x, y });
            await this._loadNotes(targetPage, wrapper);
            const element = overlay.querySelector(`[data-note-id="${CSS.escape(note.id)}"]`);
            element?.classList.add('active');
            element?.querySelector('.note-editor')?.focus();
        } catch (error) {
            logger.error('Não foi possível criar a nota.', error);
        }
    }

    _getVisiblePageNumber() {
        const viewportRect = document.getElementById('viewport').getBoundingClientRect();
        const pages = [...this.container.querySelectorAll('.page-wrapper')];
        const visible = pages.find(wrapper => {
            const rect = wrapper.getBoundingClientRect();
            return rect.bottom > viewportRect.top && rect.top < viewportRect.bottom;
        });
        if (visible) return Number(visible.dataset.pageNumber);
        return Number(this.state.currentSession?.pdfDoc ? 1 : 0);
    }

    _createBookmarkDOM(overlay, pageNum, bookmark) {
        if (!overlay) return;
        const icon = document.createElement('div');
        icon.className = 'pdf-bookmark-icon';
        icon.style.top = `${bookmark.y}%`;
        icon.title = bookmark.title;
        icon.onclick = e => {
            e.stopPropagation();
            jumpTo(pageNum, { htmlY: bookmark.y, align: 'center' });
        };
        overlay.appendChild(icon);
    }

    _clearSelection() {
        this.selectedObject?.classList.remove('is-selected');
        this.selectedObject = null;
        this.selectionToolbar.hide();
    }

    _makeDraggable(el, container, onMoveEnd, onSelect = null) {
        el.onmousedown = e => {
            if (
                el.classList.contains('is-editing') ||
                e.target.closest('.note-popup, textarea, button, input')
            ) return;
            onSelect?.();
            e.preventDefault();

            const startX = e.clientX;
            const startY = e.clientY;
            const startLeft = parseFloat(el.style.left) || 0;
            const startTop = parseFloat(el.style.top) || 0;
            const rect = container.getBoundingClientRect();

            let moved = false;
            const onMouseMove = ev => {
                const dx = ev.clientX - startX;
                const dy = ev.clientY - startY;
                if (!moved && Math.hypot(dx, dy) <= 4) return;
                moved = true;

                const newX = Math.max(0, Math.min(98, startLeft + (dx / rect.width) * 100));
                const newY = Math.max(0, Math.min(98, startTop + (dy / rect.height) * 100));
                el.style.left = `${newX}%`;
                el.style.top = `${newY}%`;
                this.selectionToolbar.position();
            };

            const onMouseUp = () => {
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
                if (moved && typeof onMoveEnd === 'function') {
                    onMoveEnd(parseFloat(el.style.left), parseFloat(el.style.top));
                }
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        };
    }
}