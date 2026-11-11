/**
 * Estado Global e Reativo da Aplicação
 */
export class AppState extends EventTarget {
    constructor() {
        super();

        // 1. Sessão do Documento Atual (iniciada pelo PdfEngine ao abrir um PDF)
        this.currentSession = null;
        /*
          Estrutura da currentSession:
          {
             filename: string,
             pdfDoc: PDFDocumentProxy,
             pdfBytes: ArrayBuffer,
             isSigned: boolean,
             history: HistoryManager,
             bookmarks: BookmarkManager,
             elements: ElementsManager,
             notes: NotesManager
          }
        */

        // 2. Visualização e Geometria
        this.currentScale = 1.0;
        this.pageRotation = 0;
        this.headerMode = 'fixed'; // 'ghost' | 'minimal' | 'fixed'
        this.focusMode = 0;          // 0: desligado, 1: lanterna, 2: régua de leitura
        this.focusSize = 150;

        // 3. Active Tools
        this.annotationActive = false;
        this.eraserActive = false;
        this.freehandActive = false;
        this.textModeActive = false;

        // 4. Configurações de Ferramentas
        this.currentAnnotationMode = 'highlight'; // 'highlight' | 'underline'
        this.currentAnnotationColor = '#ffeb3b';
        this.currentAnnotationSize = 4;

        this.currentTextSize = 12;
        this.currentTextColor = '#000000';
        this.currentTextAlign = 'left';
        this.currentTextIsWidget = false;

        // 5. Controlo de Renderização do PDF.js
        this.renderTasks = {};
        this.renderingStates = {};
        this.textLayerTasks = {};
        this.drawings = {}; // pageNum -> drawings
        this.annotations = {}; // pageNum -> text annotations
    }

    /**
     * Define a nova sessão do documento aberto
     */
    setSession(session) {
        this.currentSession = session;
        this.renderTasks = {};
        this.renderingStates = {};
        this.textLayerTasks = {};
        this.drawings = {};
        this.annotations = {};
        this.dispatchEvent(new CustomEvent('session-changed', { detail: session }));
    }

    /**
     * Desativa todas as ferramentas de desenho/escrita
     */
    deactivateAllTools() {
        this.annotationActive = false;
        this.eraserActive = false;
        this.freehandActive = false;
        this.textModeActive = false;
        this.dispatchEvent(new CustomEvent('tools-deactivated'));
    }

    setScale(scale) {
        this.currentScale = Math.min(Math.max(0.1, scale), 5.0);
        this.dispatchEvent(new CustomEvent('scale-changed', { detail: this.currentScale }));
    }

    setRotation(rotation) {
        this.pageRotation = (rotation % 360 + 360) % 360;
        this.dispatchEvent(new CustomEvent('rotation-changed', { detail: this.pageRotation }));
    }
}

export const appState = new AppState();