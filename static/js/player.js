FluxTV.openPlayer = async function(channelId) {
    try {
        const channel = await this.get(`/api/channels/${channelId}`);
        this.state.channel = channel;

        this.state.recent = [channel.id, ...this.state.recent.filter(id => id !== channel.id)].slice(0, 20);
        localStorage.setItem('fluxtv_recent', JSON.stringify(this.state.recent));

        const playerRoot = document.getElementById('player-root');
        if (!playerRoot) throw new Error('Player root not found.');

        playerRoot.classList.remove('guide-open');
        playerRoot.hidden = false;

        playerRoot.innerHTML = `
            <div class="player-top">
                <button class="btn icon-btn" id="player-back" aria-label="Back">
                    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
                </button>
                <div class="player-title">${this.escape(channel.name)}</div>
                <button class="btn icon-btn" id="player-fav" aria-label="${channel.favorite ? 'Remove from favorites' : 'Add to favorites'}">
                    <svg viewBox="0 0 24 24" width="24" height="24" fill="${channel.favorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                </button>
            </div>

            <div class="player-iframe-wrapper">
                ${channel.embed_url ? `
                    <iframe 
                        id="channel-player" 
                        src="${this.escapeAttribute(channel.embed_url)}" 
                        allow="autoplay; encrypted-media; picture-in-picture; fullscreen" 
                        allowfullscreen
                        webkitallowfullscreen
                        referrerpolicy="no-referrer-when-downgrade" 
                        title="${this.escapeAttribute(channel.name)}"
                    ></iframe>
                ` : `<div class="player-empty"><div class="empty-state"><h2>No embed URL configured.</h2><p>This channel does not currently have a playable source.</p></div></div>`}
            </div>

            <div class="player-info">
                <div class="program-title">${this.escape(channel.name)}</div>
                <div id="player-epg-info">${await this.getEPGInfoHTML(channel)}</div>
                <div class="player-nav-buttons">
                    <button class="btn icon-btn" id="player-prev" aria-label="Previous channel"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="19 20 9 12 19 4 19 20"></polygon><line x1="5" y1="19" x2="5" y2="5"></line></svg></button>
                    <button class="btn btn-primary icon-btn" id="player-guide-btn" aria-label="Open TV Guide"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="15" rx="2" ry="2"></rect><polyline points="17 2 12 7 7 2"></polyline></svg></button>
                    <button class="btn icon-btn" id="player-next" aria-label="Next channel"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 4 15 12 5 20 5 4"></polygon><line x1="19" y1="5" x2="19" y2="19"></line></svg></button>
                    <button class="btn icon-btn" id="player-fullscreen" aria-label="Fullscreen"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"></path><path d="M21 8V5a2 2 0 0 0-2-2h-3"></path><path d="M3 16v3a2 2 0 0 0 2 2h3"></path><path d="M16 21h3a2 2 0 0 0 2-2v-3"></path></svg></button>
                </div>
            </div>
        `;

        // Ensure event aborting is active to prevent memory leaks
        if (this._playerAborter) this._playerAborter.abort();
        this._playerAborter = new AbortController();
        const { signal } = this._playerAborter;

        // ============================================================
        // HARMONIZED FULLSCREEN MANAGER
        // ============================================================
        const handleIframeFullscreen = () => {
            const fsElement = document.fullscreenElement || document.webkitFullscreenElement;

            if (!fsElement) {
                playerRoot.classList.remove('custom-fullscreen-active');
                return;
            }

            if (fsElement === playerRoot) {
                playerRoot.classList.add('custom-fullscreen-active');
            }
        };

        document.addEventListener('fullscreenchange', handleIframeFullscreen, { signal });
        document.addEventListener('webkitfullscreenchange', handleIframeFullscreen, { signal });

        // ============================================================
        // FIRE-STICK REMOTE BACK BUTTON (POPSTATE FIX)
        // ============================================================
        const handlePopState = (e) => {
            if (document.fullscreenElement || document.webkitFullscreenElement) {
                e.preventDefault();
                this.exitFullscreen();
                history.pushState({ player: true }, '');
            } else if (!playerRoot.hidden) {
                e.preventDefault();
                this.closePlayer();
                history.pushState({ player: true }, '');
            }
        };

        history.pushState({ player: true }, '');
        window.addEventListener('popstate', handlePopState, { signal });

        // KEYDOWN LISTENER AS A BACKUP
        const handleKeyDown = (e) => {
            if (e.key === 'Escape' || e.key === 'Backspace') {
                if (document.fullscreenElement || document.webkitFullscreenElement) {
                    e.preventDefault();
                    this.exitFullscreen();
                } else if (!playerRoot.hidden) {
                    e.preventDefault();
                    this.closePlayer();
                }
            }
        };
        document.addEventListener('keydown', handleKeyDown, { signal });

        // Back button UI
        document.getElementById('player-back')?.addEventListener('click', () => this.closePlayer());

        // Favorite button
        document.getElementById('player-fav')?.addEventListener('click', async () => {
            try {
                await this.put(`/api/channels/${channel.id}/favorite`, {});
                const updated = await this.get(`/api/channels/${channel.id}`);
                this.state.channel = updated;
                const svg = document.getElementById('player-fav')?.querySelector('svg');
                if (svg) svg.setAttribute('fill', updated.favorite ? 'currentColor' : 'none');
            } catch { this.toast('Unable to update favorites.', 'error'); }
        });

        // Previous channel
        document.getElementById('player-prev')?.addEventListener('click', async () => {
            const prev = await this.getAdjacentChannel(channel.id, 'prev');
            if (prev) this.openPlayer(prev.id);
        });

        // Next channel
        document.getElementById('player-next')?.addEventListener('click', async () => {
            const next = await this.getAdjacentChannel(channel.id, 'next');
            if (next) this.openPlayer(next.id);
        });

        // ============================================================
        // FULLSCREEN BUTTON (FIXED TO TARGET THE IFRAME DIRECTLY)
        // ============================================================
        document.getElementById('player-fullscreen')?.addEventListener('click', async () => {
            try {
                const iframe = playerRoot.querySelector('iframe');
                if (!iframe) return;

                if (document.fullscreenElement || document.webkitFullscreenElement) {
                    await this.exitFullscreen();
                } else {
                    if (iframe.requestFullscreen) {
                        await iframe.requestFullscreen();
                    } else if (iframe.webkitRequestFullscreen) {
                        iframe.webkitRequestFullscreen();
                    } else if (iframe.msRequestFullscreen) {
                        iframe.msRequestFullscreen();
                    }
                }
            } catch (err) { console.warn('Fullscreen failed:', err); }
        });

        // Guide button
        document.getElementById('player-guide-btn')?.addEventListener('click', () => {
            this.showPlayerGuideOverlay(channel.id);
        });

        document.getElementById('player-back')?.focus();
        
        // Clean up safely on close
        const originalClose = this.closePlayer;
        this.closePlayer = function() {
            if (this._playerAborter) this._playerAborter.abort(); 
            originalClose.call(this);
            this.closePlayer = originalClose; 
        };

    } catch (err) {
        console.error('Unable to load player:', err);
        this.toast('Unable to load this channel. ' + err.message, 'error');
    }
};

// ============================================================
// CROSS-BROWSER FULLSCREEN HELPERS
// ============================================================
FluxTV.requestFullscreen = function(element) {
    if (element.requestFullscreen) return element.requestFullscreen();
    else if (element.webkitRequestFullscreen) return element.webkitRequestFullscreen();
    else if (element.msRequestFullscreen) return element.msRequestFullscreen();
};

FluxTV.exitFullscreen = function() {
    if (document.exitFullscreen) return document.exitFullscreen();
    else if (document.webkitExitFullscreen) return document.webkitExitFullscreen();
    else if (document.msExitFullscreen) return document.msExitFullscreen();
};

FluxTV.closePlayer = function() {
    const playerRoot = document.getElementById('player-root');
    if (!playerRoot) return;
    playerRoot.classList.remove('guide-open');
    playerRoot.hidden = true;
    playerRoot.innerHTML = '';
    
    if (history.state && history.state.player) {
        history.back();
    }
};

FluxTV.getAdjacentChannel = async function(channelId, direction) {
    const channels = await this.get('/api/channels?enabled=true');
    const index = channels.findIndex(channel => String(channel.id) === String(channelId));
    if (index === -1) return null;
    if (direction === 'next') return channels[index + 1] || channels[0] || null;
    if (direction === 'prev') return channels[index - 1] || channels[channels.length - 1] || null;
    return null;
};

FluxTV.getEPGInfoHTML = async function(channel) {
    if (!channel.epg_channel_id) return `<div class="program-time">Program information unavailable</div>`;
    try {
        const data = await this.get(`/api/epg/now-next?channel_ids=${encodeURIComponent(channel.id)}`);
        const epgInfo = data?.[channel.id];
        if (!epgInfo || (!epgInfo.current && !epgInfo.next)) return `<div class="program-time">Program information unavailable</div>`;
        let html = '';
        if (epgInfo.current) {
            const start = new Date(epgInfo.current.start_time);
            const end = new Date(epgInfo.current.end_time);
            const duration = end.getTime() - start.getTime();
            const elapsed = Date.now() - start.getTime();
            const progress = duration > 0 ? Math.max(0, Math.min(100, (elapsed / duration) * 100)) : 0;
            html += `<div class="player-current-program">
                <span class="live-indicator">● LIVE</span>
                <div class="program-title">${this.escape(epgInfo.current.title)}</div>
                <div class="program-time">${this.escape(start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))} – ${this.escape(end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))}</div>
                <div class="player-program-progress"><div style="width:${progress.toFixed(1)}%"></div></div>
            </div>`;
        }
        if (epgInfo.next) {
            const start = new Date(epgInfo.next.start_time);
            const end = new Date(epgInfo.next.end_time);
            html += `<div class="player-next">Next: ${this.escape(epgInfo.next.title)} <span class="player-next-time">${this.escape(start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))} – ${this.escape(end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))}</span></div>`;
        }
        return html;
    } catch { return `<div class="program-time">Program information unavailable</div>`; }
};

FluxTV.showPlayerGuideOverlay = async function(currentChannelId) {
    const playerRoot = document.getElementById('player-root');
    if (!playerRoot) return;
    const existing = playerRoot.querySelector('.player-guide-overlay');
    if (existing) {
        existing.remove();
        playerRoot.classList.remove('guide-open');
        return;
    }
    playerRoot.classList.add('guide-open');
    let guideData;
    try { guideData = await this.get('/api/epg/guide'); } catch {
        playerRoot.classList.remove('guide-open');
        this.toast('Unable to load the TV guide.', 'error');
        return;
    }
    const now = new Date();
    const startRange = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const endRange = new Date(now.getTime() + 6 * 60 * 60 * 1000);
    const TIME_SLOT_WIDTH = 180;
    const timeSlots = [];
    for (let time = startRange; time <= endRange; time = new Date(time.getTime() + 30 * 60 * 1000)) timeSlots.push(time);
    const mapped = (guideData || []).filter(ch => ch.epg_assignment_mode === 'automatic' || ch.epg_assignment_mode === 'manual')
        .sort((a, b) => {
            const aIsCurrent = String(a.id) === String(currentChannelId);
            const bIsCurrent = String(b.id) === String(currentChannelId);
            if (aIsCurrent && !bIsCurrent) return -1;
            if (!aIsCurrent && bIsCurrent) return 1;
            return String(a.name || '').localeCompare(String(b.name || ''));
        });
    const overlay = document.createElement('div');
    overlay.className = 'player-guide-overlay';
    overlay.innerHTML = `
        <div class="player-guide-surface" role="dialog" aria-label="TV Guide">
            <div class="player-guide-header">
                <div class="player-guide-heading">
                    <div class="player-guide-title">TV Guide</div>
                    <div class="player-guide-current-time">${this.escape(now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))}</div>
                </div>
                <button type="button" class="player-guide-close" id="player-guide-close" aria-label="Close TV Guide">
                    <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
            </div>
            <div class="player-guide-now-playing">
                <div class="player-guide-now-playing-art">
                    ${this.state.channel?.logo_url ? `<img src="${this.escapeAttribute(this.state.channel.logo_url)}" alt="${this.escapeAttribute(this.state.channel.name || '')}" />` : `<div class="player-guide-now-playing-fallback">${this.escape((this.state.channel?.name || 'TV').substring(0, 3).toUpperCase())}</div>`}
                </div>
                <div class="player-guide-now-playing-info">
                    <div class="player-guide-eyebrow">NOW PLAYING</div>
                    <div class="player-guide-now-playing-name">${this.escape(this.state.channel?.name || 'Live TV')}</div>
                    <div class="player-guide-now-playing-program" id="player-guide-current-program">Loading program...</div>
                </div>
            </div>
            <div class="player-guide-toolbar">
                <button type="button" class="player-guide-tool active" data-guide-scroll="now">Now</button>
                <button type="button" class="player-guide-tool" data-guide-scroll="back">Earlier</button>
                <button type="button" class="player-guide-tool" data-guide-scroll="forward">Later</button>
            </div>
            <div class="player-guide-scroll" id="player-guide-scroll">
                <div class="guide-grid player-guide-grid" style="--guide-time-width:${TIME_SLOT_WIDTH}px;">
                    <div class="guide-header-row">
                        <div class="guide-channel-header">Channel</div>
                        ${timeSlots.map(time => `<div class="guide-time-slot" style="min-width:${TIME_SLOT_WIDTH}px;">${this.escape(time.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))}</div>`).join('')}
                    </div>
                    ${mapped.map(channel => {
                        let row = this.channelGuideRowHTML(channel, startRange, endRange, timeSlots);
                        if (String(channel.id) === String(currentChannelId)) row = row.replace('guide-channel-row', 'guide-channel-row guide-channel-playing');
                        return row;
                    }).join('')}
                </div>
            </div>
            <div class="player-guide-footer">
                <div><kbd>ESC</kbd> Close</div>
                <div><kbd>↑</kbd><kbd>↓</kbd> Channels</div>
                <div><kbd>ENTER</kbd> Watch</div>
            </div>
        </div>
    `;
    playerRoot.appendChild(overlay);
    const closeGuide = () => {
        overlay.remove();
        playerRoot.classList.remove('guide-open');
        document.removeEventListener('keydown', keyboardHandler);
    };
    overlay.querySelector('#player-guide-close')?.addEventListener('click', closeGuide);
    overlay.querySelectorAll('[data-channel-id]').forEach(element => {
        element.addEventListener('click', event => {
            event.preventDefault();
            const id = parseInt(element.dataset.channelId);
            if (!Number.isFinite(id)) return;
            closeGuide();
            this.openPlayer(id);
        });
    });
    const scrollContainer = overlay.querySelector('#player-guide-scroll');
    overlay.querySelectorAll('[data-guide-scroll]').forEach(button => {
        button.addEventListener('click', () => {
            const direction = button.dataset.guideScroll;
            if (direction === 'now') {
                const current = overlay.querySelector('.guide-channel-playing');
                current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
            } else if (direction === 'back') {
                scrollContainer.scrollBy({ left: -600, behavior: 'smooth' });
            } else if (direction === 'forward') {
                scrollContainer.scrollBy({ left: 600, behavior: 'smooth' });
            }
        });
    });
    try {
        const epgData = await this.get(`/api/epg/now-next?channel_ids=${encodeURIComponent(currentChannelId)}`);
        const currentInfo = epgData?.[currentChannelId]?.current;
        const featured = overlay.querySelector('#player-guide-current-program');
        if (featured && currentInfo) featured.textContent = currentInfo.title || 'Program information unavailable';
        else if (featured) featured.textContent = 'Program information unavailable';
    } catch {}
    const keyboardHandler = event => {
        if (!playerRoot.querySelector('.player-guide-overlay')) {
            document.removeEventListener('keydown', keyboardHandler);
            return;
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            closeGuide();
            return;
        }
        const channels = [...overlay.querySelectorAll('[data-channel-id]')];
        const currentIndex = channels.indexOf(document.activeElement);
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            if (currentIndex >= 0 && currentIndex < channels.length - 1) {
                channels[currentIndex + 1]?.focus();
                channels[currentIndex + 1]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
        }
        if (event.key === 'ArrowUp') {
            event.preventDefault();
            if (currentIndex > 0) {
                channels[currentIndex - 1]?.focus();
                channels[currentIndex - 1]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
        }
    };
    document.addEventListener('keydown', keyboardHandler);
    const activeRow = overlay.querySelector('.guide-channel-playing');
    if (activeRow) activeRow.focus();
    else overlay.querySelector('[data-channel-id]')?.focus();
};

FluxTV.escapeAttribute = function(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
};
