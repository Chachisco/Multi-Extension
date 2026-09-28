import { state } from './state.js';

export function setupTextBoxes() {
    const style = document.createElement('style');
    style.innerHTML = `.cursor-text * { cursor: text !important; }`;
    document.head.appendChild(style);
}

// NOVO: Regista qual é a caixa de texto que o utilizador tem selecionada no momento
export let activeTextBox = null;

export function createTextBox(overlay, pageNum, x, y, text = '', options = {}) {
    if (!overlay) return;

    const box = document.createElement('div');
    box.className = 'free-text-box';
    box.style.left = `${x}%`;
    box.style.top = `${y}%`;
    box.style.width = options.width || '150px';
    box.style.height = options.height || '30px';
    box.tabIndex = 0; // Torna a div capaz de receber "Focus"
    
    const size = options.size || state.currentTextSize;
    const color = options.color || state.currentTextColor;
    const align = options.align || state.currentTextAlign;
    const isWidget = options.isWidget !== undefined ? options.isWidget : state.currentTextIsWidget;

    box.dataset.size = size;
    box.dataset.color = color;
    box.dataset.align = align;
    box.dataset.isWidget = isWidget;
    
    box.style.setProperty('--saved-font-size', `${size}px`);
    if (String(isWidget) === 'true') box.classList.add('is-widget');

    const textarea = document.createElement('textarea');
    textarea.className = 'free-text-input';
    textarea.value = text;
    textarea.placeholder = String(isWidget) === 'true' ? "Widget Editável" : "Escreve...";
    textarea.style.color = color;
    textarea.style.textAlign = align;

    box.appendChild(textarea);
    overlay.appendChild(box);

    const save = () => { saveTextBoxesForPage(pageNum, overlay); };
    textarea.addEventListener('input', save);
    new ResizeObserver(save).observe(box); 

    // --- A NOVA LÓGICA DE INTERAÇÃO EM DOIS ESTADOS ---

    // 1. Clicar (Seleciona a caixa inteira como Objeto)
    box.onmousedown = (e) => {
        // Se a caixa não for a ativa globalmente, torna-se!
        if (activeTextBox !== box) {
            activeTextBox = box;
            box.focus();
            
            // Sincroniza a barra de menu superior com a cor/tamanho da caixa que clicaste!
            syncToolbarWithBox(box);
        }

        // Se a caixa estiver em modo "Edição de Texto", não faças "drag" (permite selecionar texto!)
        if (box.classList.contains('is-editing')) return;

        // Se está só focada como objeto, pode arrastar!
        e.preventDefault();
        const startX = e.clientX;
        const startY = e.clientY;
        const startLeft = parseFloat(box.style.left) || 0;
        const startTop = parseFloat(box.style.top) || 0;
        const rect = overlay.getBoundingClientRect();

        const onMouseMove = (moveEvent) => {
            const dx = moveEvent.clientX - startX;
            const dy = moveEvent.clientY - startY;
            box.style.left = `${Math.max(0, Math.min(100, startLeft + (dx / rect.width) * 100))}%`;
            box.style.top = `${Math.max(0, Math.min(100, startTop + (dy / rect.height) * 100))}%`;
        };
        const onMouseUp = () => {
            save();
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    };

    // 2. Duplo Clique ou Enter (Ativa a escrita)
    box.ondblclick = () => {
        box.classList.add('is-editing');
        textarea.focus();
    };

    box.onkeydown = (e) => {
        // Enter na caixa (sem estar a escrever) ativa o texto!
        if (e.key === 'Enter' && !box.classList.contains('is-editing')) {
            e.preventDefault();
            box.classList.add('is-editing');
            textarea.focus();
        }
        // Del na caixa inteira = Apagar!
        if ((e.key === 'Delete' || e.key === 'Backspace') && !box.classList.contains('is-editing')) {
            box.remove();
            activeTextBox = null;
            save();
        }
    };

    textarea.addEventListener('blur', () => {
        setTimeout(() => {
            box.classList.remove('is-editing');
            if (activeTextBox === box) activeTextBox = null;
            if (textarea.value.trim() === '' && String(box.dataset.isWidget) !== 'true') {
                box.remove();
                save();
            }
        }, 150);
    });

    if (text === '') {
        setTimeout(() => {
            activeTextBox = box;
            box.focus();
            box.classList.add('is-editing');
            textarea.focus();
            
            syncToolbarWithBox(box);
        }, 100); 
    }
}

function syncToolbarWithBox(box) {
    document.getElementById('opt-text-size').value = box.dataset.size;
    
    document.querySelectorAll('.opt-text-color').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.val === box.dataset.color);
    });
    document.querySelectorAll('.opt-text-align').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.val === box.dataset.align);
    });
    document.getElementById('opt-text-widget').classList.toggle('active', box.dataset.isWidget === 'true');
}

export function saveTextBoxesForPage(pageNum, overlay) {
    const boxes = Array.from(overlay.querySelectorAll('.free-text-box')).map(box => ({
        x: parseFloat(box.style.left),
        y: parseFloat(box.style.top),
        width: box.style.width,
        height: box.style.height,
        text: box.querySelector('textarea').value,
        size: box.dataset.size,
        color: box.dataset.color,
        align: box.dataset.align,
        isWidget: box.dataset.isWidget === 'true'
    }));
    chrome.storage.local.set({ [`${state.currentFilename}_pg${pageNum}_textboxes`]: boxes });
}

export async function loadTextBoxesForPage(pageNum) {
    const overlay = document.querySelector(`#page-wrapper-${pageNum} .textboxes-overlay`);
    if (!overlay) return;
    overlay.innerHTML = '';
    
    const key = `${state.currentFilename}_pg${pageNum}_textboxes`;
    const result = await new Promise(resolve => chrome.storage.local.get([key], resolve));
    
    (result[key] || []).forEach(b => {
        createTextBox(overlay, pageNum, b.x, b.y, b.text, {
            width: b.width, height: b.height, size: b.size, color: b.color, align: b.align, isWidget: b.isWidget
        });
    });
}