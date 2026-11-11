import { appState } from '../core/AppState.js';
import { pdfEngine } from '../core/PdfEngine.js';
import { jumpTo } from '../utils/navigation.js';
import { logger } from '../services/LoggerService.js';

export class ShortcutManager {
    constructor(state = appState, engine = pdfEngine) {
        this.state = state;
        this.engine = engine;
        this.isShiftPressed = false;

        // Mapa de Atalhos Padrão (Fácil de exportar/importar para JSON ou Custom Settings)
        this.bindings = [
            // Histórico
            { key: 'z', ctrl: true, shift: false, action: () => this.state.currentSession?.history.undo() },
            { key: 'z', ctrl: true, shift: true,  action: () => this.state.currentSession?.history.redo() },
            { key: 'y', ctrl: true, shift: false, action: () => this.state.currentSession?.history.redo() },

            // Zoom
            { key: '+', ctrl: true, action: () => this.engine.updateZoom(this.state.currentScale + 0.1) },
            { key: '=', ctrl: true, action: () => this.engine.updateZoom(this.state.currentScale + 0.1) },
            { key: '-', ctrl: true, action: () => this.engine.updateZoom(this.state.currentScale - 0.1) },
            { key: '0', ctrl: true, action: () => this.engine.updateZoom(1.0) },

            // Modos e Navegação
            { key: 'h', ctrl: false, action: () => window.dispatchEvent(new CustomEvent('cycle-header-mode')) },
            { key: 'ArrowDown', ctrl: false, alt: false, action: () => this._navigatePage(1) },
            { key: 'ArrowRight', ctrl: false, alt: false, action: () => this._navigatePage(1) },
            { key: 'ArrowUp', ctrl: false, alt: false, action: () => this._navigatePage(-1) },
            { key: 'ArrowLeft', ctrl: false, alt: false, action: () => this._navigatePage(-1) },

            // Sidebar: Mudar de lado (Alt + Setas)
            { key: 'ArrowRight', alt: true, action: () => window.dispatchEvent(new CustomEvent('sidebar-set-side', { detail: 'right' })) },
            { key: 'ArrowLeft', alt: true, action: () => window.dispatchEvent(new CustomEvent('sidebar-set-side', { detail: 'left' })) }
        ];

        this._initListeners();
    }

    _initListeners() {
        // 1. Pressed keys
        window.addEventListener('keydown', e => this._handleKeyDown(e), { capture: true });

        // 2. Rastreamento da tecla Shift (usada para Shift+Click em links/preview)
        window.addEventListener('keydown', e => { if (e.key === 'Shift') this.isShiftPressed = true; });
        window.addEventListener('keyup', e => { if (e.key === 'Shift') this.isShiftPressed = false; });
        window.addEventListener('blur', () => { this.isShiftPressed = false; });

        // 3. Zoom com a Roda do Rato (Ctrl + Wheel)
        window.addEventListener('wheel', e => {
            if (e.ctrlKey) {
                e.preventDefault();
                const delta = e.deltaY > 0 ? -0.1 : 0.1;
                this.engine.updateZoom(this.state.currentScale + delta);
            }
        }, { passive: false });
    }

    _handleKeyDown(e) {
        const isUndo = (e.ctrlKey || e.metaKey) && !e.altKey &&
            (e.key.toLowerCase() === 'z' || (e.key.toLowerCase() === 'y' && !e.shiftKey));
        if (isUndo) {
            e.preventDefault();
            const history = this.state.currentSession?.history;
            const operation = e.key.toLowerCase() === 'y' || e.shiftKey
                ? history?.redo()
                : history?.undo();
            operation?.catch(error => logger.error('Não foi possível desfazer/refazer a ação.', error));
            return;
        }

        // Ignora atalhos globais se o utilizador estiver a escrever num input/textarea
        const active = document.activeElement;
        const isTyping = active?.tagName === 'INPUT' || active?.tagName === 'TEXTAREA' || active?.isContentEditable;
        if (isTyping) {
            if (e.key === 'Escape') active.blur();
            return;
        }

        const pressedKey = e.key.toLowerCase();
        const binding = this.bindings.find(b => {
            const matchesKey = b.key.toLowerCase() === pressedKey;
            const matchesCtrl = b.ctrl ? (e.ctrlKey || e.metaKey) : (!b.ctrl || (!e.ctrlKey && !e.metaKey));
            const matchesShift = b.shift !== undefined ? b.shift === e.shiftKey : true;
            const matchesAlt = b.alt !== undefined ? b.alt === e.altKey : true;
            return matchesKey && matchesCtrl && matchesShift && matchesAlt;
        });

        if (binding) {
            e.preventDefault();
            binding.action();
        }
    }

    _navigatePage(delta) {
        if (this.state.focusMode === 2) {
            this.engine.viewport?.scrollBy({
                top: delta * this.state.focusSize * 1.2,
                behavior: 'smooth'
            });
            return;
        }
        const pageInput = document.getElementById('page-input');
        const current = parseInt(pageInput?.value, 10) || 1;
        const total = this.state.currentSession?.pdfDoc?.numPages || 1;
        const next = Math.max(1, Math.min(total, current + delta));
        jumpTo(next, { align: 'top' });
    }
}

export const shortcutManager = new ShortcutManager();