// Narrative Watersheds — frontend entry point.

(function setupResize() {
    const handle = document.getElementById('resize-handle');
    if (!handle) return;

    const root = document.documentElement;
    const styles = getComputedStyle(root);
    const minWidth = parseInt(styles.getPropertyValue('--side-min'), 10) || 220;
    const maxWidth = parseInt(styles.getPropertyValue('--side-max'), 10) || 640;

    let dragging = false;

    handle.addEventListener('mousedown', (e) => {
        dragging = true;
        handle.classList.add('dragging');
        document.body.classList.add('resizing');
        e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        const newWidth = Math.min(maxWidth, Math.max(minWidth, window.innerWidth - e.clientX));
        root.style.setProperty('--side-width', `${newWidth}px`);
    });

    window.addEventListener('mouseup', () => {
        if (!dragging) return;
        dragging = false;
        handle.classList.remove('dragging');
        document.body.classList.remove('resizing');
    });
})();

(function setupDocuments() {
    const filesBtn = document.getElementById('upload-files-btn');
    const folderBtn = document.getElementById('upload-folder-btn');
    const filesInput = document.getElementById('files-input');
    const folderInput = document.getElementById('folder-input');
    const docsList = document.getElementById('docs-list');
    if (!filesBtn) return;

    filesBtn.addEventListener('click', () => filesInput.click());
    folderBtn.addEventListener('click', () => folderInput.click());

    filesInput.addEventListener('change', (e) => {
        uploadFiles(e.target.files);
        e.target.value = '';
    });
    folderInput.addEventListener('change', (e) => {
        uploadFiles(e.target.files);
        e.target.value = '';
    });

    async function uploadFiles(fileList) {
        if (!fileList || !fileList.length) return;

        showStatus(`Uploading ${fileList.length} file${fileList.length > 1 ? 's' : ''}…`);

        const formData = new FormData();
        for (const f of fileList) formData.append('files', f, f.name);

        try {
            const res = await fetch('/api/documents', { method: 'POST', body: formData });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            const addedCount = data.added.length;
            const skippedCount = data.skipped.length;
            const parts = [`Added ${addedCount}`];
            if (skippedCount) parts.push(`skipped ${skippedCount}`);
            showStatus(parts.join(', '));
        } catch (err) {
            showStatus(`Upload failed: ${err.message}`);
        }

        await refreshDocuments();
    }

    async function refreshDocuments() {
        try {
            const res = await fetch('/api/documents');
            const data = await res.json();
            renderDocuments(data.documents);
        } catch (err) {
            showStatus(`Failed to load documents: ${err.message}`);
        }
    }

    function renderDocuments(docs) {
        docsList.innerHTML = '';
        if (!docs.length) {
            const empty = document.createElement('p');
            empty.className = 'empty-state';
            empty.textContent = 'No documents yet.';
            docsList.appendChild(empty);
            return;
        }
        for (const doc of docs) {
            const item = document.createElement('div');
            item.className = 'doc-item';
            item.dataset.id = doc.id;
            item.addEventListener('click', () => openDocumentPopup(doc.id));

            const title = document.createElement('div');
            title.className = 'doc-title';
            title.textContent = doc.metadata?.title || doc.source_filename || 'Untitled';
            item.appendChild(title);

            if (doc.metadata?.author) {
                const author = document.createElement('div');
                author.className = 'doc-author';
                author.textContent = doc.metadata.author;
                item.appendChild(author);
            }
            docsList.appendChild(item);
        }
    }

    function showStatus(msg) {
        let el = document.querySelector('.upload-status');
        if (!el) {
            el = document.createElement('div');
            el.className = 'upload-status';
            docsList.parentElement.appendChild(el);
        }
        el.textContent = msg;
    }

    // ---- Document popup ----

    const popupBackdrop = document.getElementById('doc-popup-backdrop');
    const popupTitle = popupBackdrop.querySelector('.doc-popup-title');
    const popupMeta = popupBackdrop.querySelector('.doc-popup-meta');
    const popupText = popupBackdrop.querySelector('.doc-popup-text');
    const popupClose = document.getElementById('doc-popup-close');

    async function openDocumentPopup(docId) {
        try {
            const res = await fetch(`/api/documents/${docId}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const doc = await res.json();
            popupTitle.textContent = doc.metadata?.title || doc.source_filename || 'Untitled';
            const metaParts = [];
            if (doc.metadata?.author) metaParts.push(doc.metadata.author);
            if (doc.metadata?.year) metaParts.push(doc.metadata.year);
            if (doc.source_filename) metaParts.push(doc.source_filename);
            popupMeta.textContent = metaParts.join(' · ');
            popupText.textContent = doc.raw_text || '(no text extracted)';
            popupBackdrop.hidden = false;
        } catch (err) {
            showStatus(`Failed to load document: ${err.message}`);
        }
    }

    function closeDocumentPopup() {
        popupBackdrop.hidden = true;
    }

    popupClose.addEventListener('click', closeDocumentPopup);
    popupBackdrop.addEventListener('click', (e) => {
        if (e.target === popupBackdrop) closeDocumentPopup();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !popupBackdrop.hidden) closeDocumentPopup();
    });

    refreshDocuments();
})();
