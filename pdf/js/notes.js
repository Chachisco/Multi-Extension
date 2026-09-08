import { state } from './state.js';

export function addNoteToUI(overlay, pageNum, x, y, text, isPinned = false) {
    if (!overlay) return;
    const note = document.createElement('div');
    note.className = 'sticky-note';
    note.style.left = `${x}%`;
    note.style.top = `${y}%`;
    note.tabIndex = 0;
    
    // Se a nota vier marcada como Pinned do armazenamento, aplica as classes!
    if (isPinned) {
        note.classList.add('pinned');
        note.classList.add('active'); 
    }

    // --- CONSTRUIR A INTERFACE DA NOTA ---
    const popup = document.createElement('div');
    popup.className = 'note-popup';

    const header = document.createElement('div');
    header.className = 'note-header';

    // Botão de Pin (Fixar)
    const pinBtn = document.createElement('button');
    pinBtn.className = 'pin-btn';
    pinBtn.title = 'Manter aberta';
    pinBtn.innerHTML = `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>`;
    pinBtn.onclick = (e) => {
        e.stopPropagation();
        const pinned = note.classList.toggle('pinned');
        note.classList.toggle('active', pinned); // Se pinar, fica ativa!
        saveNotesForPage(pageNum, overlay);
    };

    // Botão de Lixo (Apagar)
    const delBtn = document.createElement('button');
    delBtn.className = 'del-btn';
    delBtn.title = 'Apagar nota';
    delBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
    delBtn.onclick = (e) => {
        e.stopPropagation();
        note.remove();
        saveNotesForPage(pageNum, overlay);
    };

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.placeholder = 'Escreve a tua nota...';

    header.appendChild(pinBtn);
    header.appendChild(delBtn);
    popup.appendChild(header);
    popup.appendChild(textarea);
    note.appendChild(popup);
    overlay.appendChild(note);

    // --- LÓGICA DE DRAG & DROP (Arrastar) ---
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

    // --- ABRIR NOTA (Clique Simples) ---
    note.onclick = (e) => {
        if (hasDragged) return; 
        e.stopPropagation();

        if (note.classList.contains('pinned')) {
            note.classList.add('active');
            textarea.focus();
            return;
        }
        
        document.querySelectorAll('.sticky-note.active').forEach(item => {
            if (item !== note && !item.classList.contains('pinned')) {
                item.classList.remove('active');
            }
        });
        
        note.classList.add('active');
        textarea.focus();
    };

    // --- ATALHOS DE TECLADO ---
    textarea.onkeydown = (e) => {
        if (e.key === 'Escape') {
            if (!note.classList.contains('pinned')) note.classList.remove('active');
            note.focus();
        }
        if (e.ctrlKey && (e.key === 'Delete' || e.key === 'Backspace')) {
            e.preventDefault();
            note.remove();
            saveNotesForPage(pageNum, overlay);
        }
    };
    
    note.onkeydown = (e) => {
        if (e.key === 'Enter') {
            note.classList.add('active');
            textarea.focus();
        }
        if (e.ctrlKey && (e.key === 'Delete' || e.key === 'Backspace')) {
            e.preventDefault();
            note.remove();
            saveNotesForPage(pageNum, overlay);
        }
    };

    textarea.oninput = () => saveNotesForPage(pageNum, overlay);

    if (text === '') setTimeout(() => { note.classList.add('active'); textarea.focus(); }, 50);
}

export function saveNotesForPage(pageNum, overlay) {
    const notes = Array.from(overlay.querySelectorAll('.sticky-note')).map(note => ({
        x: parseFloat(note.style.left),
        y: parseFloat(note.style.top),
        text: note.querySelector('textarea').value,
        pinned: note.classList.contains('pinned')
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
        (result[key] || []).forEach(note => addNoteToUI(overlay, pageNum, note.x, note.y, note.text, note.pinned));
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