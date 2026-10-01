import { state } from './state.js';
import { record } from './history.js';

export function addNoteToUI(overlay, pageNum, x, y, text, isPinned = false, isLocked = false, isExportable = true) {
    if (!overlay) return;
    const note = document.createElement('div');
    note.className = 'sticky-note';
    
    if (isPinned) {
        note.classList.add('active');
        note.classList.add('pinned');
    }
    if (isLocked) note.classList.add('locked');
    if (!isExportable) note.classList.add('ghost-note');
    
    note.style.left = `${x}%`;
    note.style.top = `${y}%`;
    note.tabIndex = 0;

    const popup = document.createElement('div');
    popup.className = 'note-popup';

    const header = document.createElement('div');
    header.className = 'note-header';

    // 0. Botão de Visibilidade
    const eyeBtn = document.createElement('button');
    eyeBtn.className = 'eye-btn';
    eyeBtn.title = isExportable ? 'Nota Pública (Será exportada)' : 'Nota Secreta (Não será exportada)';
    eyeBtn.innerHTML = isExportable 
        ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`
        : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
    
    eyeBtn.onclick = (e) => {
        e.stopPropagation();
        const isHidden = note.classList.toggle('ghost-note');
        eyeBtn.title = isHidden ? 'Nota Secreta (Não será exportada)' : 'Nota Pública (Será exportada)';
        eyeBtn.innerHTML = isHidden
            ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`
            : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
        saveNotesForPage(pageNum, overlay);
    };

    // 1. Botão de Copiar
    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-btn';
    copyBtn.title = 'Copiar (Click: Formato Rico | Shift+Click: Texto Cru)';
    copyBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
    
    copyBtn.onclick = async (e) => {
        e.stopPropagation();
        const isRaw = e.shiftKey;
        
        try {
            if (isRaw) {
                await navigator.clipboard.writeText(editor.dataset.raw);
            } else {
                const htmlToCopy = document.activeElement === editor ? parseRichText(editor.dataset.raw) : editor.innerHTML;
                const plainToCopy = editor.innerText;
                
                const clipboardItem = new ClipboardItem({
                    "text/plain": new Blob([plainToCopy], { type: "text/plain" }),
                    "text/html": new Blob([htmlToCopy], { type: "text/html" })
                });
                await navigator.clipboard.write([clipboardItem]);
            }
            
            // Feedback Visual (Fica verde e avisa o que copiou)
            const originalHTML = copyBtn.innerHTML;
            const originalTitle = copyBtn.title;
            
            copyBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="#8be28b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
            copyBtn.title = isRaw ? 'Copiado (RAW)!' : 'Copiado (Formatado)!';
            
            setTimeout(() => { 
                copyBtn.innerHTML = originalHTML; 
                copyBtn.title = originalTitle;
            }, 2000);
            
        } catch (err) {
            console.error("Erro ao copiar (usando fallback):", err);
            // Fallback de segurança se o browser bloquear a API avançada
            navigator.clipboard.writeText(isRaw ? editor.dataset.raw : editor.innerText);
        }
    };

    // 2. Botão de Lock
    const lockBtn = document.createElement('button');
    lockBtn.className = 'lock-btn';
    lockBtn.title = 'Trancar nota (Proteger contra apagamento)';
    lockBtn.innerHTML = isLocked 
        ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>` 
        : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>`; 
    
    lockBtn.onclick = (e) => {
        e.stopPropagation();
        const locked = note.classList.toggle('locked');
        editor.contentEditable = !locked;
        lockBtn.innerHTML = locked 
            ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`
            : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>`;
        saveNotesForPage(pageNum, overlay);
    };

    // 3. Botão de Pin
    const pinBtn = document.createElement('button');
    pinBtn.className = 'pin-btn';
    pinBtn.title = 'Manter aberta';
    pinBtn.innerHTML = `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>`;
    pinBtn.onclick = (e) => {
        e.stopPropagation();
        const pinned = note.classList.toggle('pinned');
        note.classList.toggle(pinned);
        saveNotesForPage(pageNum, overlay);
    };

    // 4. Botão de Lixo
    const delBtn = document.createElement('button');
    delBtn.className = 'del-btn';
    delBtn.title = 'Apagar nota';
    delBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
    delBtn.onclick = (e) => {
        e.stopPropagation();
        deleteNote();
    };

    const editor = document.createElement('div');
    editor.className = 'note-editor';
    editor.contentEditable = !isLocked;
    editor.dataset.raw = text;
    editor.innerHTML = text === '' ? '' : parseRichText(text);
    if (text === '') editor.setAttribute('placeholder', 'Escreve a tua nota...');

    // copyBtn.onclick = (e) => {
    //     e.stopPropagation();
    //     navigator.clipboard.writeText(editor.dataset.raw);
    //     const originalHTML = copyBtn.innerHTML;
    //     copyBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="#333" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
    //     setTimeout(() => { copyBtn.innerHTML = originalHTML; }, 1500);
    // };

    header.onmousedown = (e) => {
        e.preventDefault(); 
    };

    header.appendChild(eyeBtn);
    header.appendChild(copyBtn);
    header.appendChild(lockBtn);
    header.appendChild(pinBtn);
    header.appendChild(delBtn);
    
    popup.appendChild(header);
    popup.appendChild(editor);
    note.appendChild(popup);
    overlay.appendChild(note);

    let hasDragged = false;
    note.onmousedown = (e) => {
        if (e.target.closest('.note-popup')) return;
        e.preventDefault();
        const startX = e.clientX;
        const startY = e.clientY;
        const startLeft = parseFloat(note.style.left) || 0;
        const startTop = parseFloat(note.style.top) || 0;
        const rect = overlay.getBoundingClientRect();
        hasDragged = false;

        const onMouseMove = (moveEvent) => {
            const dx = moveEvent.clientX - startX;
            const dy = moveEvent.clientY - startY;
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
                hasDragged = true;
                let newX = startLeft + (dx / rect.width) * 100;
                let newY = startTop + (dy / rect.height) * 100;
                note.style.left = `${Math.max(0, Math.min(100, newX))}%`;
                note.style.top = `${Math.max(0, Math.min(100, newY))}%`;
            }
        };

        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            if (hasDragged) saveNotesForPage(pageNum, overlay); 
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    };

    editor.addEventListener('paste', (e) => {
        e.preventDefault();
        const text = (e.originalEvent || e).clipboardData.getData('text/plain');
        
        const selection = window.getSelection();
        if (!selection.rangeCount) return;
        
        const range = selection.getRangeAt(0);
        range.deleteContents();
        
        const textNode = document.createTextNode(text);
        range.insertNode(textNode);
        
        range.setStartAfter(textNode);
        range.setEndAfter(textNode);
        selection.removeAllRanges();
        selection.addRange(range);
        
        editor.dispatchEvent(new Event('input'));
    });

    note.onclick = (e) => {
        if (hasDragged) return; 
        e.stopPropagation();
        if (note.classList.contains('pinned')) {
            note.classList.add('active');
            return;
        }
        document.querySelectorAll('.sticky-note.active').forEach(item => {
            if (item !== note && !item.classList.contains('pinned')) item.classList.remove('active');
        });
        note.classList.add('active');
    };

    editor.onmousedown = (e) => {
        if (note.classList.contains('locked')) return;
    };

    editor.onfocus = () => {
        if (note.classList.contains('locked')) return;
        editor.innerText = editor.dataset.raw; 
    };

    editor.onblur = () => {
        editor.dataset.raw = editor.innerText;
        editor.innerHTML = parseRichText(editor.dataset.raw);
        saveNotesForPage(pageNum, overlay);
    };

    editor.oninput = () => {
        if (document.activeElement === editor) {
            editor.dataset.raw = editor.innerText;
            saveNotesForPage(pageNum, overlay);
        }
    };

    editor.onkeydown = (e) => {
        if (e.key === 'Escape') {
            if (!note.classList.contains('pinned')) note.classList.remove('active');
            editor.blur();
        }
        if (e.ctrlKey && (e.key === 'Delete' || e.key === 'Backspace')) {
            e.preventDefault();
            deleteNote();
        }
    };

    if (text === '') setTimeout(() => { note.classList.add('active'); editor.focus(); }, 50);

    let deletedNote = note;
    function deleteNote() {
        if (note.classList.contains('locked')) return;

        const noteData = {
            pageNum,
            x: parseFloat(note.style.left),
            y: parseFloat(note.style.top),
            text: editor.dataset.raw, // Lemos sempre o RAW para o histórico!
            pinned: note.classList.contains('pinned'),
            locked: note.classList.contains('locked'),
            exportable: !note.classList.contains('ghost-note')
        };

        note.remove();
        saveNotesForPage(pageNum, overlay);
        record({
            label: 'Apagar nota',
            undo: () => {
                deletedNote = addNoteToUI(overlay, pageNum, noteData.x, noteData.y, noteData.text, noteData.pinned, noteData.locked, noteData.exportable);
                saveNotesForPage(pageNum, overlay);
            },
            redo: () => {
                if (deletedNote?.classList.contains('locked')) return false;
                deletedNote?.remove();
                saveNotesForPage(pageNum, overlay);
            }
        });
    }

    return note;
}

export function saveNotesForPage(pageNum, overlay) {
    const notes = Array.from(overlay.querySelectorAll('.sticky-note')).map(note => ({
        x: parseFloat(note.style.left),
        y: parseFloat(note.style.top),
        text: note.querySelector('.note-editor').dataset.raw,
        pinned: note.classList.contains('pinned'),
        locked: note.classList.contains('locked'),
        exportable: !note.classList.contains('ghost-note')
    }));
    chrome.storage.local.set({ [`${state.currentFilename}_pg${pageNum}_notes`]: notes }, () => {
        updateNotesSidebar();
    });
}

export function loadNotesForPage(pageNum) {
    const overlay = document.querySelector(`#page-wrapper-${pageNum} .notes-overlay`);
    if (!overlay) return;
    overlay.innerHTML = '';
    const key = `${state.currentFilename}_pg${pageNum}_notes`;
    chrome.storage.local.get([key], result => {
        (result[key] || []).forEach(note => addNoteToUI(overlay, pageNum, note.x, note.y, note.text, note.pinned, note.locked, note.exportable !== false));
        updateNotesSidebar();
    });
}

export function updateNotesSidebar() {
    const sidebar = document.getElementById('notes-sidebar');
    if (!sidebar || !state.pdfDoc) return;
    sidebar.innerHTML = '';

    const totalPages = state.pdfDoc.numPages;

    chrome.storage.local.get(null, (items) => {
        const prefix = `${state.currentFilename}_pg`;
        
        Object.keys(items).forEach(key => {
            if (key.startsWith(prefix) && key.endsWith('_notes')) {
                const pageNum = parseInt(key.replace(prefix, '').replace('_notes', ''), 10);
                const notes = items[key];

                notes.forEach(note => {
                    let percentageY = (((pageNum - 1) + (note.y / 100)) / totalPages) * 100;

                    percentageY = Math.max(0.5, Math.min(99.2, percentageY));

                    const marker = document.createElement('div');
                    marker.className = 'note-marker';
                    marker.style.top = `${percentageY}%`;
                    marker.title = `Página ${pageNum}:\n"${note.text ? note.text.substring(0, 30) + '...' : 'Nota vazia'}"`;

                    marker.onclick = () => {
                        const wrapper = document.getElementById(`page-wrapper-${pageNum}`);
                        if (wrapper) {
                            wrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }
                    };
                    sidebar.appendChild(marker);
                });
            }
        });
    });
}

function parseRichText(str) {
    if (!str) return '';
    
    let html = str
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') 
        .replace(/\n/g, '<br>');

    html = html.replace(/&lt;=&gt;/g, '⇔');
    html = html.replace(/=&gt;/g, '⇒');
    html = html.replace(/&lt;-/g, '←');
    html = html.replace(/-&gt;/g, '→');
    html = html.replace(/&gt;=/g, '≥');
    html = html.replace(/&lt;=/g, '≤');
    html = html.replace(/!=/g, '≠');
    html = html.replace(/~=/g, '≈');
    html = html.replace(/\\\+-/g, '±');

    // 3. Símbolos Gregos e Matemáticos
    const symbolsMap = {
        '/alpha': 'α', '/beta': 'β', '/gamma': 'γ', '/Gamma': 'Γ', '/delta': 'δ', '/Delta': 'Δ',
        '/epsilon': 'ε', '/zeta': 'ζ', '/eta': 'η', '/theta': 'θ', '/Theta': 'Θ', '/iota': 'ι',
        '/kappa': 'κ', '/lambda': 'λ', '/Lambda': 'Λ', '/mu': 'μ', '/nu': 'ν', '/xi': 'ξ', '/Xi': 'Ξ',
        '/pi': 'π', '/Pi': 'Π', '/rho': 'ρ', '/sigma': 'σ', '/Sigma': 'Σ', '/tau': 'τ',
        '/upsilon': 'υ', '/phi': 'φ', '/Phi': 'Φ', '/chi': 'χ', '/psi': 'ψ', '/Psi': 'Ψ', '/omega': 'ω', '/Omega': 'Ω',
        '/inf': '∞', '/int': '∫', '/sum': '∑', '/prod': '∏', '/nabla': '∇', '/part': '∂'
    };
    Object.keys(symbolsMap).forEach(key => {
        html = html.replace(new RegExp(key, 'g'), symbolsMap[key]);
    });

    // 4. Blocos de Código Inline (Evita que o código lá dentro seja formatado acidentalmente)
    html = html.replace(/`([^`]+)`/g, '<code style="background: rgba(0,0,0,0.08); padding: 2px 4px; border-radius: 3px; font-family: monospace; font-size: 11.5px; color: #b9770e;">$1</code>');

    html = html.replace(/__(?!\s)(.*?)(?<!\s)__/g, '<u>$1</u>');
    html = html.replace(/\*\*(?!\s)(.*?)(?<!\s)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(?!\s)(.*?)(?<!\s)\*/g, '<em>$1</em>');
    html = html.replace(/==(?!\s)(.*?)(?<!\s)==/g, '<mark style="background: rgba(255, 215, 64, 0.6); padding: 0 3px; border-radius: 2px;">$1</mark>');

    // 6. Checklists
    html = html.replace(/\[ \]/g, '<input type="checkbox" disabled style="margin: 0 4px 0 0; vertical-align: middle;">');
    html = html.replace(/\[[xX]\]/g, '<input type="checkbox" checked disabled style="margin: 0 4px 0 0; vertical-align: middle;">');

    // 7. Subscritos e Sobrescritos
    // Permitir agrupar vários carateres usando [ ], ex: a^[b+c]
    const base = '([a-zA-Z0-9α-ωΑ-Ω)\\]])'; // Aceita letras, números, gregos, e fecho de parênteses como base

    // Primeiro resolvemos os que têm parênteses retos (ex: a_[b+c])
    html = html.replace(new RegExp(base + '_\\\[([^\\]]+)\\\]', 'g'), '$1<sub>$2</sub>');
    html = html.replace(new RegExp(base + '\\\^\\\[([^\\]]+)\\\]', 'g'), '$1<sup>$2</sup>');
    
    // Depois resolvemos os simples sem parênteses (ex: a_2)
    html = html.replace(new RegExp(base + '_([a-zA-Z0-9]+)', 'g'), '$1<sub>$2</sub>');
    html = html.replace(new RegExp(base + '\\\^([a-zA-Z0-9]+)', 'g'), '$1<sup>$2</sup>');

    return html;
}