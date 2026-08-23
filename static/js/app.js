FluxTV.init = async function() {
    this.state = {
        view: 'home',
        groupId: null,
        query: '',
        channel: null,
        recent: JSON.parse(localStorage.getItem('fluxtv_recent') || '[]'),
        settings: {},
    };
    this.elements = {
        nav: document.getElementById('main-nav'),
        viewContainer: document.getElementById('view-container'),
        modalRoot: document.getElementById('modal-root'),
        playerRoot: document.getElementById('player-root'),
    };
    this.logoSources = [];
    this.scrollPositions = {};
    this.bindNavigation();
    await this.loadSettings();
    await this.showView('home');
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/static/service-worker.js').catch(() => {});
    }
};

FluxTV.toast = function(message, type = 'info') {
    const existing = document.querySelector('.fluxtv-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = `fluxtv-toast fluxtv-toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
};

FluxTV.bindNavigation = function() {
    document.querySelectorAll('[data-nav]').forEach(el => {
        el.addEventListener('click', () => {
            const view = el.dataset.nav;
            this.showView(view);
        });
    });
    window.addEventListener('popstate', () => {
        this.showView(this.state.view);
    });
};

FluxTV.loadSettings = async function() {
    try { this.state.settings = await this.get('/api/settings'); } catch {}
};

FluxTV.setActiveNav = function(view) {
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.nav === view);
    });
};

FluxTV.showView = async function(view, params = {}) {
    const previousView = this.state.view;
    const previousScrollY = window.scrollY;

    if (previousView) this.scrollPositions[previousView] = previousScrollY;

    this.state.view = view;
    this.setActiveNav(view);
    const container = this.elements.viewContainer;
    container.innerHTML = ''; // Clear container

    try {
        switch (view) {
            case 'home': await this.renderHome(container); break;
            case 'live': await this.renderLive(container); break;
            case 'guide': await this.renderGuide(container); break;
            case 'logos': await this.renderLogosMapping(container); break;
            case 'favorites': await this.renderFavorites(container); break;
            case 'search': await this.renderSearch(container); break;
            case 'manage': await this.renderManage(container); break;
            default: await this.renderHome(container);
        }

        if (this.scrollPositions[view] !== undefined) window.scrollTo({ top: this.scrollPositions[view] });
        else window.scrollTo({ top: 0 });

        this.addScrollButtons();
    } catch (err) {
        container.innerHTML = `<div class="empty-state"><h2>Error rendering ${view}</h2><pre style="color:var(--danger);">${err.message}</pre></div>`;
        console.error(err);
    }
};

FluxTV.renderHome = async function(container) {
    const channels = await this.get('/api/channels?enabled=true');
    let html = '';
    const recent = this.state.recent;
    let featured = null;
    if (recent.length) featured = channels.find(c => c.id === recent[0]);
    if (!featured && channels.length) featured = channels[0];

    if (featured) {
        html += this.heroHTML(featured);
    } else {
        html += `<div class="empty-state"><h2>No channels configured yet.</h2><p>Add a channel or import your channel list.</p>
            <div style="display:flex;gap:1rem;margin-top:1rem;">
                <button class="btn btn-primary" data-action="add-channel">Add Channel</button>
                <button class="btn" data-action="import">Import</button>
            </div></div>`;
        container.innerHTML = html;
        return;
    }

    const recentChannels = recent.map(id => channels.find(c => c.id === id)).filter(Boolean).slice(0, 10);
    if (recentChannels.length) html += this.sectionHTML('Recently Watched', recentChannels);

    const favs = channels.filter(c => c.favorite);
    if (favs.length) html += this.sectionHTML('Favorites', favs);

    html += `
        <div style="text-align:center; margin-top:2rem;">
            <button class="btn btn-primary" id="browse-all-btn">Browse All Channels</button>
        </div>
    `;

    container.innerHTML = html;
    this.bindChannelCardActions(container);
    this.updateEPGForCards(container);
    const browseBtn = container.querySelector('#browse-all-btn');
    if (browseBtn) browseBtn.addEventListener('click', () => this.showView('live'));
    this.addScrollButtons();
};

FluxTV.renderLive = async function(container) {
    const [channels, groups] = await Promise.all([
        this.get('/api/channels?enabled=true'),
        this.get('/api/groups'),
    ]);
    let html = `<div class="section-header"><h1 class="section-title">Live TV</h1></div>`;
    for (const group of groups) {
        const groupChannels = channels.filter(c => c.group_id === group.id);
        if (groupChannels.length) html += this.sectionHTML(group.name, groupChannels);
    }
    const ungrouped = channels.filter(c => !c.group_id);
    if (ungrouped.length) html += this.sectionHTML('Other', ungrouped);
    if (!channels.length) {
        html = `<div class="empty-state"><h2>No channels configured yet.</h2><p>Add a channel or import your channel list.</p>
            <div style="display:flex;gap:1rem;margin-top:1rem;"><button class="btn btn-primary" data-action="add-channel">Add Channel</button>
            <button class="btn" data-action="import">Import</button></div></div>`;
    }
    container.innerHTML = html;
    this.bindChannelCardActions(container);
    this.updateEPGForCards(container);
    this.addScrollButtons();
};

FluxTV.renderFavorites = async function(container) {
    const channels = await this.get('/api/channels?favorite=true&enabled=true');
    let html = `<div class="section-header"><h1 class="section-title">Favorites</h1></div>`;
    if (channels.length) html += this.sectionHTML('Favorite Channels', channels);
    else html += `<div class="empty-state"><h2>You haven't added any favorites yet.</h2><p>Use the ⭐ button on any channel.</p></div>`;
    container.innerHTML = html;
    this.bindChannelCardActions(container);
    this.updateEPGForCards(container);
    this.addScrollButtons();
};

FluxTV.renderSearch = async function(container) {
    container.innerHTML = `<div class="section-header"><h1 class="section-title">Search</h1></div>
        <div class="form-group"><input type="text" id="search-input" placeholder="Search channels..." value="${this.state.query}" /></div>
        <div id="search-results"></div>`;
    const input = document.getElementById('search-input');
    input.focus();
    let searchDebounceTimer;
    input.addEventListener('input', (e) => {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(async () => {
            this.state.query = e.target.value;
            const query = this.state.query.trim();
            const channels = query ? await this.get(`/api/channels?search=${encodeURIComponent(query)}`) : [];
            const resultsDiv = document.getElementById('search-results');
            if (!resultsDiv) return;
            if (channels.length) {
                resultsDiv.innerHTML = this.sectionHTML('Results', channels);
                this.bindChannelCardActions(resultsDiv);
                this.updateEPGForCards(resultsDiv);
                this.addScrollButtons();
            } else if (query) resultsDiv.innerHTML = `<div class="empty-state"><h2>No results found.</h2></div>`;
            else resultsDiv.innerHTML = '';
        }, 300);
    });
};

const TIME_SLOT_WIDTH = 180;

FluxTV.renderGuide = async function(container) {
    const guideData = await this.get('/api/epg/guide');
    const now = new Date();
    const startRange = new Date(now);
    startRange.setMinutes(startRange.getMinutes() >= 30 ? 30 : 0, 0, 0);
    startRange.setHours(startRange.getHours() - 2);
    const endRange = new Date(startRange.getTime() + 8 * 60 * 60 * 1000);

    const timeSlots = [];
    for (let t = new Date(startRange); t < endRange; t = new Date(t.getTime() + 30 * 60 * 1000)) timeSlots.push(new Date(t));

    const rowWidth = timeSlots.length * TIME_SLOT_WIDTH;
    const nowOffset = Math.max(0, ((now - startRange) / (30 * 60 * 1000)) * TIME_SLOT_WIDTH);
    const mapped = guideData.filter(ch => ch.epg_assignment_mode === 'automatic' || ch.epg_assignment_mode === 'manual');
    const suggestions = guideData.filter(ch => ch.suggested && ch.suggested.length > 0 && ch.epg_assignment_mode === 'unassigned');
    const unmapped = guideData.filter(ch => ch.epg_assignment_mode === 'unassigned' && (!ch.suggested || ch.suggested.length === 0));

    container.innerHTML = `
        <div class="section-header">
            <h1 class="section-title">EPG Guide</h1>
            <div style="display:flex; gap:0.5rem;">
                <button class="btn" id="now-btn">Now</button>
                <button class="btn" id="scroll-left-btn">←</button>
                <button class="btn" id="scroll-right-btn">→</button>
            </div>
        </div>
        <div class="guide-grid-wrapper" id="guide-grid-wrapper" style="position:relative;">
            <div class="guide-grid" id="guide-grid">
                <div class="guide-header-row" style="display:flex;">
                    <div class="guide-channel-header">Channel</div>
                    <div class="guide-time-slots" style="width:${rowWidth}px; position:relative; display:flex;">
                        ${timeSlots.map(t => `<div class="guide-time-slot" style="min-width:${TIME_SLOT_WIDTH}px; width:${TIME_SLOT_WIDTH}px;">${t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>`).join('')}
                    </div>
                </div>
                <div style="position:relative;">
                    ${nowOffset >= 0 && nowOffset <= rowWidth ? `<div class="guide-now-line" style="left:${nowOffset}px; position:absolute; top:0; bottom:0; width:2px; background:var(--primary, #e50914); z-index:10; pointer-events:none;"></div>` : ''}
                    ${mapped.length ? mapped.map(ch => this.channelGuideRowHTML(ch, startRange, endRange, rowWidth, now)).join('') : '<div class="empty-state"><p>No mapped channels available.</p></div>'}
                </div>
            </div>
        </div>
        ${suggestions.length ? `<h2 style="margin-top:2rem;">Suggestions (${suggestions.length})</h2><div id="suggestions-table">${this.guideSuggestionsHTML(suggestions)}</div>` : ''}
        ${unmapped.length ? `<h2 style="margin-top:2rem;">Unmapped (${unmapped.length})</h2><div id="unmapped-table">${this.guideUnmappedHTML(unmapped)}</div>` : ''}
    `;

    const wrapper = container.querySelector('#guide-grid-wrapper');
    if (wrapper && nowOffset > 0) wrapper.scrollLeft = Math.max(0, nowOffset - 150);

    container.querySelector('#now-btn')?.addEventListener('click', () => {
        const currentNowOffset = ((new Date() - startRange) / (30 * 60 * 1000)) * TIME_SLOT_WIDTH;
        wrapper.scrollTo({ left: Math.max(0, currentNowOffset - 150), behavior: 'smooth' });
    });
    container.querySelector('#scroll-left-btn')?.addEventListener('click', () => wrapper.scrollBy({ left: -400, behavior: 'smooth' }));
    container.querySelector('#scroll-right-btn')?.addEventListener('click', () => wrapper.scrollBy({ left: 400, behavior: 'smooth' }));

    container.querySelectorAll('[data-channel-id]').forEach(el => {
        const triggerPlayback = () => this.openPlayer(parseInt(el.dataset.channelId));
        el.addEventListener('click', triggerPlayback);
        el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); triggerPlayback(); } });
    });

    container.querySelectorAll('[data-action="accept-epg-suggestion"]').forEach(btn => {
        btn.addEventListener('click', async () => {
            try {
                await this.post(`/api/epg/mappings/${btn.dataset.mappingId}/accept`, {});
                this.toast('Suggestion accepted', 'success');
                this.renderGuide(container);
            } catch (err) { this.toast('Failed to accept suggestion: ' + err.message, 'error'); }
        });
    });
    container.querySelectorAll('[data-action="reject-epg-suggestion"]').forEach(btn => {
        btn.addEventListener('click', async () => {
            try {
                await this.post(`/api/epg/mappings/${btn.dataset.mappingId}/reject`, {});
                this.toast('Suggestion rejected', 'info');
                this.renderGuide(container);
            } catch (err) { this.toast('Failed to reject suggestion: ' + err.message, 'error'); }
        });
    });
};

FluxTV.channelGuideRowHTML = function(channel, startRange, endRange, rowWidth, now) {
    const PROGRAM_PADDING = 12;
    const logo = channel.logo_url ? `<img src="${channel.logo_url}" style="height:28px; width:auto; border-radius:6px; object-fit:contain; margin-right:${PROGRAM_PADDING}px;" alt="${this.escape(channel.name)}" onerror="this.style.display='none'" />` : `<span style="font-weight:800; color:var(--text-secondary); font-size:1.2rem; margin-right:${PROGRAM_PADDING}px;">${this.escape(channel.name.substring(0,2))}</span>`;

    let programsHtml = '';
    if (channel.programs && channel.programs.length) {
        const sortedPrograms = [...channel.programs].sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
        for (const prog of sortedPrograms) {
            const start = new Date(prog.start_time);
            const end = new Date(prog.end_time);
            if (end <= startRange || start >= endRange) continue;
            const clippedStart = start < startRange ? startRange : start;
            const clippedEnd = end > endRange ? endRange : end;
            const left = ((clippedStart - startRange) / (30 * 60 * 1000)) * TIME_SLOT_WIDTH;
            const width = ((clippedEnd - clippedStart) / (30 * 60 * 1000)) * TIME_SLOT_WIDTH;
            const isCurrent = start <= now && end > now;
            const startTimeStr = start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const endTimeStr = end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            programsHtml += `
                <div class="guide-program-block ${isCurrent ? 'current' : ''}" style="left:${left + PROGRAM_PADDING}px; width:${Math.max(1, width - PROGRAM_PADDING)}px; position:absolute; height:100%; top:0;" title="${this.escape(prog.title)} (${startTimeStr} - ${endTimeStr})" tabindex="0" role="button" data-channel-id="${channel.id}">
                    <span class="guide-program-title" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; display:block; padding:0 8px;">${this.escape(prog.title)}</span>
                </div>`;
        }
    }

    return `
        <div class="guide-channel-row" style="min-height: 60px; display:flex;">
            <div class="guide-channel-cell">
                <button class="btn-link" data-channel-id="${channel.id}" style="padding:0; background:none; border:none; cursor:pointer;" title="Watch ${this.escape(channel.name)}">${logo}</button>
            </div>
            <div class="guide-programs-container" style="width:${rowWidth}px; position:relative; overflow:hidden;">
                ${programsHtml || '<span style="color:var(--text-secondary); padding-left:8px; line-height:60px;">No programme information</span>'}
            </div>
        </div>
    `;
};

FluxTV.guideSuggestionsHTML = function(channels) {
    return `<table class="table guide-table">
        <thead><tr><th>Channel</th><th>Group</th><th>Suggested EPG</th><th>Confidence</th><th>Actions</th></tr></thead>
        <tbody>${channels.map(ch => {
            const sug = ch.suggested[0];
            return `<tr>
                <td style="display:flex;align-items:center;gap:0.8rem;">
                    ${ch.logo_url ? `<img src="${ch.logo_url}" style="height:30px;width:auto;border-radius:6px;" onerror="this.outerHTML='<span>${this.escape(ch.name.substring(0,2))}</span>'" />` : `<span>${this.escape(ch.name.substring(0,2))}</span>`}
                    <span>${this.escape(ch.name)}</span>
                </td>
                <td>${this.escape(ch.group || '')}</td>
                <td>${this.escape(sug.display_name)}</td>
                <td>${sug.confidence}%</td>
                <td>
                    <button class="btn" data-action="accept-epg-suggestion" data-mapping-id="${sug.mapping_id}">Accept</button>
                    <button class="btn" data-action="reject-epg-suggestion" data-mapping-id="${sug.mapping_id}">Reject</button>
                </td>
            </tr>`;
        }).join('')}</tbody>
    </table>`;
};

FluxTV.guideUnmappedHTML = function(channels) {
    return `<table class="table guide-table">
        <thead><tr><th>Channel</th><th>Group</th><th>EPG</th></tr></thead>
        <tbody>${channels.map(ch => `
            <tr>
                <td style="display:flex;align-items:center;gap:0.8rem;">
                    ${ch.logo_url ? `<img src="${ch.logo_url}" style="height:30px;width:auto;border-radius:6px;" onerror="this.outerHTML='<span>${this.escape(ch.name.substring(0,2))}</span>'" />` : `<span>${this.escape(ch.name.substring(0,2))}</span>`}
                    <span>${this.escape(ch.name)}</span>
                </td>
                <td>${this.escape(ch.group || '')}</td>
                <td>${ch.epg_display_name ? this.escape(ch.epg_display_name) : '—'}</td>
            </tr>`).join('')}</tbody>
    </table>`;
};

FluxTV.renderLogosMapping = async function(container) {
    this.logoSources = await this.get('/api/logos/sources');
    const channels = await this.get('/api/channels?enabled=true');

    container.innerHTML = `
        <div class="section-header">
            <h1 class="section-title">Logo Mapping</h1>
            <div style="display:flex;gap:0.5rem;">
                <button class="btn" id="force-match-logos-btn">Force Match Missing</button>
                <button class="btn" id="force-replace-logos-btn" style="color:var(--danger);">Force Replace All</button>
                <button class="btn" id="check-logos-btn">Check Logos</button>
            </div>
        </div>
        <div id="logo-check-results" style="display:none; margin-bottom:1rem;"></div>
        <div class="logo-manager-grid" id="logo-manager-grid">
            ${channels.map(ch => {
                const hasLogo = ch.logo_url;
                const statusClass = hasLogo ? 'configured' : 'missing';
                const statusText = hasLogo ? 'Configured' : 'Not Configured';
                const logoHtml = hasLogo 
                    ? `<img src="${ch.logo_url}" alt="${this.escape(ch.name)}" onerror="this.outerHTML='<div class=\'logo-fallback\'>${this.escape(ch.name.substring(0,2))}</div>'" />` 
                    : `<div class="logo-fallback">${this.escape(ch.name.substring(0,2))}</div>`;

                return `
                    <div class="logo-manager-card" data-channel-id="${ch.id}">
                        <div class="logo-manager-top">
                            <div class="logo-preview">
                                ${logoHtml}
                            </div>
                            <div class="logo-info">
                                <div class="logo-channel-name">${this.escape(ch.name)}</div>
                                <div class="logo-channel-group">${this.escape(ch.group?.name || 'General')}</div>
                                <div class="logo-status-row">
                                    <span class="status-dot ${statusClass}"></span> ${statusText}
                                </div>
                            </div>
                        </div>
                        <div class="logo-actions">
                            <button class="btn btn-sm" data-action="assign-logo" data-channel-id="${ch.id}">Assign Logo</button>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;

    const forceMatchBtn = container.querySelector('#force-match-logos-btn');
    forceMatchBtn.addEventListener('click', async () => {
        if (!confirm('Assign the best available logo to channels without one?')) return;
        forceMatchBtn.textContent = 'Matching...';
        forceMatchBtn.disabled = true;
        try {
            const result = await this.post('/api/logos/force-match?replace=false', {});
            this.toast(`Assigned ${result.assigned} logos`, 'success');
        } catch (err) { this.toast('Force match failed: ' + err.message, 'error'); }
        finally {
            forceMatchBtn.textContent = 'Force Match Missing';
            forceMatchBtn.disabled = false;
            this.renderLogosMapping(container);
        }
    });

    const forceReplaceBtn = container.querySelector('#force-replace-logos-btn');
    forceReplaceBtn.addEventListener('click', async () => {
        if (!confirm('Replace ALL logos (including manual) with best available matches?')) return;
        forceReplaceBtn.textContent = 'Replacing...';
        forceReplaceBtn.disabled = true;
        try {
            const result = await this.post('/api/logos/force-match?replace=true', {});
            this.toast(`Reassigned ${result.assigned} logos`, 'success');
        } catch (err) { this.toast('Force replace failed: ' + err.message, 'error'); }
        finally {
            forceReplaceBtn.textContent = 'Force Replace All';
            forceReplaceBtn.disabled = false;
            this.renderLogosMapping(container);
        }
    });

    const checkLogosBtn = container.querySelector('#check-logos-btn');
    const checkResults = container.querySelector('#logo-check-results');
    checkLogosBtn.addEventListener('click', async () => {
        checkLogosBtn.textContent = 'Checking...';
        checkLogosBtn.disabled = true;
        try {
            const result = await this.get('/api/logos/check');
            checkResults.style.display = 'block';
            if (result.count === 0) {
                checkResults.innerHTML = '<div class="empty-state"><p>All logo URLs are working.</p></div>';
            } else {
                checkResults.innerHTML = `
                    <h3>Broken Logos (${result.count})</h3>
                    <div class="logo-manager-grid">
                        ${result.broken.map(b => `
                            <div class="logo-manager-card">
                                <div class="logo-manager-top">
                                    <div class="logo-preview"><div class="logo-fallback">${this.escape(b.name.substring(0,2))}</div></div>
                                    <div class="logo-info">
                                        <div class="logo-channel-name">${this.escape(b.name)}</div>
                                        <div class="logo-status-row"><span class="status-dot missing"></span> Broken URL</div>
                                    </div>
                                </div>
                                <div class="logo-actions">
                                    <button class="btn btn-sm" data-action="assign-logo" data-channel-id="${b.channel_id}">Assign Logo</button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                `;
                checkResults.querySelectorAll('[data-action="assign-logo"]').forEach(btn => {
                    btn.addEventListener('click', () => this.showLogoAssignModal(parseInt(btn.dataset.channelId)));
                });
            }
        } catch (err) { checkResults.innerHTML = `<p>Error checking logos: ${err.message}</p>`; }
        finally {
            checkLogosBtn.textContent = 'Check Logos';
            checkLogosBtn.disabled = false;
        }
    });

    container.querySelectorAll('[data-action="assign-logo"]').forEach(btn => {
        btn.addEventListener('click', () => this.showLogoAssignModal(parseInt(btn.dataset.channelId)));
    });
};

FluxTV.showLogoAssignModal = function(channelId) {
    const modal = document.getElementById('modal-root');
    modal.hidden = false;
    modal.innerHTML = `
        <div class="modal-content">
            <h2>Assign Logo</h2>
            <div class="form-row">
                <div class="form-group" style="flex:1;">
                    <label>Search Logos</label>
                    <input type="text" id="logo-search-input" placeholder="Search logo by name..." />
                </div>
                <div class="form-group" style="flex:1;">
                    <label>Source</label>
                    <select id="logo-source-filter">
                        <option value="">All Sources</option>
                        ${this.logoSources.map(s => `<option value="${s.id}">${this.escape(s.name)}</option>`).join('')}
                    </select>
                </div>
            </div>
            <div id="logo-results" class="logo-results-grid">
                <p>Type to search...</p>
            </div>
            <hr style="border-color: var(--border); margin: 1.5rem 0;" />
            <h3>Or Use Custom URL</h3>
            <div class="form-group">
                <label>Logo URL</label>
                <input type="text" id="custom-logo-url" placeholder="https://example.com/logo.png" />
            </div>
            <button class="btn btn-primary" id="assign-custom-logo-btn">Assign Custom URL</button>
            <div style="display:flex;gap:1rem;margin-top:1rem;">
                <button class="btn" id="cancel-logo-assign">Cancel</button>
            </div>
        </div>
    `;

    const searchInput = document.getElementById('logo-search-input');
    const sourceFilter = document.getElementById('logo-source-filter');
    const resultsDiv = document.getElementById('logo-results');
    const cancelBtn = document.getElementById('cancel-logo-assign');
    const customUrlInput = document.getElementById('custom-logo-url');
    const assignCustomBtn = document.getElementById('assign-custom-logo-btn');
    let searchTimer;

    cancelBtn.addEventListener('click', () => { modal.hidden = true; });

    const performSearch = async (query) => {
        resultsDiv.innerHTML = '<p>Searching...</p>';
        const srcId = sourceFilter.value;
        let url = `/api/logos/entries?search=${encodeURIComponent(query)}`;
        if (srcId) url += `&source_id=${srcId}`;
        try {
            const entries = await this.get(url);
            if (entries.length === 0) {
                resultsDiv.innerHTML = '<p>No logos found.</p>';
                return;
            }
            resultsDiv.innerHTML = entries.map(entry => `
                <div class="logo-result-card" data-entry-id="${entry.id}" data-logo-url="${entry.url}" tabindex="0">
                    <img src="${entry.url}" alt="${this.escape(entry.name)}" loading="lazy" onerror="this.parentElement.style.display='none'" />
                    <span class="logo-result-name">${this.escape(entry.name)}</span>
                </div>
            `).join('');

            resultsDiv.querySelectorAll('.logo-result-card').forEach(card => {
                const selectLogo = async () => {
                    const entryId = card.dataset.entryId;
                    const logoUrl = card.dataset.logoUrl;
                    try {
                        if (entryId === "0") await this.post('/api/logos/assign-custom', { channel_id: channelId, logo_url: logoUrl });
                        else await this.post('/api/logos/assign', { channel_id: channelId, logo_entry_id: parseInt(entryId) });
                        modal.hidden = true;
                        this.toast('Logo assigned', 'success');
                        if (this.state.view === 'logos') this.showView('logos');
                    } catch (err) { this.toast('Assignment failed: ' + err.message, 'error'); }
                };
                card.addEventListener('click', selectLogo);
                card.addEventListener('keydown', (e) => { if (e.key === 'Enter') selectLogo(); });
            });
        } catch (err) { resultsDiv.innerHTML = `<p>Error: ${err.message}</p>`; }
    };

    const triggerSearch = () => {
        clearTimeout(searchTimer);
        const query = searchInput.value.trim();
        if (query.length >= 2) searchTimer = setTimeout(() => performSearch(query), 300);
        else if (query.length === 0) resultsDiv.innerHTML = '<p>Type to search...</p>';
    };

    searchInput.addEventListener('input', triggerSearch);
    sourceFilter.addEventListener('change', triggerSearch);

    assignCustomBtn.addEventListener('click', async () => {
        const logoUrl = customUrlInput.value.trim();
        if (!logoUrl) { this.toast('Please enter a logo URL', 'error'); return; }
        try {
            await this.post('/api/logos/assign-custom', { channel_id: channelId, logo_url: logoUrl });
            modal.hidden = true;
            this.toast('Custom logo assigned', 'success');
            if (this.state.view === 'logos') this.showView('logos');
        } catch (err) { this.toast('Assignment failed: ' + err.message, 'error'); }
    });

    searchInput.focus();
};

FluxTV.heroHTML = function(channel) {
    const logo = channel.logo_url ? `<img src="${channel.logo_url}" class="hero-logo" alt="${this.escape(channel.name)}" />` : `<div class="logo-fallback" style="font-size:2rem;margin-right:2rem;">${this.escape(channel.name)}</div>`;
    const program = channel.current_program ? channel.current_program.title : 'No program information';
    return `<div class="hero">
        ${logo}
        <div class="hero-info">
            <h1>${this.escape(channel.name)}</h1>
            <div class="hero-meta">${this.escape(channel.group?.name || '')}</div>
            <div class="hero-meta">${this.escape(program)}</div>
            <div class="hero-actions">
                <button class="btn btn-primary" data-watch="${channel.id}">Watch Now</button>
            </div>
        </div>
    </div>`;
};

FluxTV.sectionHTML = function(title, channels) {
    return `<section class="section">
        <div class="section-header">
            <h2 class="section-title">${this.escape(title)}</h2>
            <div class="row-scroll-buttons">
                <button class="scroll-btn" data-scroll="left"><</button>
                <button class="scroll-btn" data-scroll="right">></button>
            </div>
        </div>
        <div class="row-scroller" data-scroller>
            ${channels.map(ch => this.channelCardHTML(ch)).join('')}
        </div>
    </section>`;
};

FluxTV.channelCardHTML = function(channel) {
    const logo = channel.logo_url 
        ? `<img src="${channel.logo_url}" alt="${this.escape(channel.name)}" onerror="this.outerHTML='<div class=\'logo-fallback\'>${this.escape(channel.name.substring(0,4))}</div>'" />` 
        : `<div class="logo-fallback">${this.escape(channel.name.substring(0,4))}</div>`;
    const fav = channel.favorite ? '<span class="fav-star">⭐</span>' : '';
    return `<div class="channel-card" tabindex="0" data-channel-id="${channel.id}">
        ${fav}
        <div class="logo-area">${logo}</div>
        <div class="meta">
            <div class="name-row">
                <span class="name">${this.escape(channel.name)}</span>
                <span class="live-indicator">LIVE</span>
            </div>
            <div class="program-info" data-epg-container="${channel.id}">
                <div class="program-current" data-current>No program information</div>
                <div class="program-next" data-next></div>
            </div>
        </div>
    </div>`;
};

FluxTV.bindChannelCardActions = function(container) {
    container.querySelectorAll('[data-channel-id]').forEach(card => {
        card.addEventListener('click', () => this.openPlayer(parseInt(card.dataset.channelId)));
        card.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.openPlayer(parseInt(card.dataset.channelId)); });
    });
    container.querySelectorAll('[data-watch]').forEach(btn => {
        btn.addEventListener('click', () => this.openPlayer(parseInt(btn.dataset.watch)));
    });
    container.querySelectorAll('[data-action="add-channel"]').forEach(btn => {
        btn.addEventListener('click', () => this.showView('manage', { sub: 'channels' }));
    });
    container.querySelectorAll('[data-action="import"]').forEach(btn => {
        btn.addEventListener('click', () => this.showView('manage', { sub: 'import' }));
    });
};

FluxTV.updateEPGForCards = async function(container) {
    const cards = container.querySelectorAll('.channel-card');
    if (!cards.length) return;
    const ids = [...cards].map(card => card.dataset.channelId).join(',');
    try {
        const data = await this.get(`/api/epg/now-next?channel_ids=${ids}`);
        for (const card of cards) {
            const cid = card.dataset.channelId;
            const epgInfo = data[cid];
            if (epgInfo) {
                const currentEl = card.querySelector('[data-current]');
                const nextEl = card.querySelector('[data-next]');
                if (currentEl && epgInfo.current) currentEl.textContent = epgInfo.current.title;
                if (nextEl && epgInfo.next) nextEl.textContent = `Next: ${epgInfo.next.title}`;
            }
        }
    } catch (err) { console.warn('EPG update failed:', err); }
};

FluxTV.addScrollButtons = function() {
    document.querySelectorAll('.row-scroll-buttons').forEach(btnGroup => {
        const section = btnGroup.closest('.section');
        if (!section) return;
        const scroller = section.querySelector('[data-scroller]');
        if (!scroller) return;
        const leftBtn = btnGroup.querySelector('[data-scroll="left"]');
        const rightBtn = btnGroup.querySelector('[data-scroll="right"]');
        if (leftBtn) {
            const newLeft = leftBtn.cloneNode(true);
            leftBtn.parentNode.replaceChild(newLeft, leftBtn);
            newLeft.addEventListener('click', () => scroller.scrollBy({ left: -600, behavior: 'smooth' }));
        }
        if (rightBtn) {
            const newRight = rightBtn.cloneNode(true);
            rightBtn.parentNode.replaceChild(newRight, rightBtn);
            newRight.addEventListener('click', () => scroller.scrollBy({ left: 600, behavior: 'smooth' }));
        }
    });
};

FluxTV.escape = function(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
};
FluxTV.escapeAttribute = function(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
};
