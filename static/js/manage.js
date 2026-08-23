FluxTV.renderManage = async function(container) {
    const sub = this.state.manageSub || 'channels';
    container.innerHTML = `
        <div class="section-header">
            <h1 class="section-title">Manage</h1>
        </div>
        <div class="manage-nav">
            <button class="nav-btn" data-manage="channels">Channels</button>
            <button class="nav-btn" data-manage="groups">Groups</button>
            <button class="nav-btn" data-manage="logos">Logos</button>
            <button class="nav-btn" data-manage="epg">EPG Sources</button>
            <button class="nav-btn" data-manage="mapping">EPG Mapping</button>
            <button class="nav-btn" data-manage="import">Import</button>
            <button class="nav-btn" data-manage="export">Export</button>
            <button class="nav-btn" data-manage="backup">Backup</button>
        </div>
        <div id="manage-content"></div>
    `;
    document.querySelectorAll('.manage-nav [data-manage]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.manage === sub);
        btn.addEventListener('click', () => {
            this.state.manageSub = btn.dataset.manage;
            this.renderManage(container);
        });
    });
    await this.renderManageSection(sub, document.getElementById('manage-content'));
};

FluxTV.renderManageSection = async function(section, el) {
    switch (section) {
        case 'channels': await this.renderChannelsManage(el); break;
        case 'groups': await this.renderGroupsManage(el); break;
        case 'logos': await this.renderLogosManage(el); break;
        case 'epg': await this.renderEPGSourcesManage(el); break;
        case 'mapping': await this.renderEPGMappingManage(el); break;
        case 'import': await this.renderImportManage(el); break;
        case 'export': await this.renderExportManage(el); break;
        case 'backup': await this.renderBackupManage(el); break;
        default: el.innerHTML = '<div class="empty-state"><h2>Manage</h2></div>';
    }
};

// ========== Channels Management (Cards) ==========
FluxTV.renderChannelsManage = async function(el) {
    const channels = await this.get('/api/channels');
    el.innerHTML = `
        <div style="display:flex;gap:1rem;margin-bottom:1.5rem;">
            <input id="channel-filter" placeholder="Filter..." style="flex:1;padding:0.8rem;background:var(--card);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);" />
            <button class="btn btn-primary" id="add-channel-btn">+ Add Channel</button>
        </div>
        <div style="display:flex;gap:1rem;align-items:center;margin-bottom:1.5rem;">
            <label style="display:flex;align-items:center;gap:0.3rem;font-weight:600;">
                <input type="checkbox" id="select-all-channels" />
                Select All
            </label>
            <button class="btn" id="delete-selected-btn" disabled>Delete Selected</button>
            <button class="btn" id="delete-all-btn" style="color:var(--danger);">Delete All</button>
        </div>
        
        <div class="manage-grid">
            ${channels.map(ch => `
                <div class="manage-card">
                    <div class="manage-card-top">
                        <label class="channel-select-wrap">
                            <input type="checkbox" class="channel-select" data-id="${ch.id}" />
                        </label>
                        <div class="manage-card-logo-preview">
                            ${ch.logo_url ? `<img src="${ch.logo_url}" onerror="this.outerHTML='<span class=logo-fallback>${this.escape(ch.name.substring(0,2))}</span>'" />` : `<span class="logo-fallback">${this.escape(ch.name.substring(0,2))}</span>`}
                        </div>
                        <div class="manage-card-info">
                            <div class="manage-card-title">${this.escape(ch.name)}</div>
                            <div class="manage-card-meta">${this.escape(ch.group?.name || 'General')}</div>
                            <div class="manage-card-badges">
                                ${ch.enabled ? '<span class="badge badge-green">Enabled</span>' : '<span class="badge badge-red">Disabled</span>'}
                                ${ch.embed_url ? '<span class="badge badge-blue">Playable</span>' : ''}
                            </div>
                        </div>
                    </div>
                    <div class="manage-card-settings">
                        <div>Logo Mode: <strong>${ch.logo_assignment_mode || 'None'}</strong></div>
                        <div>EPG Mode: <strong>${ch.epg_assignment_mode || 'None'}</strong></div>
                    </div>
                    <div class="manage-card-actions">
                        <button class="btn btn-sm" data-action="edit-channel" data-id="${ch.id}">Edit</button>
                        <button class="btn btn-sm" data-action="test-channel" data-id="${ch.id}">Test</button>
                        <button class="btn btn-sm" data-action="fav-channel" data-id="${ch.id}">${ch.favorite ? '★' : '☆'}</button>
                        <button class="btn btn-sm" data-action="toggle-channel" data-id="${ch.id}">${ch.enabled ? 'Disable' : 'Enable'}</button>
                        <button class="btn btn-sm btn-danger" data-action="delete-channel" data-id="${ch.id}">Delete</button>
                    </div>
                </div>
            `).join('')}
        </div>
    `;

    const channelCheckboxes = el.querySelectorAll('.channel-select');
    const selectAllCheckbox = el.querySelector('#select-all-channels');
    const deleteSelectedBtn = el.querySelector('#delete-selected-btn');
    const deleteAllBtn = el.querySelector('#delete-all-btn');

    const updateDeleteSelected = () => {
        const selected = [...channelCheckboxes].filter(cb => cb.checked).length;
        deleteSelectedBtn.disabled = selected === 0;
    };

    channelCheckboxes.forEach(cb => {
        cb.addEventListener('change', () => {
            updateDeleteSelected();
            const allChecked = [...channelCheckboxes].every(c => c.checked);
            selectAllCheckbox.checked = allChecked;
        });
    });

    selectAllCheckbox.addEventListener('change', () => {
        channelCheckboxes.forEach(cb => cb.checked = selectAllCheckbox.checked);
        updateDeleteSelected();
    });

    deleteSelectedBtn.addEventListener('click', async () => {
        const ids = [...channelCheckboxes].filter(cb => cb.checked).map(cb => parseInt(cb.dataset.id));
        if (!ids.length) return;
        if (confirm(`Delete ${ids.length} selected channel(s)?`)) {
            try {
                await this.post('/api/channels/bulk-delete', { ids, delete_all: false });
                this.renderChannelsManage(el);
            } catch (err) { alert('Bulk delete failed: ' + err.message); }
        }
    });

    deleteAllBtn.addEventListener('click', async () => {
        if (confirm('Delete ALL channels? This cannot be undone.')) {
            try {
                await this.post('/api/channels/bulk-delete', { ids: [], delete_all: true });
                this.renderChannelsManage(el);
            } catch (err) { alert('Delete all failed: ' + err.message); }
        }
    });

    el.querySelector('#add-channel-btn').addEventListener('click', () => this.showChannelEditor());
    el.querySelectorAll('[data-action="edit-channel"]').forEach(btn => btn.addEventListener('click', () => this.showChannelEditor(parseInt(btn.dataset.id))));
    el.querySelectorAll('[data-action="test-channel"]').forEach(btn => btn.addEventListener('click', () => this.openPlayer(parseInt(btn.dataset.id))));
    el.querySelectorAll('[data-action="fav-channel"]').forEach(btn => btn.addEventListener('click', async () => {
        await this.put(`/api/channels/${btn.dataset.id}/favorite`, {});
        this.renderChannelsManage(el);
    }));
    el.querySelectorAll('[data-action="toggle-channel"]').forEach(btn => btn.addEventListener('click', async () => {
        await this.put(`/api/channels/${btn.dataset.id}/enabled`, {});
        this.renderChannelsManage(el);
    }));
    el.querySelectorAll('[data-action="delete-channel"]').forEach(btn => btn.addEventListener('click', async () => {
        if (confirm('Delete channel?')) {
            await this.del(`/api/channels/${btn.dataset.id}`);
            this.renderChannelsManage(el);
        }
    }));

    const filterInput = el.querySelector('#channel-filter');
    filterInput.addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase();
        el.querySelectorAll('.manage-card').forEach(card => {
            card.style.display = card.textContent.toLowerCase().includes(q) ? '' : 'none';
        });
    });
};

FluxTV.showChannelEditor = async function(channelId = null) {
    const channel = channelId ? await this.get(`/api/channels/${channelId}`) : {
        name: '', group_id: null, embed_url: '', logo_url: '', logo_assignment_mode: 'manual', description: '', enabled: true, favorite: false, sort_order: 0, epg_assignment_mode: 'unassigned',
    };
    const groups = await this.get('/api/groups');
    const modal = document.getElementById('modal-root');
    modal.hidden = false;
    modal.innerHTML = `<div class="modal-content">
        <h2>${channelId ? 'Edit Channel' : 'Add Channel'}</h2>
        <div class="form-group"><label>Name</label><input id="f-name" value="${this.escape(channel.name)}" /></div>
        <div class="form-group"><label>Group</label><select id="f-group">
            <option value="">None</option>
            ${groups.map(g => `<option value="${g.id}" ${channel.group_id === g.id ? 'selected' : ''}>${this.escape(g.name)}</option>`).join('')}
        </select></div>
        <div class="form-group"><label>Embed URL</label><input id="f-embed" value="${this.escape(channel.embed_url || '')}" placeholder="https://..." /></div>
        <div class="form-group"><label>Logo URL</label><input id="f-logo" value="${this.escape(channel.logo_url || '')}" placeholder="https://..." /></div>
        <div class="form-row">
            <div class="form-group"><label>Logo Assignment</label><select id="f-logo-mode">
                <option value="manual" ${channel.logo_assignment_mode === 'manual' ? 'selected' : ''}>Manual</option>
                <option value="automatic" ${channel.logo_assignment_mode === 'automatic' ? 'selected' : ''}>Automatic</option>
                <option value="none" ${channel.logo_assignment_mode === 'none' ? 'selected' : ''}>None</option>
            </select></div>
            <div class="form-group"><label>EPG Assignment</label><select id="f-epg-mode">
                <option value="unassigned" ${channel.epg_assignment_mode === 'unassigned' ? 'selected' : ''}>Unassigned</option>
                <option value="automatic" ${channel.epg_assignment_mode === 'automatic' ? 'selected' : ''}>Automatic</option>
                <option value="manual" ${channel.epg_assignment_mode === 'manual' ? 'selected' : ''}>Manual</option>
            </select></div>
        </div>
        <div class="form-group"><label>Description</label><textarea id="f-desc">${this.escape(channel.description || '')}</textarea></div>
        <div class="form-row">
            <div class="form-group"><label>Enabled</label><input type="checkbox" id="f-enabled" ${channel.enabled !== false ? 'checked' : ''} /></div>
            <div class="form-group"><label>Favorite</label><input type="checkbox" id="f-fav" ${channel.favorite ? 'checked' : ''} /></div>
            <div class="form-group"><label>Sort Order</label><input type="number" id="f-sort" value="${channel.sort_order || 0}" /></div>
        </div>
        <div style="display:flex;gap:1rem;margin-top:1rem;">
            <button class="btn btn-primary" id="save-channel">Save</button>
            <button class="btn" id="cancel-channel">Cancel</button>
        </div>
    </div>`;
    document.getElementById('cancel-channel').addEventListener('click', () => { modal.hidden = true; });
    document.getElementById('save-channel').addEventListener('click', async () => {
        const payload = {
            name: document.getElementById('f-name').value,
            group_id: document.getElementById('f-group').value ? parseInt(document.getElementById('f-group').value) : null,
            embed_url: document.getElementById('f-embed').value,
            logo_url: document.getElementById('f-logo').value,
            logo_assignment_mode: document.getElementById('f-logo-mode').value,
            epg_assignment_mode: document.getElementById('f-epg-mode').value,
            description: document.getElementById('f-desc').value,
            enabled: document.getElementById('f-enabled').checked,
            favorite: document.getElementById('f-fav').checked,
            sort_order: parseInt(document.getElementById('f-sort').value) || 0,
        };
        if (channelId) await this.put(`/api/channels/${channelId}`, payload);
        else await this.post('/api/channels', payload);
        modal.hidden = true;
        this.showView('manage', { sub: 'channels' });
    });
};

// ========== Groups Management (Cards) ==========
FluxTV.renderGroupsManage = async function(el) {
    const groups = await this.get('/api/groups');
    el.innerHTML = `
        <div style="margin-bottom:1.5rem;"><button class="btn btn-primary" id="add-group-btn">+ Add Group</button></div>
        <div class="manage-grid">
            ${groups.map(g => `
                <div class="manage-card">
                    <div class="manage-card-info" style="padding:0;">
                        <div class="manage-card-title">${this.escape(g.name)}</div>
                        <div class="manage-card-meta">Channels: ${g.channels_count || '0'} | Sort: ${g.sort_order}</div>
                    </div>
                    <div class="manage-card-actions">
                        <button class="btn btn-sm" data-action="edit-group" data-id="${g.id}">Edit</button>
                        <button class="btn btn-sm btn-danger" data-action="delete-group" data-id="${g.id}">Delete</button>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
    el.querySelector('#add-group-btn').addEventListener('click', () => this.showGroupEditor());
    el.querySelectorAll('[data-action="edit-group"]').forEach(btn => btn.addEventListener('click', () => this.showGroupEditor(parseInt(btn.dataset.id))));
    el.querySelectorAll('[data-action="delete-group"]').forEach(btn => btn.addEventListener('click', async () => {
        try { await this.del(`/api/groups/${btn.dataset.id}`); this.renderGroupsManage(el); }
        catch (err) { alert(err.message); }
    }));
};

FluxTV.showGroupEditor = async function(groupId = null) {
    const group = groupId ? await this.get(`/api/groups/${groupId}`) : { name: '', sort_order: 0 };
    const modal = document.getElementById('modal-root');
    modal.hidden = false;
    modal.innerHTML = `<div class="modal-content">
        <h2>${groupId ? 'Edit Group' : 'Add Group'}</h2>
        <div class="form-group"><label>Name</label><input id="g-name" value="${this.escape(group.name)}" /></div>
        <div class="form-group"><label>Sort Order</label><input type="number" id="g-sort" value="${group.sort_order || 0}" /></div>
        <div style="display:flex;gap:1rem;margin-top:1rem;">
            <button class="btn btn-primary" id="save-group">Save</button>
            <button class="btn" id="cancel-group">Cancel</button>
        </div>
    </div>`;
    document.getElementById('cancel-group').addEventListener('click', () => { modal.hidden = true; });
    document.getElementById('save-group').addEventListener('click', async () => {
        const payload = { name: document.getElementById('g-name').value, sort_order: parseInt(document.getElementById('g-sort').value) || 0 };
        if (groupId) await this.put(`/api/groups/${groupId}`, payload);
        else await this.post('/api/groups', payload);
        modal.hidden = true;
        this.showView('manage', { sub: 'groups' });
    });
};

// ========== Logos Management (Cards) ==========
FluxTV.renderLogosManage = async function(el) {
    const [sources, suggestions] = await Promise.all([this.get('/api/logos/sources'), this.get('/api/logos/suggestions')]);
    el.innerHTML = `
        <h3 class="section-title">Logo Sources</h3>
        <div style="margin-bottom:1.5rem; display:flex; gap:0.5rem; flex-wrap:wrap;">
            <button class="btn btn-primary" id="add-logo-source-btn">+ Add Source</button>
            <button class="btn btn-primary" id="upload-logo-source-btn">Upload JSON</button>
            <button class="btn" id="run-logo-automatch-btn">Run Auto-Match</button>
            <button class="btn" id="force-match-logos-btn">Force Match Missing</button>
            <button class="btn" id="force-replace-logos-btn" style="color:var(--danger);">Force Replace All</button>
            <button class="btn" id="check-logos-btn">Check Logos</button>
            <button class="btn" id="clear-auto-logos-btn" style="color:var(--danger);">Clear Auto Logos</button>
        </div>
        <div id="logo-check-results" style="display:none; margin-bottom:1rem;"></div>
        
        <div class="manage-grid">
            ${sources.map(s => `
                <div class="manage-card">
                    <div class="manage-card-info" style="padding:0;">
                        <div class="manage-card-title">${this.escape(s.name)}</div>
                        <div class="manage-card-meta">${s.source_type} | Priority: ${s.priority} | ${s.enabled ? 'Enabled' : 'Disabled'}</div>
                        <div class="manage-card-meta url-text">${s.url ? this.escape(s.url) : 'No URL'}</div>
                    </div>
                    <div class="manage-card-actions">
                        <button class="btn btn-sm" data-action="edit-logo-source" data-id="${s.id}">Edit</button>
                        <button class="btn btn-sm" data-action="refresh-logo-source" data-id="${s.id}">Refresh</button>
                        <button class="btn btn-sm btn-danger" data-action="delete-logo-source" data-id="${s.id}">Delete</button>
                    </div>
                </div>
            `).join('')}
        </div>

        <h3 class="section-title" style="margin-top:2rem;">Logo Suggestions</h3>
        ${suggestions.length ? `
            <div class="manage-grid">
                ${suggestions.map(s => `
                    <div class="manage-card">
                        <div class="manage-card-top">
                            <div class="manage-card-logo-preview"><img src="${s.logo_url}" onerror="this.style.display='none'" /></div>
                            <div class="manage-card-info">
                                <div class="manage-card-title">Channel #${s.channel_id}</div>
                                <div class="manage-card-meta">${s.confidence}% confidence</div>
                            </div>
                        </div>
                        <div class="manage-card-actions">
                            <button class="btn btn-sm btn-primary" data-action="accept-logo" data-id="${s.id}">Accept</button>
                            <button class="btn btn-sm" data-action="reject-logo" data-id="${s.id}">Reject</button>
                        </div>
                    </div>
                `).join('')}
            </div>
        ` : '<div class="empty-state">No pending logo suggestions.</div>'}
    `;

    el.querySelector('#add-logo-source-btn').addEventListener('click', () => this.showLogoSourceEditor());
    el.querySelector('#upload-logo-source-btn').addEventListener('click', () => this.showLogoUploadModal());
    el.querySelector('#run-logo-automatch-btn').addEventListener('click', async () => {
        const btn = el.querySelector('#run-logo-automatch-btn');
        btn.textContent = 'Running...'; btn.disabled = true;
        try { await this.post('/api/logos/automatch', {}); this.toast('Auto-match completed', 'success'); }
        catch (err) { this.toast('Auto-match failed: ' + err.message, 'error'); }
        finally { btn.textContent = 'Run Auto-Match'; btn.disabled = false; this.renderLogosManage(el); }
    });
    el.querySelector('#force-match-logos-btn').addEventListener('click', async () => {
        if (!confirm('Assign the best available logo to channels without one?')) return;
        const btn = el.querySelector('#force-match-logos-btn');
        btn.textContent = 'Matching...'; btn.disabled = true;
        try { const result = await this.post('/api/logos/force-match?replace=false', {}); this.toast(`Assigned ${result.assigned} logos`, 'success'); }
        catch (err) { this.toast('Force match failed: ' + err.message, 'error'); }
        finally { btn.textContent = 'Force Match Missing'; btn.disabled = false; this.renderLogosManage(el); }
    });
    el.querySelector('#force-replace-logos-btn').addEventListener('click', async () => {
        if (!confirm('Replace ALL logos (including manual) with best available matches?')) return;
        const btn = el.querySelector('#force-replace-logos-btn');
        btn.textContent = 'Replacing...'; btn.disabled = true;
        try { const result = await this.post('/api/logos/force-match?replace=true', {}); this.toast(`Reassigned ${result.assigned} logos`, 'success'); }
        catch (err) { this.toast('Force replace failed: ' + err.message, 'error'); }
        finally { btn.textContent = 'Force Replace All'; btn.disabled = false; this.renderLogosManage(el); }
    });
    el.querySelector('#check-logos-btn').addEventListener('click', async () => {
        const btn = el.querySelector('#check-logos-btn');
        const resultsDiv = el.querySelector('#logo-check-results');
        btn.textContent = 'Checking...'; btn.disabled = true;
        try {
            const result = await this.get('/api/logos/check');
            resultsDiv.style.display = 'block';
            if (result.count === 0) resultsDiv.innerHTML = '<div class="empty-state"><p>All logo URLs are working.</p></div>';
            else {
                resultsDiv.innerHTML = `<h3>Broken Logos (${result.count})</h3><div class="manage-grid">
                    ${result.broken.map(b => `
                        <div class="manage-card">
                            <div class="manage-card-info" style="padding:0;">
                                <div class="manage-card-title">${this.escape(b.name)}</div>
                                <div class="manage-card-meta">${b.status}</div>
                                <div class="manage-card-meta url-text">${this.escape(b.logo_url)}</div>
                            </div>
                            <div class="manage-card-actions"><button class="btn btn-sm" data-action="assign-logo" data-channel-id="${b.channel_id}">Assign Logo</button></div>
                        </div>
                    `).join('')}
                </div>`;
                resultsDiv.querySelectorAll('[data-action="assign-logo"]').forEach(assignBtn => assignBtn.addEventListener('click', () => this.showLogoAssignModal(parseInt(assignBtn.dataset.channelId))));
            }
        } catch (err) { resultsDiv.innerHTML = `<p>Error checking logos: ${err.message}</p>`; }
        finally { btn.textContent = 'Check Logos'; btn.disabled = false; }
    });
    el.querySelector('#clear-auto-logos-btn').addEventListener('click', async () => {
        if (!confirm('Clear all automatically assigned logos? Manual logos will remain.')) return;
        const btn = el.querySelector('#clear-auto-logos-btn');
        btn.textContent = 'Clearing...'; btn.disabled = true;
        try { const result = await this.post('/api/logos/clear-auto', {}); this.toast(`Cleared ${result.cleared} logo(s)`, 'success'); }
        catch (err) { this.toast('Failed to clear logos: ' + err.message, 'error'); }
        finally { btn.textContent = 'Clear Auto Logos'; btn.disabled = false; this.renderLogosManage(el); }
    });
    el.querySelectorAll('[data-action="edit-logo-source"]').forEach(btn => btn.addEventListener('click', () => this.showLogoSourceEditor(parseInt(btn.dataset.id))));
    el.querySelectorAll('[data-action="refresh-logo-source"]').forEach(btn => btn.addEventListener('click', async () => {
        const id = btn.dataset.id; btn.textContent = 'Refreshing...'; btn.disabled = true;
        try { await this.post(`/api/logos/sources/${id}/refresh`, {}); this.toast('Logo source refreshed', 'success'); }
        catch (err) { this.toast('Refresh failed: ' + err.message, 'error'); }
        finally { btn.textContent = 'Refresh'; btn.disabled = false; this.renderLogosManage(el); }
    }));
    el.querySelectorAll('[data-action="delete-logo-source"]').forEach(btn => btn.addEventListener('click', async () => {
        if (confirm('Delete logo source?')) {
            try { await this.del(`/api/logos/sources/${btn.dataset.id}`); this.toast('Logo source deleted', 'info'); this.renderLogosManage(el); }
            catch (err) { this.toast('Delete failed: ' + err.message, 'error'); }
        }
    }));
    el.querySelectorAll('[data-action="accept-logo"]').forEach(btn => btn.addEventListener('click', async () => {
        await this.post(`/api/logos/suggestions/${btn.dataset.id}/accept`, {}); this.toast('Logo assigned', 'success'); this.renderLogosManage(el);
    }));
    el.querySelectorAll('[data-action="reject-logo"]').forEach(btn => btn.addEventListener('click', async () => {
        await this.post(`/api/logos/suggestions/${btn.dataset.id}/reject`, {}); this.toast('Suggestion rejected', 'info'); this.renderLogosManage(el);
    }));
};

FluxTV.showLogoUploadModal = function() {
    const modal = document.getElementById('modal-root');
    modal.hidden = false;
    modal.innerHTML = `<div class="modal-content">
        <h2>Upload Logo Source JSON</h2>
        <div class="form-group"><label>Source Name</label><input id="upload-source-name" placeholder="My Logo Source" /></div>
        <div class="form-group"><label>JSON File</label><input type="file" id="upload-source-file" accept=".json" /></div>
        <div style="display:flex;gap:1rem;margin-top:1rem;">
            <button class="btn btn-primary" id="do-upload-source">Upload</button>
            <button class="btn" id="cancel-upload-source">Cancel</button>
        </div>
    </div>`;
    document.getElementById('cancel-upload-source').addEventListener('click', () => { modal.hidden = true; });
    document.getElementById('do-upload-source').addEventListener('click', async () => {
        const fileInput = document.getElementById('upload-source-file');
        const nameInput = document.getElementById('upload-source-name');
        if (!fileInput.files.length) { alert('Select a JSON file'); return; }
        const name = nameInput.value.trim() || fileInput.files[0].name.replace('.json', '');
        const formData = new FormData();
        formData.append('file', fileInput.files[0]);
        formData.append('name', name);
        try {
            await fetch(`${FluxTV.API_BASE}/api/logos/upload-source`, { method: 'POST', body: formData });
            modal.hidden = true;
            this.toast('Logo source uploaded', 'success');
            this.showView('manage', { sub: 'logos' });
        } catch (err) { alert('Upload failed: ' + err.message); }
    });
};

FluxTV.showLogoSourceEditor = async function(sourceId = null) {
    let source = { name: '', source_type: 'json_map', url: '', priority: 0, enabled: true };
    if (sourceId) {
        try { source = await this.get(`/api/logos/sources/${sourceId}`); } catch (err) { this.toast('Error loading source: ' + err.message, 'error'); return; }
    }
    const modal = document.getElementById('modal-root');
    modal.hidden = false;
    modal.innerHTML = `<div class="modal-content">
        <h2>${sourceId ? 'Edit Logo Source' : 'Add Logo Source'}</h2>
        <div class="form-group"><label>Name</label><input id="ls-name" value="${this.escape(source.name)}" /></div>
        <div class="form-group"><label>Type</label><select id="ls-type">
            <option value="json_map" ${source.source_type === 'json_map' ? 'selected' : ''}>json_map (remote JSON)</option>
            <option value="local_file" ${source.source_type === 'local_file' ? 'selected' : ''}>local_file (uploaded JSON)</option>
            <option value="github_dir" ${source.source_type === 'github_dir' ? 'selected' : ''}>github_dir (GitHub folder)</option>
        </select></div>
        <div class="form-group"><label>URL / Path</label><input id="ls-url" value="${this.escape(source.url || '')}" placeholder="https://example.com/logos.json, local path, or GitHub tree URL" /></div>
        <div class="form-group"><label>Priority</label><input type="number" id="ls-priority" value="${source.priority || 0}" /></div>
        <div class="form-group"><label>Enabled</label><input type="checkbox" id="ls-enabled" ${source.enabled ? 'checked' : ''} /></div>
        <div style="display:flex;gap:1rem;margin-top:1rem;">
            <button class="btn btn-primary" id="save-ls">Save</button>
            <button class="btn" id="cancel-ls">Cancel</button>
        </div>
    </div>`;
    document.getElementById('cancel-ls').addEventListener('click', () => { modal.hidden = true; });
    document.getElementById('save-ls').addEventListener('click', async () => {
        const payload = {
            name: document.getElementById('ls-name').value,
            source_type: document.getElementById('ls-type').value,
            url: document.getElementById('ls-url').value,
            priority: parseInt(document.getElementById('ls-priority').value) || 0,
            enabled: document.getElementById('ls-enabled').checked,
        };
        try {
            if (sourceId) await this.put(`/api/logos/sources/${sourceId}`, payload);
            else await this.post('/api/logos/sources', payload);
            this.toast('Source saved', 'success');
            modal.hidden = true;
            this.showView('manage', { sub: 'logos' });
        } catch (err) { this.toast('Save failed: ' + err.message, 'error'); }
    });
};

// ========== EPG Sources Management (Cards) ==========
FluxTV.renderEPGSourcesManage = async function(el) {
    const sources = await this.get('/api/epg/sources');
    el.innerHTML = `
        <div style="margin-bottom:1.5rem;"><button class="btn btn-primary" id="add-epg-source-btn">+ Add EPG Source</button></div>
        <div class="manage-grid">
            ${sources.map(s => `
                <div class="manage-card">
                    <div class="manage-card-info" style="padding:0;">
                        <div class="manage-card-title">${this.escape(s.name)}</div>
                        <div class="manage-card-meta">${this.escape(s.timezone || 'UTC')} | Priority: ${s.priority} | ${s.enabled ? 'Enabled' : 'Disabled'}</div>
                        <div class="manage-card-meta">Interval: ${this.escape(s.update_interval)} | Status: ${s.last_error ? 'Error: ' + this.escape(s.last_error) : 'OK'}</div>
                        <div class="manage-card-meta url-text">${this.escape(s.url)}</div>
                    </div>
                    <div class="manage-card-actions">
                        <button class="btn btn-sm" data-action="edit-epg-source" data-id="${s.id}">Edit</button>
                        <button class="btn btn-sm" data-action="test-epg-source" data-id="${s.id}">Test</button>
                        <button class="btn btn-sm" data-action="refresh-epg-source" data-id="${s.id}">Refresh</button>
                        <button class="btn btn-sm btn-danger" data-action="delete-epg-source" data-id="${s.id}">Delete</button>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
    el.querySelector('#add-epg-source-btn').addEventListener('click', () => this.showEPGSourceEditor());
    el.querySelectorAll('[data-action="edit-epg-source"]').forEach(btn => btn.addEventListener('click', () => this.showEPGSourceEditor(parseInt(btn.dataset.id))));
    el.querySelectorAll('[data-action="test-epg-source"]').forEach(btn => btn.addEventListener('click', async () => {
        const result = await this.post(`/api/epg/sources/${btn.dataset.id}/test`, {});
        this.toast(result.message, result.ok ? 'success' : 'error');
    }));
    el.querySelectorAll('[data-action="refresh-epg-source"]').forEach(btn => btn.addEventListener('click', async () => {
        const id = btn.dataset.id; btn.textContent = 'Refreshing...'; btn.disabled = true;
        try { await this.post(`/api/epg/sources/${id}/refresh`, {}); this.toast('EPG source refreshed', 'success'); }
        catch (err) { this.toast('Refresh failed: ' + err.message, 'error'); }
        finally { btn.textContent = 'Refresh'; btn.disabled = false; this.renderEPGSourcesManage(el); }
    }));
    el.querySelectorAll('[data-action="delete-epg-source"]').forEach(btn => btn.addEventListener('click', async () => {
        if (confirm('Delete EPG source? This will also delete all EPG data from this source.')) {
            try { await this.del(`/api/epg/sources/${btn.dataset.id}`); this.toast('EPG source deleted', 'info'); this.renderEPGSourcesManage(el); }
            catch (err) { this.toast('Delete failed: ' + err.message, 'error'); }
        }
    }));
};

FluxTV.showEPGSourceEditor = async function(sourceId = null) {
    let source = { name: '', url: '', priority: 0, update_interval: 'every_24_hours', enabled: true, timezone: 'UTC' };
    if (sourceId) {
        try { source = await this.get(`/api/epg/sources/${sourceId}`); } catch (err) { this.toast('Error loading source: ' + err.message, 'error'); return; }
    }
    const timezoneOptionsList = ['UTC', 'UTC-12', 'UTC-11', 'UTC-10', 'UTC-9', 'UTC-8', 'UTC-7', 'UTC-6', 'UTC-5', 'UTC-4', 'UTC-3', 'UTC-2', 'UTC-1', 'UTC+1', 'UTC+2', 'UTC+3', 'UTC+4', 'UTC+5', 'UTC+6', 'UTC+7', 'UTC+8', 'UTC+9', 'UTC+10', 'UTC+11', 'UTC+12', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Phoenix', 'America/Toronto', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Asia/Tokyo', 'Australia/Sydney', 'Pacific/Auckland', 'Africa/Johannesburg', 'America/Sao_Paulo', 'America/Mexico_City'];
    const timezoneOptions = timezoneOptionsList.map(tz => `<option value="${tz}" ${source.timezone === tz ? 'selected' : ''}>${tz}</option>`).join('');
    const modal = document.getElementById('modal-root');
    modal.hidden = false;
    modal.innerHTML = `<div class="modal-content">
        <h2>${sourceId ? 'Edit EPG Source' : 'Add EPG Source'}</h2>
        <div class="form-group"><label>Name</label><input id="es-name" value="${this.escape(source.name)}" /></div>
        <div class="form-group"><label>URL</label><input id="es-url" value="${this.escape(source.url || '')}" placeholder="https://example.com/epg.xml" /></div>
        <div class="form-group"><label>Timezone / Offset</label><select id="es-timezone">${timezoneOptions}</select></div>
        <div class="form-group"><label>Priority</label><input type="number" id="es-priority" value="${source.priority || 0}" /></div>
        <div class="form-group"><label>Update Interval</label><select id="es-interval">
            <option value="every_24_hours" ${source.update_interval === 'every_24_hours' ? 'selected' : ''}>Every 24 hours</option>
            <option value="every_12_hours" ${source.update_interval === 'every_12_hours' ? 'selected' : ''}>Every 12 hours</option>
            <option value="every_6_hours" ${source.update_interval === 'every_6_hours' ? 'selected' : ''}>Every 6 hours</option>
            <option value="every_hour" ${source.update_interval === 'every_hour' ? 'selected' : ''}>Every hour</option>
            <option value="every_30_minutes" ${source.update_interval === 'every_30_minutes' ? 'selected' : ''}>Every 30 minutes</option>
            <option value="every_15_minutes" ${source.update_interval === 'every_15_minutes' ? 'selected' : ''}>Every 15 minutes</option>
            <option value="manual_only" ${source.update_interval === 'manual_only' ? 'selected' : ''}>Manual only</option>
        </select></div>
        <div class="form-group"><label>Enabled</label><input type="checkbox" id="es-enabled" ${source.enabled !== false ? 'checked' : ''} /></div>
        <div style="display:flex;gap:1rem;margin-top:1rem;"><button class="btn btn-primary" id="save-es">Save</button><button class="btn" id="cancel-es">Cancel</button></div>
    </div>`;
    document.getElementById('cancel-es').addEventListener('click', () => { modal.hidden = true; });
    document.getElementById('save-es').addEventListener('click', async () => {
        const payload = {
            name: document.getElementById('es-name').value, url: document.getElementById('es-url').value,
            timezone: document.getElementById('es-timezone').value, priority: parseInt(document.getElementById('es-priority').value) || 0,
            update_interval: document.getElementById('es-interval').value, enabled: document.getElementById('es-enabled').checked,
        };
        try {
            if (sourceId) await this.put(`/api/epg/sources/${sourceId}`, payload);
            else await this.post('/api/epg/sources', payload);
            this.toast('EPG source saved', 'success');
            modal.hidden = true;
            this.showView('manage', { sub: 'epg' });
        } catch (err) { this.toast('Save failed: ' + err.message, 'error'); }
    });
};

// ========== EPG Mapping Management (Cards with Logos & Manual Assign) ==========
FluxTV.renderEPGMappingManage = async function(el) {
    const [mappings, channels] = await Promise.all([
        this.get('/api/epg/mappings'),
        this.get('/api/channels')
    ]);

    const channelMap = {};
    channels.forEach(ch => channelMap[ch.id] = ch);

    el.innerHTML = `
        <h3 class="section-title">EPG Mappings</h3>
        <div class="manage-grid">
            ${mappings.map(m => {
                const ch = channelMap[m.channel_id];
                const channelName = ch ? ch.name : `Channel #${m.channel_id}`;
                const channelLogo = ch && ch.logo_url ? ch.logo_url : null;
                
                return `
                    <div class="manage-card">
                        <div class="manage-card-top">
                            <div class="manage-card-logo-preview">
                                ${channelLogo ? `<img src="${channelLogo}" onerror="this.outerHTML='<span class=logo-fallback>${this.escape(channelName.substring(0,2))}</span>'" />` : `<span class="logo-fallback">${this.escape(channelName.substring(0,2))}</span>`}
                            </div>
                            <div class="manage-card-info">
                                <div class="manage-card-title">${this.escape(channelName)}</div>
                                <div class="manage-card-meta">Mapped to: ${m.epg_channel_id}</div>
                                <div class="manage-card-meta">Mode: ${m.assignment_mode} | Conf: ${m.confidence || 'N/A'}%</div>
                            </div>
                        </div>
                        <div class="manage-card-actions">
                            <button class="btn btn-sm btn-primary" data-action="edit-epg-mapping" 
                                data-id="${m.id}" data-channel-id="${m.channel_id}" 
                                data-epg-id="${m.epg_channel_id}" data-mode="${m.assignment_mode}">Manual Assign</button>
                            ${m.assignment_mode === 'suggested' ? `
                            <button class="btn btn-sm" data-action="accept-epg" data-id="${m.id}">Accept</button>
                            <button class="btn btn-sm" data-action="reject-epg" data-id="${m.id}">Reject</button>` : ''}
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
        <button class="btn" id="automap-btn" style="margin-top:1rem;">Run Auto-Mapping</button>
    `;

    el.querySelector('#automap-btn').addEventListener('click', async () => {
        const btn = el.querySelector('#automap-btn');
        btn.textContent = 'Running...'; btn.disabled = true;
        try { await this.post('/api/epg/automap', {}); this.toast('Auto-mapping completed', 'success'); }
        catch (err) { this.toast('Auto-mapping failed: ' + err.message, 'error'); }
        finally { btn.textContent = 'Run Auto-Mapping'; btn.disabled = false; this.renderEPGMappingManage(el); }
    });

    el.querySelectorAll('[data-action="edit-epg-mapping"]').forEach(btn => btn.addEventListener('click', () => {
        this.showEPGMappingEditor(
            parseInt(btn.dataset.id),
            parseInt(btn.dataset.channelId),
            btn.dataset.epgId,
            btn.dataset.mode
        );
    }));

    el.querySelectorAll('[data-action="accept-epg"]').forEach(btn => btn.addEventListener('click', async () => {
        await this.post(`/api/epg/mappings/${btn.dataset.id}/accept`, {}); this.toast('Mapping accepted', 'success'); this.renderEPGMappingManage(el);
    }));

    el.querySelectorAll('[data-action="reject-epg"]').forEach(btn => btn.addEventListener('click', async () => {
        await this.post(`/api/epg/mappings/${btn.dataset.id}/reject`, {}); this.toast('Mapping rejected', 'info'); this.renderEPGMappingManage(el);
    }));
};

// NEW: Manual EPG Mapping Editor Modal (Search by Name via Backend)
FluxTV.showEPGMappingEditor = async function(mappingId, channelId, currentEpgId, currentMode) {
    const channel = await this.get(`/api/channels/${channelId}`);
    
    const modal = document.getElementById('modal-root');
    modal.hidden = false;
    
    modal.innerHTML = `<div class="modal-content">
        <h2>Manual EPG Assignment</h2>
        <div class="form-group">
            <label>Channel</label>
            <div style="display:flex; align-items:center; gap:1rem; padding:0.8rem; background:var(--card); border-radius:var(--radius-sm);">
                ${channel.logo_url ? `<img src="${channel.logo_url}" style="height:30px; max-width:60px; object-fit:contain;" />` : ''}
                <strong>${this.escape(channel.name)}</strong>
            </div>
        </div>
        
        <div class="form-group">
            <label>Search EPG by Name (All Sources)</label>
            <input type="text" id="epg-search-input" placeholder="Type to search..." autocomplete="off" />
            <div id="epg-search-results" style="max-height:200px; overflow-y:auto; border:1px solid var(--border); border-radius:var(--radius-sm); margin-top:0.5rem;"></div>
        </div>

        <div class="form-group">
            <label>Selected EPG Channel ID</label>
            <input id="epg-channel-id" value="${this.escape(currentEpgId || '')}" placeholder="Select from search or type manually" />
        </div>

        <div class="form-group">
            <label>Assignment Mode</label>
            <select id="epg-mode">
                <option value="manual" ${currentMode === 'manual' ? 'selected' : ''}>Manual</option>
                <option value="automatic" ${currentMode === 'automatic' ? 'selected' : ''}>Automatic</option>
                <option value="unassigned" ${currentMode === 'unassigned' ? 'selected' : ''}>Unassigned</option>
            </select>
        </div>
        <div style="display:flex;gap:1rem;margin-top:1rem;">
            <button class="btn btn-primary" id="save-epg-mapping">Save Mapping</button>
            <button class="btn" id="cancel-epg-mapping">Cancel</button>
        </div>
    </div>`;

    document.getElementById('cancel-epg-mapping').addEventListener('click', () => { modal.hidden = true; });

    const searchInput = document.getElementById('epg-search-input');
    const resultsDiv = document.getElementById('epg-search-results');
    const epgIdInput = document.getElementById('epg-channel-id');
    
    let searchTimer;
    searchInput.addEventListener('input', () => {
        const query = searchInput.value.trim();
        resultsDiv.innerHTML = '';
        clearTimeout(searchTimer);

        if (query.length < 2) return;

        searchTimer = setTimeout(async () => {
            try {
                const response = await fetch(`${FluxTV.API_BASE}/api/epg/channels?search=${encodeURIComponent(query)}`);
                const epgChannels = await response.json();

                if (epgChannels.length === 0) {
                    resultsDiv.innerHTML = '<p style="padding:0.5rem; color:var(--text-secondary); font-size:0.9rem;">No EPG channels found.</p>';
                    return;
                }

                epgChannels.slice(0, 20).forEach(ch => {
                    const name = ch.display_name || `ID: ${ch.id}`;
                    const el = document.createElement('div');
                    el.style.cssText = 'padding:0.6rem; cursor:pointer; border-bottom:1px solid var(--border); transition: background 0.2s;';
                    el.textContent = name;
                    el.addEventListener('mouseenter', () => { el.style.background = 'var(--card-hover)'; });
                    el.addEventListener('mouseleave', () => { el.style.background = 'transparent'; });
                    el.addEventListener('click', () => {
                        epgIdInput.value = ch.id;
                        searchInput.value = name;
                        resultsDiv.innerHTML = '';
                    });
                    resultsDiv.appendChild(el);
                });
            } catch (err) {
                console.error(err);
                resultsDiv.innerHTML = '<p style="padding:0.5rem; color:var(--danger); font-size:0.9rem;">Error fetching EPG channels.</p>';
            }
        }, 300);
    });

    document.getElementById('save-epg-mapping').addEventListener('click', async () => {
        const payload = {
            epg_channel_id: document.getElementById('epg-channel-id').value,
            assignment_mode: document.getElementById('epg-mode').value
        };
        
        try {
            await this.put(`/api/epg/mappings/${mappingId}`, payload);
            this.toast('EPG mapping saved', 'success');
            modal.hidden = true;
            this.renderEPGMappingManage(document.getElementById('manage-content'));
        } catch (err) {
            this.toast('Save failed: ' + err.message, 'error');
        }
    });
};

// ========== Import (Card) ==========
FluxTV.renderImportManage = async function(el) {
    el.innerHTML = `
        <h3 class="section-title">Bulk Channel Import</h3>
        <div class="manage-card" style="padding:1.5rem; display:block;">
            <div class="form-group"><label>CSV or JSON File</label><input type="file" id="import-file" accept=".csv,.json" /></div>
            <div class="form-group"><label>Duplicate Mode</label><select id="duplicate-mode">
                <option value="skip">Skip duplicate</option>
                <option value="update">Update existing</option>
                <option value="import_new">Import as new</option>
            </select></div>
            <button class="btn btn-primary" id="preview-import">Preview</button>
            <div id="import-preview"></div>
        </div>
    `;
    document.getElementById('preview-import').addEventListener('click', async () => {
        const fileInput = document.getElementById('import-file');
        if (!fileInput.files.length) { alert('Select a file'); return; }
        const file = fileInput.files[0];
        const ext = file.name.split('.').pop().toLowerCase();
        const formData = new FormData();
        formData.append('file', file);
        const path = ext === 'csv' ? '/api/import/preview/csv' : '/api/import/preview/json';
        try {
            const res = await fetch(`${FluxTV.API_BASE}${path}`, { method: 'POST', body: formData });
            const data = await res.json();
            const preview = document.getElementById('import-preview');
            preview.innerHTML = `<p>Found <strong>${data.count}</strong> rows.</p><button class="btn btn-primary" id="execute-import">Execute Import</button>`;
            document.getElementById('execute-import').addEventListener('click', async () => {
                const mode = document.getElementById('duplicate-mode').value;
                const result = await FluxTV.post('/api/import/execute', { rows: data.rows, duplicate_mode: mode });
                FluxTV.toast(`Imported: ${result.imported}, Updated: ${result.updated}, Skipped: ${result.skipped}, Failed: ${result.failed}`, 'success');
                FluxTV.showView('manage', { sub: 'channels' });
            });
        } catch (err) { FluxTV.toast('Preview failed: ' + err.message, 'error'); }
    });
};

// ========== Export (Card) ==========
FluxTV.renderExportManage = async function(el) {
    el.innerHTML = `
        <h3 class="section-title">Export Channels</h3>
        <div class="manage-card" style="padding:1.5rem; display:flex; gap:1rem;">
            <button class="btn btn-primary" id="export-json">Export JSON</button>
            <button class="btn btn-primary" id="export-csv">Export CSV</button>
        </div>
    `;
    document.getElementById('export-json').addEventListener('click', async () => {
        const data = await this.get('/api/export/json');
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'fluxtv_channels.json'; a.click();
        URL.revokeObjectURL(url);
    });
    document.getElementById('export-csv').addEventListener('click', async () => {
        const data = await this.get('/api/export/csv');
        const blob = new Blob([data], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'fluxtv_channels.csv'; a.click();
        URL.revokeObjectURL(url);
    });
};

// ========== Backup & Restore (Native Download Fix) ==========
FluxTV.renderBackupManage = async function(el) {
    el.innerHTML = `
        <div class="section-header">
            <h1 class="section-title">Backup & Restore</h1>
        </div>
        <div class="manage-card" style="padding:1.5rem; margin-bottom:1rem;">
            <h3 style="margin-bottom:1rem;">Export Full Database</h3>
            <p style="color:var(--text-secondary); margin-bottom:1rem;">Download a complete JSON file containing all channels, groups, EPG data, logo sources, and settings.</p>
            <button class="btn btn-primary" id="download-backup-btn">Export Full Database Backup</button>
        </div>
        <div class="manage-card" style="padding:1.5rem;">
            <h3 style="margin-bottom:1rem;">Restore from Backup</h3>
            <p style="color:var(--text-secondary); margin-bottom:1rem;">Upload a previously exported backup JSON file. This will <strong>replace all current data</strong> in your database.</p>
            <input type="file" id="restore-backup-file" accept=".json" style="margin-bottom:1rem;" />
            <button class="btn btn-danger" id="restore-backup-btn">Restore Database</button>
        </div>
    `;

    // FIX: Uses native browser anchor download, bypasses fetch() memory hang
    document.getElementById('download-backup-btn').addEventListener('click', () => {
        const btn = document.getElementById('download-backup-btn');
        const originalText = btn.textContent;
        
        btn.disabled = true;
        btn.textContent = 'Preparing backup...';

        const link = document.createElement('a');
        link.href = `${FluxTV.API_BASE}/api/backup/export`;
        link.download = 'fluxtv_backup.json';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        setTimeout(() => {
            btn.disabled = false;
            btn.textContent = originalText;
        }, 1500);
    });

    document.getElementById('restore-backup-btn').addEventListener('click', async () => {
        const fileInput = document.getElementById('restore-backup-file');
        if (!fileInput.files.length) {
            this.toast('Please select a backup file to restore.', 'error');
            return;
        }

        if (!confirm('WARNING: This will REPLACE all of your current data (channels, groups, EPG, logos, settings) with the backup file. This cannot be undone. Are you sure?')) {
            return;
        }

        const file = fileInput.files[0];
        try {
            const text = await file.text();
            const backupData = JSON.parse(text);
            await this.post('/api/backup/import', backupData);
            
            this.toast('Backup restored successfully! Please refresh the page.', 'success');
            setTimeout(() => window.location.reload(), 1500);
        } catch (err) {
            this.toast('Restore failed: ' + err.message, 'error');
        }
    });
};

// ========== Assign Logo Modal (Supports URL) ==========
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
            
            <!-- URL Input -->
            <h3 style="margin-bottom: 0.5rem;">Or Use Custom URL</h3>
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
                        if (entryId === "0") {
                            await this.post('/api/logos/assign-custom', { channel_id: channelId, logo_url: logoUrl });
                        } else {
                            await this.post('/api/logos/assign', { channel_id: channelId, logo_entry_id: parseInt(entryId) });
                        }
                        modal.hidden = true;
                        this.toast('Logo assigned', 'success');
                        if (this.state.view === 'logos') this.showView('logos');
                    } catch (err) {
                        this.toast('Assignment failed: ' + err.message, 'error');
                    }
                };
                card.addEventListener('click', selectLogo);
                card.addEventListener('keydown', (e) => { if (e.key === 'Enter') selectLogo(); });
            });
        } catch (err) {
            resultsDiv.innerHTML = `<p>Error: ${err.message}</p>`;
        }
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
        if (!logoUrl) {
            this.toast('Please enter a logo URL', 'error');
            return;
        }
        try {
            await this.post('/api/logos/assign-custom', { channel_id: channelId, logo_url: logoUrl });
            modal.hidden = true;
            this.toast('Custom logo assigned', 'success');
            if (this.state.view === 'logos') this.showView('logos');
        } catch (err) {
            this.toast('Assignment failed: ' + err.message, 'error');
        }
    });

    searchInput.focus();
};
