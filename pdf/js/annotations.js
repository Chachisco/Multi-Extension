import { state } from './state.js';
import { annotationKey, annotationId } from './storage.js';

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
    mark.onclick = event => {
        if (!state.eraserActive) return;
        event.stopPropagation();
        removeAnnotation(pageNum, annotation, mark);
    };
    layer.appendChild(mark);
    return mark;
}

function removeAnnotation(pageNum, annotation, mark) {
    state.annotationLoadVersions[pageNum] = (state.annotationLoadVersions[pageNum] || 0) + 1;
    mark.remove();
    const key = annotationKey(pageNum);
    const removalId = annotationId(annotation);
    if (!state.pendingAnnotationRemovals.has(pageNum)) state.pendingAnnotationRemovals.set(pageNum, new Set());
    state.pendingAnnotationRemovals.get(pageNum).add(removalId);
    chrome.storage.local.get(key, result => {
        const annotations = result[key] || [];
        const index = annotations.findIndex(item => annotationId(item) === removalId);
        if (index !== -1) annotations.splice(index, 1);
        chrome.storage.local.set({ [key]: annotations }, () => {
            state.pendingAnnotationRemovals.get(pageNum)?.delete(removalId);
        });
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
    const annotations = [...range.getClientRects()]
        .filter(rect => rect.width && rect.height)
        .map(rect => ({
            mode: state.currentAnnotationMode,
            color: state.currentAnnotationColor,
            size: state.currentAnnotationSize,
            x: ((rect.left - wrapperRect.left) / wrapperRect.width) * 100,
            y: ((rect.top - wrapperRect.top) / wrapperRect.height) * 100,
            width: (rect.width / wrapperRect.width) * 100,
            height: (rect.height / wrapperRect.height) * 100
        }));
    const marks = annotations.map(annotation => renderAnnotation(pageNum, annotation));
    if (!annotations.length) return;

    const key = annotationKey(pageNum);
    chrome.storage.local.get(key, result => {
        chrome.storage.local.set({ [key]: [...(result[key] || []), ...annotations] });
    });
    state.annotationHistory.push({ pageNum, annotations, marks });
    selection.removeAllRanges();
}

export function undoAnnotation() {
    const lastAction = state.annotationHistory.pop();
    if (!lastAction) return false;
    lastAction.marks.forEach(mark => mark?.remove());
    const key = annotationKey(lastAction.pageNum);
    chrome.storage.local.get(key, result => {
        chrome.storage.local.set({
            [key]: (result[key] || []).slice(0, -lastAction.annotations.length)
        });
    });
    return true;
}