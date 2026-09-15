let dragStart = null;
let isNormalizing = false;

function getTextLayer(target) {
	return target instanceof Element ? target.closest('.textLayer') : null;
}

function getTextNodes(element) {
	const nodes = [];
	const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
	let node;
	while ((node = walker.nextNode())) {
		if (node.textContent) nodes.push(node);
	}
	return nodes;
}

function getSpanBoundary(span, atEnd) {
	const textNodes = getTextNodes(span);
	const node = atEnd ? textNodes.at(-1) : textNodes[0];
	if (!node) return null;
	return { node, offset: atEnd ? node.textContent.length : 0 };
}

function getEndpoint(textLayer, clientX, clientY) {
	const spans = [...textLayer.querySelectorAll('span')]
		.map(span => ({ span, rect: span.getBoundingClientRect() }))
		.filter(item => item.rect.width && item.rect.height);
	if (!spans.length) return null;

	const lineTop = spans.reduce((best, item) => {
		const distance = clientY < item.rect.top
			? item.rect.top - clientY
			: clientY > item.rect.bottom
				? clientY - item.rect.bottom
				: 0;
		return distance < best.distance ? { distance, top: item.rect.top } : best;
	}, { distance: Infinity, top: 0 }).top;
	const line = spans
		.filter(item => Math.abs(item.rect.top - lineTop) < 2)
		.sort((a, b) => a.rect.left - b.rect.left);
	if (!line.length) return null;
	const first = line[0];
	const last = line.at(-1);

	if (clientX <= first.rect.left) return getSpanBoundary(first.span, false);
	if (clientX >= last.rect.right) return getSpanBoundary(last.span, true);

	const caretRange = document.caretRangeFromPoint?.(clientX, clientY);
	if (caretRange?.startContainer && textLayer.contains(caretRange.startContainer)) {
		return { node: caretRange.startContainer, offset: caretRange.startOffset };
	}

	const nearest = line.reduce((best, item) => {
		const distance = Math.abs(clientX - (item.rect.left + item.rect.width / 2));
		return distance < best.distance ? { item, distance } : best;
	}, { item: first, distance: Infinity }).item;
	return getSpanBoundary(nearest.span, clientX > nearest.rect.left + nearest.rect.width / 2);
}

function normalizeSelection(event) {
	const selection = window.getSelection();
	if (!selection || !selection.rangeCount || !dragStart) return;

	const dx = Math.abs(event.clientX - dragStart.x);
	const dy = Math.abs(event.clientY - dragStart.y);
	if (dx < 5 && dy < 5) return; 

	const textLayer = dragStart.layer
		|| getTextLayer(event.target)
		|| (selection.focusNode instanceof Element
			? selection.focusNode.closest('.textLayer')
			: selection.focusNode?.parentElement?.closest('.textLayer'));
	if (!textLayer) return;

	if (!dragStart.anchorNode && textLayer.contains(selection.anchorNode)) {
		dragStart.anchorNode = selection.anchorNode;
		dragStart.anchorOffset = selection.anchorOffset;
	}
	if (!dragStart.anchorNode || !textLayer.contains(dragStart.anchorNode)) return;

	const endpoint = getEndpoint(textLayer, event.clientX, event.clientY);
	if (!endpoint) return;

	try {
		isNormalizing = true;
		selection.setBaseAndExtent(
			dragStart.anchorNode,
			dragStart.anchorOffset,
			endpoint.node,
			endpoint.offset
		);
	} finally {
		isNormalizing = false;
	}
}

export function setupTextSelection() {
	document.addEventListener('mousedown', event => {
		const layer = getTextLayer(event.target);
		if (event.button === 0 && layer) {
			dragStart = {
				x: event.clientX,
				y: event.clientY,
				lastX: event.clientX,
				lastY: event.clientY,
				layer,
				anchorNode: null,
				anchorOffset: 0
			};
		}
	}, true);

	document.addEventListener('mousemove', event => {
		if (!dragStart || !(event.buttons & 1)) return;
		dragStart.lastX = event.clientX;
		dragStart.lastY = event.clientY;
		normalizeSelection({ target: dragStart.layer, clientX: event.clientX, clientY: event.clientY });
	}, true);

	document.addEventListener('selectionchange', () => {
		if (!dragStart || isNormalizing || !window.getSelection()?.rangeCount) return;
		normalizeSelection({
			target: dragStart.layer,
			clientX: dragStart.lastX,
			clientY: dragStart.lastY
		});
	}, true);

	document.addEventListener('mouseup', event => {
		if (!dragStart) return;
		dragStart.lastX = event.clientX;
		dragStart.lastY = event.clientY;
		normalizeSelection({ target: dragStart.layer, clientX: event.clientX, clientY: event.clientY });
		dragStart = null;
	}, true);
}