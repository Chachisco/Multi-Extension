import { state } from './state.js';
import { annotationKey, annotationId } from './storage.js';
import { record } from './history.js';

export function setupAnnotationOptions() {
    document.querySelectorAll('.opt-mode').forEach(button => {
        button.onclick = () => {
            document.querySelectorAll('.opt-mode').forEach(item => item.classList.remove('active'));
            button.classList.add('active');
            state.currentAnnotationMode = button.dataset.val;
        };
    });
    document.querySelectorAll('.opt-color').forEach(button => {
        button.onclick = () => {
            document.querySelectorAll('.opt-color').forEach(item => item.classList.remove('active'));
            button.classList.add('active');
            state.currentAnnotationColor = button.dataset.val;
        };
    });
    document.querySelectorAll('.opt-size').forEach(button => {
        button.onclick = () => {
            document.querySelectorAll('.opt-size').forEach(item => item.classList.remove('active'));
            button.classList.add('active');
            state.currentAnnotationSize = parseInt(button.dataset.val, 10);
        };
    });
}

export function renderAnnotation(pageNum, annotation) {
    const layer = document.querySelector(`#page-wrapper-${pageNum} .annotation-layer`);
    if (!layer) return null;
    layer.classList.toggle('eraser-active', state.eraserActive);
    const mark = document.createElement('div');
    mark.className = `annotation-mark ${annotation.mode}`;
    mark.style.left = `${annotation.x}%`;
    mark.style.top = `${annotation.y}%`;
    mark.style.width = `${annotation.width}%`;
    mark.style.height = `${annotation.height}%`;
    mark.style.backgroundColor = annotation.color;
    mark.style.color = annotation.color;
    mark.style.borderBottomWidth = `${annotation.size}px`;
    mark.dataset.annotationId = annotationId(annotation);
    mark.onclick = event => {
        if (!state.eraserActive) return;
        event.stopPropagation();
        removeAnnotation(pageNum, annotation, mark);
    };
    layer.appendChild(mark);
    return mark;
}

function removeStoredAnnotations(pageNum, annotations) {
    const key = annotationKey(pageNum);
    const ids = new Set(annotations.map(annotationId));
    chrome.storage.local.get(key, result => {
        chrome.storage.local.set({
            [key]: (result[key] || []).filter(annotation => !ids.has(annotationId(annotation)))
        });
    });
}

function appendStoredAnnotations(pageNum, annotations) {
    const key = annotationKey(pageNum);
    chrome.storage.local.get(key, result => {
        const current = result[key] || [];
        const existing = new Set(current.map(annotationId));
        const additions = annotations.filter(annotation => !existing.has(annotationId(annotation)));
        chrome.storage.local.set({ [key]: [...current, ...additions] });
    });
}

function removeAnnotation(pageNum, annotation, mark) {
    state.annotationLoadVersions[pageNum] = (state.annotationLoadVersions[pageNum] || 0) + 1;
    mark.remove();

    const key = annotationKey(pageNum);
    const removalId = annotationId(annotation);
    const markRemovalPending = () => {
        if (!state.pendingAnnotationRemovals.has(pageNum)) state.pendingAnnotationRemovals.set(pageNum, new Set());
        state.pendingAnnotationRemovals.get(pageNum).add(removalId);
    };
    const restoreMark = () => {
        state.pendingAnnotationRemovals.get(pageNum)?.delete(removalId);
        removeRenderedAnnotations(pageNum, [annotation]);
        mark = renderAnnotation(pageNum, annotation);
        appendStoredAnnotations(pageNum, [annotation]);
    };
    const deleteMark = () => {
        state.annotationLoadVersions[pageNum] = (state.annotationLoadVersions[pageNum] || 0) + 1;
        markRemovalPending();
        removeRenderedAnnotations(pageNum, [annotation]);
        removeStoredAnnotations(pageNum, [annotation]);
    };

    markRemovalPending();
    removeStoredAnnotations(pageNum, [annotation]);
    record({
        label: 'Apagar anotação',
        undo: restoreMark,
        redo: deleteMark
    });
}

export function loadAnnotationsForPage(pageNum) {
    const layer = document.querySelector(`#page-wrapper-${pageNum} .annotation-layer`);
    if (!layer) return;
    layer.innerHTML = '';
    const key = annotationKey(pageNum);
    const loadVersion = (state.annotationLoadVersions[pageNum] || 0) + 1;
    state.annotationLoadVersions[pageNum] = loadVersion;
    chrome.storage.local.get(key, result => {
        if (state.annotationLoadVersions[pageNum] !== loadVersion || !layer.isConnected) return;
        const pending = state.pendingAnnotationRemovals.get(pageNum) || new Set();
        (result[key] || [])
            .filter(annotation => !pending.has(annotationId(annotation)))
            .forEach(annotation => renderAnnotation(pageNum, annotation));
    });
}

export function applyAnnotation() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return;

    const range = selection.getRangeAt(0);
    const source = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
        ? range.commonAncestorContainer
        : range.commonAncestorContainer.parentElement;
    const wrapper = source?.closest('.page-wrapper');
    if (!wrapper || !wrapper.querySelector('.textLayer')?.contains(range.startContainer)) return;

    const wrapperRect = wrapper.getBoundingClientRect();
    const pageNum = Number(wrapper.dataset.pageNumber);
    
    const rawRects = [...range.getClientRects()].filter(rect => rect.width && rect.height);
    
    const uniqueRects = [];
    rawRects.forEach(rect => {
        const isDuplicate = uniqueRects.some(r => 
            Math.abs(r.left - rect.left) < 2 && 
            Math.abs(r.top - rect.top) < 2 && 
            Math.abs(r.width - rect.width) < 2
        );
        if (!isDuplicate) uniqueRects.push(rect);
    });

    const annotations = uniqueRects.map(rect => ({
        mode: state.currentAnnotationMode,
        color: state.currentAnnotationColor,
        size: state.currentSize || state.currentAnnotationSize,
        x: ((rect.left - wrapperRect.left) / wrapperRect.width) * 100,
        y: ((rect.top - wrapperRect.top) / wrapperRect.height) * 100,
        width: (rect.width / wrapperRect.width) * 100,
        height: (rect.height / wrapperRect.height) * 100
    }));

    annotations.forEach(annotation => renderAnnotation(pageNum, annotation));
    
    selection.removeAllRanges(); // Limpa a seleção azul nativa

    if (!annotations.length) return;

    appendStoredAnnotations(pageNum, annotations);
    record({
        label: 'Criar anotação',
        undo: () => {
            removeRenderedAnnotations(pageNum, annotations);
            removeStoredAnnotations(pageNum, annotations);
        },
        redo: () => {
            annotations.forEach(annotation => {
                removeRenderedAnnotations(pageNum, [annotation]);
                renderAnnotation(pageNum, annotation);
            });
            appendStoredAnnotations(pageNum, annotations);
        }
    });
}

function removeRenderedAnnotations(pageNum, annotations) {
    const ids = new Set(annotations.map(annotationId));
    document.querySelectorAll(`#page-wrapper-${pageNum} .annotation-mark`).forEach(mark => {
        if (ids.has(mark.dataset.annotationId)) mark.remove();
    });
}