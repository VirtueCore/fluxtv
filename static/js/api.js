const FluxTV = {
    API_BASE: '',
    async request(path, options = {}) {
        const res = await fetch(`${this.API_BASE}${path}`, {
            headers: { 'Content-Type': 'application/json' },
            ...options,
        });
        if (!res.ok) {
            let detail = res.statusText;
            try { const data = await res.json(); detail = data.detail || detail; } catch {}
            throw new Error(detail);
        }
        return res.json();
    },
    get(path) { return this.request(path); },
    post(path, body) { return this.request(path, { method: 'POST', body: JSON.stringify(body) }); },
    put(path, body) { return this.request(path, { method: 'PUT', body: JSON.stringify(body) }); },
    del(path) { return this.request(path, { method: 'DELETE' }); },
};
