function isPageTarget(target) {
    if (!(target instanceof Element)) return false;
    return Boolean(target.closest('.page-wrapper')) &&
        !target.closest('.free-text-box, .sticky-note, .pdf-bookmark-icon, .page-actions-overlay, .pdf-selection-toolbar, button, input, textarea');
}

export class EraserController {
    constructor({ container, isEnabled, onError }) {
        this.container = container;
        this.isEnabled = isEnabled;
        this.onError = onError;
        this.providers = new Set();
        this.stroke = null;
        this.suppressNextClick = false;

        container.addEventListener('pointerdown', event => this._start(event));
        container.addEventListener('click', event => {
            if (!this.suppressNextClick) return;
            this.suppressNextClick = false;
            event.preventDefault();
            event.stopPropagation();
        }, true);
        document.addEventListener('pointermove', event => this._move(event));
        document.addEventListener('pointerup', event => this._finish(event));
        document.addEventListener('pointercancel', event => this.cancel(event.pointerId));
        window.addEventListener('keydown', event => {
            if (event.key !== 'Escape' || !this.stroke) return;
            event.preventDefault();
            this.cancel();
        }, true);
        window.addEventListener('blur', () => this.cancel());
    }

    registerProvider(provider) {
        this.providers.add(provider);
        return () => this.providers.delete(provider);
    }

    _start(event) {
        if (!this.isEnabled() || event.button !== 0 || !isPageTarget(event.target) || this.stroke) return;

        event.preventDefault();
        event.stopPropagation();
        this.suppressNextClick = true;
        const point = { x: event.clientX, y: event.clientY };
        this.stroke = {
            pointerId: event.pointerId,
            lastPoint: point,
            targets: new Map([...this.providers].map(provider => [provider, new Map()]))
        };
        this._collect(point, point);
    }

    _move(event) {
        if (!this.stroke || event.pointerId !== this.stroke.pointerId) return;
        const point = { x: event.clientX, y: event.clientY };
        this._collect(this.stroke.lastPoint, point);
        this.stroke.lastPoint = point;
    }

    _collect(start, end) {
        this.providers.forEach(provider => {
            let targets = this.stroke.targets.get(provider);
            if (!targets) {
                targets = new Map();
                this.stroke.targets.set(provider, targets);
            }
            provider.getTargets().forEach(target => {
                if (targets.has(target.id) || !provider.hitTest(target, start, end)) return;
                targets.set(target.id, target);
                provider.setPending(target, true);
            });
        });
    }

    async _finish(event) {
        const stroke = this.stroke;
        if (!stroke || event.pointerId !== stroke.pointerId) return;
        const end = { x: event.clientX, y: event.clientY };
        this._collect(stroke.lastPoint, end);
        this.stroke = null;
        this._clearClickSuppressionSoon();

        const commits = [...stroke.targets].flatMap(([provider, targets]) => {
            const values = [...targets.values()];
            return values.length
                ? [{ provider, targets: values, promise: Promise.resolve().then(() => provider.commit(values)) }]
                : [];
        });
        const results = await Promise.allSettled(commits.map(commit => commit.promise));
        results.forEach((result, index) => {
            if (result.status !== 'rejected') return;
            commits[index].targets.forEach(target => commits[index].provider.setPending(target, false));
            this.onError(result.reason);
        });
    }

    cancel(pointerId = null) {
        if (!this.stroke || (pointerId !== null && pointerId !== this.stroke.pointerId)) return;
        const stroke = this.stroke;
        this.stroke = null;
        this._clearClickSuppressionSoon();
        stroke.targets.forEach((targets, provider) => {
            targets.forEach(target => provider.setPending(target, false));
        });
    }

    _clearClickSuppressionSoon() {
        window.setTimeout(() => {
            this.suppressNextClick = false;
        }, 250);
    }
}
