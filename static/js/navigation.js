(function() {
    const focusableSelector = 'a, button, input, select, textarea, [tabindex="0"]';

    function getVisibleFocusables(root = document) {
        return [...root.querySelectorAll(focusableSelector)].filter(el => {
            if (el.hidden || el.disabled) return false;
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        });
    }

    function findBest(current, elements, dir) {
        if (!current || elements.length === 0) return elements[0] || null;
        const currentRect = current.getBoundingClientRect();
        let best = null;
        let bestScore = Infinity;
        for (const el of elements) {
            if (el === current) continue;
            const rect = el.getBoundingClientRect();
            const dx = rect.left + rect.width/2 - (currentRect.left + currentRect.width/2);
            const dy = rect.top + rect.height/2 - (currentRect.top + currentRect.height/2);
            let score;
            switch (dir) {
                case 'left': score = Math.abs(rect.right - currentRect.left) + Math.abs(dy) * 3; break;
                case 'right': score = Math.abs(rect.left - currentRect.right) + Math.abs(dy) * 3; break;
                case 'up': score = Math.abs(rect.bottom - currentRect.top) + Math.abs(dx) * 3; break;
                case 'down': score = Math.abs(rect.top - currentRect.bottom) + Math.abs(dx) * 3; break;
            }
            if (score < bestScore) { bestScore = score; best = el; }
        }
        return best;
    }

    document.addEventListener('keydown', (e) => {
        const keyMap = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
        if (!keyMap[e.key]) return;
        const dir = keyMap[e.key];
        const active = document.activeElement;
        const all = getVisibleFocusables(document);
        const next = findBest(active, all, dir);
        if (next) {
            e.preventDefault();
            next.focus();
            if (typeof next.scrollIntoView === 'function') {
                next.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            }
        }
    });

    // Restore focus on view change
    window.FocusManager = {
        focusables: focusableSelector,
        getVisibleFocusables,
        findBest,
    };
})();
