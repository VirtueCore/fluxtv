// Search-specific helpers (also used in app.js)
FluxTV.searchChannels = async function(query) {
    if (!query) return [];
    return await this.get(`/api/channels?search=${encodeURIComponent(query)}`);
};
