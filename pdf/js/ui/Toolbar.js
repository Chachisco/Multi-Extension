import { appState } from '../core/AppState.js';
import { pdfEngine } from '../core/PdfEngine.js';
import { jumpTo } from '../utils/navigation.js';
import { logger } from '../services/LoggerService.js';
import { t } from '../services/I18nService.js';

export class Toolbar {
    constructor(state = appState, engine = pdfEngine) {
        this.state = state;
        this.engine = engine;

        this.header = document.getElementById('mini-header');
        this.zoomInput = document.getElementById('zoom-percent');
        this.pageInput = document.getElementById('page-input');
        this.pageCount = document.getElementById('page-count');
        this.container = document.getElementById('pages-container');
        this.readingRuler = document.getElementById('reading-ruler');
        this.lastReportedPage = null;
        this.pageUpdateScheduled = false;

        this._applyHeaderMode();
        this._initControls();
    }

    _initControls() {
        this._setupHeaderButtons();
        this._setupHeaderScrolling();
        this._setupVerticalToolButtons();
        this._setupToolOptions();
        this._setupDropdownMenu();

        // Sincroniza a barra quando o PDF carrega ou o zoom muda
        window.addEventListener('pdf-document-loaded', e => {
            if (this.pageCount) this.pageCount.textContent = e.detail.numPages;
            if (this.pageInput) this.pageInput.value = 1;
            this.lastReportedPage = null;
            this._updateZoomDisplay();
        });

        this.state.addEventListener('scale-changed', () => this._updateZoomDisplay());
        window.addEventListener('cycle-header-mode', () => this.cycleHeaderMode());
        window.addEventListener('page-in-view', event => {
            const pageNum = Number(event.detail?.pageNum);
            if (!Number.isInteger(pageNum) || pageNum < 1) return;
            if (this.pageInput) this.pageInput.value = pageNum;
            this.lastReportedPage = pageNum;
            const filename = this.state.currentSession?.filename;
            if (filename) {
                this.engine.storage?.adapter?.set(filename, pageNum)
                    .catch(error => logger.error('Não foi possível guardar a última página.', error));
            }
        });

        this.engine.viewport?.addEventListener('scroll', () => {
            if (this.pageUpdateScheduled) return;
            this.pageUpdateScheduled = true;
            setTimeout(() => {
                this.pageUpdateScheduled = false;
                const pages = this.container?.querySelectorAll('.page-wrapper');
                if (!pages?.length || !this.engine.viewport) return;
                const target = this.engine.viewport.scrollTop + this.engine.viewport.clientHeight / 2;
                let low = 0;
                let high = pages.length;
                while (low < high) {
                    const middle = Math.floor((low + high) / 2);
                    const page = pages[middle];
                    if (page.offsetTop + page.offsetHeight / 2 < target) low = middle + 1;
                    else high = middle;
                }
                const candidates = [pages[Math.min(low, pages.length - 1)], pages[Math.max(0, low - 1)]];
                const current = candidates.reduce((nearest, page) => {
                    const center = page.offsetTop + page.offsetHeight / 2;
                    const nearestCenter = nearest.offsetTop + nearest.offsetHeight / 2;
                    return Math.abs(center - target) < Math.abs(nearestCenter - target) ? page : nearest;
                });
                const pageNum = Number(current.dataset.pageNumber);
                if (pageNum !== this.lastReportedPage) {
                    window.dispatchEvent(new CustomEvent('page-in-view', { detail: { pageNum } }));
                }
            }, 50);
        }, { passive: true });

        document.addEventListener('mousemove', event => {
            if (this.state.focusMode === 0 || !this.readingRuler) return;
            this.readingRuler.style.setProperty('--mouse-x', `${event.clientX}px`);
            this.readingRuler.style.setProperty('--mouse-y', `${event.clientY}px`);
        }, { passive: true });

        window.addEventListener('wheel', event => {
            if (event.ctrlKey || this.state.focusMode === 0) return;
            if (event.shiftKey) {
                event.preventDefault();
                const direction = event.deltaY > 0 ? -1 : 1;
                this.state.focusSize = Math.max(10, Math.min(500, this.state.focusSize + direction * 10));
                this.readingRuler?.style.setProperty('--focus-size', `${this.state.focusSize}px`);
            } else if (this.state.focusMode === 2) {
                event.preventDefault();
                this.state.currentSession && this.engine.viewport?.scrollBy({
                    top: this.state.focusSize * Math.sign(event.deltaY) * 1.2,
                    behavior: 'auto'
                });
            }
        }, { passive: false });
    }

    // =========================================================================
    // 1. BOTÕES DO HEADER
    // =========================================================================
    _setupHeaderScrolling() {
        if (!this.header) return;
        this.header.addEventListener('wheel', event => {
            if (event.ctrlKey || this.header.scrollWidth <= this.header.clientWidth) return;
            const delta = event.deltaX || event.deltaY;
            if (!delta) return;
            this.header.scrollLeft += delta;
            event.preventDefault();
            event.stopPropagation();
        }, { passive: false });
    }

    _setupHeaderButtons() {
        document.getElementById('btn-header-mode')?.addEventListener('click', () => this.cycleHeaderMode());

        document.getElementById('btn-zoom-in')?.addEventListener('click', () => this.engine.updateZoom(this.state.currentScale + 0.1));
        document.getElementById('btn-zoom-out')?.addEventListener('click', () => this.engine.updateZoom(this.state.currentScale - 0.1));
        document.getElementById('btn-fit-width')?.addEventListener('click', () => this.fitWidth());
        document.getElementById('btn-fit-height')?.addEventListener('click', () => this.fitHeight());

        if (this.zoomInput) {
            this.zoomInput.onkeydown = e => {
                if (e.key === 'Enter') {
                    const val = parseInt(this.zoomInput.value, 10);
                    if (!isNaN(val)) this.engine.updateZoom(val / 100);
                    this.zoomInput.blur();
                }
            };
        }

        document.getElementById('btn-rotate-ccw')?.addEventListener('click', () => this.rotatePages(-90));
        document.getElementById('btn-rotate-cw')?.addEventListener('click', () => this.rotatePages(90));
        document.getElementById('btn-fullscreen')?.addEventListener('click', () => this.toggleFullscreen());

        if (this.pageInput) {
            this.pageInput.onchange = () => {
                let val = parseInt(this.pageInput.value, 10);
                const max = this.state.currentSession?.pdfDoc?.numPages || 1;
                jumpTo(Math.max(1, Math.min(max, val || 1)), { align: 'top' });
            };
        }

        const lateralSlider = document.getElementById('lateral-slider');
        if (lateralSlider) {
            lateralSlider.oninput = e => {
                this.container.style.transform = `translateX(${e.target.value * 10}px)`;
            };
        }

        const btnFocus = document.getElementById('btn-focus-mode');
        if (btnFocus) btnFocus.onclick = () => this.cycleFocusMode(btnFocus);

        const btnCopy = document.getElementById('btn-copy-url');
        if (btnCopy) {
            btnCopy.onclick = e => this._handleCopyPath(e, e.ctrlKey, btnCopy);
            btnCopy.oncontextmenu = e => this._handleCopyPath(e, true, btnCopy);
        }

        document.getElementById('btn-add-note')?.addEventListener('click', () => {
            window.dispatchEvent(new CustomEvent('create-sticky-note'));
        });
    }

    // =========================================================================
    // 2. BOTÕES DA TOOLBAR VERTICAL
    // =========================================================================
    _setupVerticalToolButtons() {
        const btnTextBox = document.getElementById('btn-text-box');
        const btnDraw = document.getElementById('btn-draw');
        const btnAnnotate = document.getElementById('btn-annotate');
        const btnEraser = document.getElementById('btn-eraser');

        const textOptions = document.getElementById('text-options');
        const annotOptions = document.getElementById('annotation-options');
        const shapeOptions = document.getElementById('shape-options');


        const deactivateAll = () => {
            this.state.deactivateAllTools();
            document.body.classList.remove('cursor-pen', 'cursor-eraser', 'cursor-text');
            textOptions?.classList.add('hidden');
            annotOptions?.classList.add('hidden');
            [btnTextBox, btnDraw, btnAnnotate, btnEraser].forEach(b => b?.classList.remove('tool-active'));
            document.querySelectorAll('.drawing-canvas').forEach(c => c.classList.remove('active'));
            document.querySelectorAll('.annotation-layer').forEach(l => l.classList.remove('eraser-active'));
        };

        if (btnTextBox) {
            btnTextBox.onclick = () => {
                const wasActive = this.state.textModeActive;
                deactivateAll();
                if (!wasActive) {
                    this.state.textModeActive = true;
                    btnTextBox.classList.add('tool-active');
                    document.body.classList.add('cursor-text');
                    textOptions?.classList.remove('hidden');
                }
            };
        }

        if (btnDraw) {
            btnDraw.onclick = () => {
                const wasActive = this.state.freehandActive;
                deactivateAll();
                if (!wasActive) {
                    this.state.freehandActive = true;
                    btnDraw.classList.add('tool-active');
                    document.body.classList.add('cursor-pen');
                    annotOptions?.classList.remove('hidden');
                    document.querySelectorAll('.opt-mode, .opt-mode-divider').forEach(el => el.style.display = 'none');
                    shapeOptions?.style.setProperty('display', 'flex');
                    document.querySelectorAll('.drawing-canvas').forEach(c => c.classList.add('active'));
                }
            };
        }

        if (btnAnnotate) {
            btnAnnotate.onclick = () => {
                const wasActive = this.state.annotationActive;
                deactivateAll();
                if (!wasActive) {
                    this.state.annotationActive = true;
                    btnAnnotate.classList.add('tool-active');
                    document.body.classList.add('cursor-pen');
                    annotOptions?.classList.remove('hidden');
                    document.querySelectorAll('.opt-mode, .opt-mode-divider').forEach(el => el.style.display = '');
                    shapeOptions?.style.setProperty('display', 'none');
                }
            };
        }

        if (btnEraser) {
            btnEraser.onclick = () => {
                const wasActive = this.state.eraserActive;
                deactivateAll();
                if (!wasActive) {
                    this.state.eraserActive = true;
                    btnEraser.classList.add('tool-active');
                    document.body.classList.add('cursor-eraser');
                    window.getSelection()?.removeAllRanges();
                    document.querySelectorAll('.annotation-layer').forEach(l => l.classList.add('eraser-active'));
                }
            };
        }
    }

    _setupToolOptions() {
        // Tamanho de Fonte
        const optTextSize = document.getElementById('opt-text-size');
        if (optTextSize) {
            optTextSize.onchange = e => { this.state.currentTextSize = Number(e.target.value); };
        }

        // Cores de Texto
        document.querySelectorAll('.opt-text-color').forEach(btn => {
            btn.onclick = () => {
                document.querySelectorAll('.opt-text-color').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.state.currentTextColor = btn.dataset.val;
            };
        });

        // Alinhamento de Texto
        document.querySelectorAll('.opt-text-align').forEach(btn => {
            btn.onclick = () => {
                document.querySelectorAll('.opt-text-align').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.state.currentTextAlign = btn.dataset.val;
            };
        });

        // Widget
        const optWidget = document.getElementById('opt-text-widget');
        if (optWidget) {
            optWidget.onclick = () => {
                this.state.currentTextIsWidget = !this.state.currentTextIsWidget;
                optWidget.classList.toggle('active', this.state.currentTextIsWidget);
            };
        }

        // Modo de Destaque
        document.querySelectorAll('.opt-mode').forEach(btn => {
            btn.onclick = () => {
                document.querySelectorAll('.opt-mode').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.state.currentAnnotationMode = btn.dataset.val;
            };
        });

        // Cores de Destaque
        document.querySelectorAll('.opt-color').forEach(btn => {
            btn.onclick = () => {
                this.state.currentAnnotationColor = btn.dataset.val;
                this._syncAnnotationOptionButtons();
            };
        });

        // Tamanho de Pincel/Sublinhado
        document.querySelectorAll('.opt-size').forEach(btn => {
            btn.onclick = () => {
                this.state.currentAnnotationSize = Number(btn.dataset.val);
                this._syncAnnotationOptionButtons();
            };
        });

        document.querySelectorAll('.opt-shape').forEach(btn => {
            btn.onclick = () => {
                document.querySelectorAll('.opt-shape').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.state.currentDrawingShape = btn.dataset.val;
            };
        });

        window.addEventListener('annotation-tool-options-changed', () => this._syncAnnotationOptionButtons());
        this._syncAnnotationOptionButtons();
    }

    _syncAnnotationOptionButtons() {
        document.querySelectorAll('.opt-color').forEach(button => {
            button.classList.toggle('active', button.dataset.val === this.state.currentAnnotationColor);
        });
        document.querySelectorAll('.opt-size').forEach(button => {
            button.classList.toggle('active', Number(button.dataset.val) === this.state.currentAnnotationSize);
        });
    }

    _setupDropdownMenu() {
        const btnDl = document.getElementById('btn-download');
        const dlMenu = document.getElementById('download-menu');
        if (btnDl && dlMenu) {
            btnDl.onclick = e => {
                e.stopPropagation();
                const willOpen = dlMenu.classList.contains('hidden');
                dlMenu.classList.toggle('hidden', !willOpen);
                if (willOpen) {
                    const rect = btnDl.getBoundingClientRect();
                    dlMenu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - dlMenu.offsetWidth - 8))}px`;
                    dlMenu.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - dlMenu.offsetHeight - 8)}px`;
                }
            };
            document.addEventListener('click', () => dlMenu.classList.add('hidden'));
        }
    }

    // =========================================================================
    // 3. AÇÕES ESPECÍFICAS DA TOOLBAR
    // =========================================================================
    cycleHeaderMode() {
        const modes = ['ghost', 'minimal', 'fixed'];
        const nextIdx = (modes.indexOf(this.state.headerMode) + 1) % modes.length;
        this.state.headerMode = modes[nextIdx];
        this._applyHeaderMode();
        
        const icons = {
            ghost: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>',
            minimal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/></svg>',
            fixed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>'
        };
        const btn = document.getElementById('btn-header-mode');
        if (btn) btn.innerHTML = icons[this.state.headerMode];
    }

    _applyHeaderMode() {
        if (!this.header) return;
        this.header.classList.remove('mode-ghost', 'mode-minimal', 'mode-fixed');
        this.header.classList.add(`mode-${this.state.headerMode}`);

        const icons = {
            ghost: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>',
            minimal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/></svg>',
            fixed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 0 1 1z"/></svg>'
        };
        const btn = document.getElementById('btn-header-mode');
        if (btn) btn.innerHTML = icons[this.state.headerMode];
    }

    cycleFocusMode(btn) {
        if (!this.readingRuler) return;
        this.state.focusMode = (this.state.focusMode + 1) % 3;
        btn.style.color = this.state.focusMode > 0 ? '#80d8ff' : '#ccc';

        this.readingRuler.className = '';
        if (this.state.focusMode === 1) {
            this.state.focusSize = 150;
            this.readingRuler.classList.add('mode-lantern');
        } else if (this.state.focusMode === 2) {
            this.state.focusSize = 25;
            this.readingRuler.classList.add('mode-line');
        }
        this.readingRuler.style.setProperty('--focus-size', `${this.state.focusSize}px`);
        this.readingRuler.style.setProperty('--mouse-x', `${window.innerWidth / 2}px`);
        this.readingRuler.style.setProperty('--mouse-y', `${window.innerHeight / 2}px`);
    }

    async fitWidth() {
        const page = await this.engine.getPage(1);
        const vp = page.getViewport({ scale: 1, rotation: (page.rotate || 0) + this.state.pageRotation });
        this.engine.updateZoom((window.innerWidth - 35) / vp.width);
    }

    async fitHeight() {
        const page = await this.engine.getPage(1);
        const vp = page.getViewport({ scale: 1, rotation: (page.rotate || 0) + this.state.pageRotation });
        this.engine.updateZoom((window.innerHeight - 50) / vp.height);
    }

    rotatePages(delta) {
        this.state.setRotation(this.state.pageRotation + delta);
        window.dispatchEvent(new CustomEvent('pdf-rotation-changed'));
        this.engine.updateZoom(this.state.currentScale);
    }

    toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(err => logger.error('Falha no fullscreen', err));
        } else {
            document.exitFullscreen();
        }
    }

    _updateZoomDisplay() {
        if (this.zoomInput) {
            this.zoomInput.value = `${Math.round(this.state.currentScale * 100)}%`;
        }
    }

    _handleCopyPath(e, isLinux, btnElement) {
        e.preventDefault();
        const fileUrl = new URLSearchParams(window.location.search).get('file');
        if (!fileUrl) return;

        let path = decodeURIComponent(fileUrl).replace(/^file:\/\/\/?/, '');
        if (path.startsWith('wsl.localhost/') || path.startsWith('wsl$/')) {
            path = isLinux ? '/' + path.split('/').slice(2).join('/') : '\\\\' + path.replace(/\//g, '\\');
        } else {
            const drive = path.match(/^([a-zA-Z]):\/(.*)/);
            if (drive) path = isLinux ? `/mnt/${drive[1].toLowerCase()}/${drive[2]}` : path.replace(/\//g, '\\');
        }

        navigator.clipboard.writeText(path).then(() => {
            const orig = btnElement.innerHTML;
            const color = isLinux ? '#80d8ff' : '#8be28b';
            btnElement.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`;
            setTimeout(() => { btnElement.innerHTML = orig; }, 2000);
            logger.success(t('path_copied', 'Caminho copiado!'));
        });
    }
}