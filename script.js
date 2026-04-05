// Initialize markdown renderer
const md = window.markdownit ? window.markdownit({ breaks: true, linkify: true, html: true }) : null;

document.addEventListener('DOMContentLoaded', () => {
    // Clear PDF context on every page load so new chats are always fresh
    fetch('/clear_context', { method: 'POST' }).catch(() => {});

    // Focus search input on load
    const searchInput = document.querySelector('.search-input');
    if (searchInput) {
        searchInput.focus();
    }

    // Auto-resize textarea
    if (searchInput) {
        searchInput.addEventListener('input', function() {
            this.style.height = '48px';
            this.style.height = (this.scrollHeight) + 'px';
            if(this.value.trim() === '') {
                 this.style.height = '48px';
            }
        });
        
        searchInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                const prompt = this.value.trim();
                if (prompt) {
                    submitPrompt(prompt);
                    this.value = '';
                    this.style.height = '48px';
                }
            }
        });
    }

    // Filter button active states
    const filterBtns = document.querySelectorAll('.filter-btn');
    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    // Mode button toggling logic (Sidebar version)
    const sidebarModeBtns = document.querySelectorAll('.sidebar-mode');
    let currentMode = 'search'; 
    let currentThreadId = null;

    // Load existing threads on start
    loadThreadsSidebar();

    sidebarModeBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const mode = btn.getAttribute('data-mode');
            
            // Remove active class from all modes
            sidebarModeBtns.forEach(b => b.classList.remove('mode-active'));
            btn.classList.add('mode-active');
            
            currentMode = mode;
            console.log("Mode set to:", currentMode);

            // Special logic for BizMind submenu
            const bizMenu = document.getElementById('bizmind-phases');
            if (mode === 'business') {
                if (bizMenu) bizMenu.style.display = 'flex';
            } else {
                if (bizMenu) bizMenu.style.display = 'none';
            }
        });
    });

    // Toggle BizMind submenu manually if needed
    const bizGroup = document.getElementById('bizmind-group');
    if (bizGroup) {
        const toggleBtn = bizGroup.querySelector('.toggle-icon');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const bizMenu = document.getElementById('bizmind-phases');
                if (bizMenu) {
                    bizMenu.style.display = bizMenu.style.display === 'none' ? 'flex' : 'none';
                }
            });
        }
    }

    // Sidebar active states
    const navItems = document.querySelectorAll('.nav-menu .nav-item:not(.search-box)');
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');
        });
    });

    // Model Dropdown Logic
    const modelBtn = document.getElementById('model-select-btn');
    const modelMenu = document.getElementById('model-dropdown-menu');
    const modelOptions = document.querySelectorAll('.model-option');

    if (modelBtn && modelMenu) {
        modelBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            modelMenu.style.display = modelMenu.style.display === 'none' ? 'block' : 'none';
        });

        modelOptions.forEach(opt => {
            opt.addEventListener('click', () => {
                // Keep the button text as 'Model' but indicate selection in the dropdown
                modelOptions.forEach(o => o.classList.remove('selected'));
                opt.classList.add('selected');
                modelMenu.style.display = 'none';
                console.log("Model selected:", opt.getAttribute('data-model'));
            });
        });

        document.addEventListener('click', (e) => {
            if (!modelBtn.contains(e.target) && !modelMenu.contains(e.target)) {
                modelMenu.style.display = 'none';
            }
        });
    }

    // Send Button Trigger
    const sendBtn = document.getElementById('send-trigger-btn');
    if (sendBtn && searchInput) {
        sendBtn.addEventListener('click', () => {
            const prompt = searchInput.value.trim();
            if (prompt) {
                submitPrompt(prompt);
                searchInput.value = '';
                searchInput.style.height = '48px';
            }
        });
    }

    let chatContext = [];

    // New Thread button — create thread on server and reset UI
    const newThreadBtn = document.getElementById('new-thread-btn');
    if (newThreadBtn) {
        newThreadBtn.addEventListener('click', async () => {
            await fetch('/clear_context', { method: 'POST' }).catch(() => {});
            
            // Create new thread shell
            try {
                const res = await fetch('/thread', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title: "New Chat" })
                });
                const data = await res.json();
                currentThreadId = data.id;
            } catch(e) {}

            resetUI();
            loadThreadsSidebar();
        });
    }

    function resetUI() {
        const fileBadge = document.getElementById('file-badge');
        const pdfInput = document.getElementById('pdf-input');
        if (fileBadge) fileBadge.style.display = 'none';
        if (pdfInput) pdfInput.value = '';
        
        if (chatHistory) {
            chatHistory.innerHTML = '';
            chatHistory.style.display = 'none';
        }
        if (suggestionsContainer) suggestionsContainer.style.display = 'none';
        if (logoTitle) logoTitle.style.display = '';
        
        chatContext = [];
        currentThreadId = null; // Clear active thread on new
        
        // Reset sidebar highlights
        sidebarModeBtns.forEach(b => b.classList.remove('mode-active'));
        const bizMenu = document.getElementById('bizmind-phases');
        if (bizMenu) bizMenu.style.display = 'none';
        currentMode = 'basic'; // Back to normal friendly chat

        updatePhaseUI(0);
    }

    async function loadThreadsSidebar(filter = "") {
        try {
            const res = await fetch('/threads');
            let threads = await res.json();
            const recentContainer = document.querySelector('.recent-section');
            if (!recentContainer) return;

            // Only show threads with actual history (or the current one)
            // But for sidebar, we usually show finalized chats.
            // Let's filter out "New Chat" empty ones unless they are currently active.
            threads = threads.filter(t => t.title !== "New Chat" || t.id === currentThreadId);

            // Filter by search text and prioritize
            if (filter) {
                const lowerFilter = filter.toLowerCase();
                threads = threads.filter(t => t.title.toLowerCase().includes(lowerFilter));
                // Sort to put exact/starts-with matches at the top
                threads.sort((a, b) => {
                    const aTitle = a.title.toLowerCase();
                    const bTitle = b.title.toLowerCase();
                    const aStarts = aTitle.startsWith(lowerFilter);
                    const bStarts = bTitle.startsWith(lowerFilter);
                    if (aStarts && !bStarts) return -1;
                    if (!aStarts && bStarts) return 1;
                    return 0;
                });
            }

            const title = recentContainer.querySelector('.recent-title');
            recentContainer.innerHTML = '';
            if (title) recentContainer.appendChild(title);

            if (threads.length === 0) {
                const empty = document.createElement('p');
                empty.className = 'recent-empty';
                empty.textContent = filter ? 'No matches found.' : 'Your chats will appear here.';
                recentContainer.appendChild(empty);
                return;
            }

            threads.reverse().forEach(thread => {
                const item = document.createElement('div');
                item.className = 'nav-item recent-thread';
                item.innerHTML = `
                    <i class="fa-regular fa-message"></i> 
                    <span>${thread.title}</span>
                    <div class="delete-thread-btn" title="Delete chat">
                        <i class="fa-solid fa-trash-can"></i>
                    </div>
                `;
                
                // Load thread on click
                item.addEventListener('click', (e) => {
                    if (e.target.closest('.delete-thread-btn')) return;
                    loadThread(thread.id);
                });

                // Delete thread on button click (NO CONFIRMATION)
                const delBtn = item.querySelector('.delete-thread-btn');
                delBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    // Permanently delete without asking permission
                    await fetch(`/thread/${thread.id}`, { method: 'DELETE' });
                    if (currentThreadId === thread.id) resetUI();
                    loadThreadsSidebar();
                });

                recentContainer.appendChild(item);
            });
        } catch(e) {}
    }

    // History View Toggle Logic
    const historyViewBtn = document.getElementById('history-view-btn');
    const backHomeBtn = document.getElementById('back-home-btn');
    const sidebarSearchBtn = document.getElementById('sidebar-search-btn');
    const historySearchContainer = document.querySelector('.history-search-container');
    const bizGroupContainer = document.getElementById('bizmind-group');
    const webSearchBtn = document.querySelector('.sidebar-mode[data-mode="search"]');

    if (historyViewBtn) {
        historyViewBtn.addEventListener('click', (e) => {
            e.preventDefault();
            toggleHistoryMode(true);
        });
    }

    if (sidebarSearchBtn) {
        sidebarSearchBtn.addEventListener('click', (e) => {
            e.preventDefault();
            toggleHistoryMode(true);
            if (historySearchInput) historySearchInput.focus();
        });
    }

    if (backHomeBtn) {
        backHomeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            toggleHistoryMode(false);
        });
    }

    function toggleHistoryMode(showHistory) {
        if (showHistory) {
            historyViewBtn.classList.add('mode-active');
            backHomeBtn.style.display = 'flex';
            sidebarSearchBtn.style.display = 'none';
            historySearchContainer.style.display = 'flex';
            
            // Hide search modes
            if (bizGroupContainer) bizGroupContainer.style.display = 'none';
            if (webSearchBtn) webSearchBtn.style.display = 'none';
        } else {
            historyViewBtn.classList.remove('mode-active');
            backHomeBtn.style.display = 'none';
            sidebarSearchBtn.style.display = 'flex';
            historySearchContainer.style.display = 'none';
            
            // Show search modes
            if (bizGroupContainer) bizGroupContainer.style.display = 'flex';
            if (webSearchBtn) webSearchBtn.style.display = 'flex';
        }
    }

    // History Search Filtering
    const historySearchInput = document.getElementById('history-search-input');
    if (historySearchInput) {
        historySearchInput.addEventListener('input', (e) => {
            loadThreadsSidebar(e.target.value);
        });
    }

    async function loadThread(id) {
        try {
            const res = await fetch(`/thread/${id}`);
            const data = await res.json();
            currentThreadId = id;
            
            resetUI();
            if (logoTitle) logoTitle.style.display = 'none';
            if (chatHistory) {
                chatHistory.style.display = 'flex';
                data.history.forEach(msg => {
                    appendMessage(msg.role === 'user' ? 'user' : 'bot', msg.content);
                    chatContext.push(msg);
                });
            }
        } catch(e) {}
    }

    function updatePhaseUI(phase) {
        // Clear all
        document.querySelectorAll('.sub-nav-item').forEach(item => item.classList.remove('phase-active'));
        if (phase >= 1 && phase <= 5) {
            const activeItem = document.getElementById(`phase-${phase}-ui`);
            if (activeItem) activeItem.classList.add('phase-active');
        }
    }
    
    // Chat logic
    const chatHistory = document.querySelector('.chat-history');
    const suggestionsContainer = document.querySelector('.suggestions-container');
    const logoTitle = document.querySelector('.logo-title');
    const submitBtn = document.querySelector('.dark-btn');

    // Click listener for submit button
    if (submitBtn) {
        submitBtn.addEventListener('click', () => {
            const prompt = searchInput.value.trim();
            if (prompt) {
                submitPrompt(prompt);
                searchInput.value = '';
                searchInput.style.height = '48px';
            }
        });
    }

    // Make suggestion items clickable
    const suggestionItems = document.querySelectorAll('.suggestion-item');
    suggestionItems.forEach(item => {
        item.addEventListener('click', () => {
            const text = item.querySelector('span').textContent;
            submitPrompt(text);
        });
    });

    // File Upload logic
    const pdfInput = document.getElementById('pdf-input');
    const attachBtn = document.getElementById('attach-btn');
    const fileBadge = document.getElementById('file-badge');
    const fileNameSpan = fileBadge ? fileBadge.querySelector('.file-name') : null;

    if (attachBtn && pdfInput) {
        attachBtn.addEventListener('click', () => {
            pdfInput.value = '';
            pdfInput.click();
        });
        
        pdfInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            if (fileBadge && fileNameSpan) {
                fileBadge.style.display = 'flex';
                fileNameSpan.textContent = "Processing PDF...";
                fileBadge.style.opacity = '0.7';
            }

            const formData = new FormData();
            formData.append('file', file);

            try {
                const response = await fetch('/upload', {
                    method: 'POST',
                    body: formData
                });
                const data = await response.json();

                if (data.error) {
                    alert(data.error);
                    if (fileBadge) fileBadge.style.display = 'none';
                } else {
                    const count = data.char_count.toLocaleString();
                    if (fileNameSpan) {
                        fileNameSpan.textContent = `${file.name} (${count} characters)`;
                    }
                    fileBadge.style.opacity = '1';
                }
            } catch (error) {
                alert("Failed to connect to the server for upload.");
                if (fileBadge) fileBadge.style.display = 'none';
            }
        });

        const removeBtn = document.querySelector('.remove-file');
        if (removeBtn) {
            removeBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                try {
                    const response = await fetch('/clear_context', { method: 'POST' });
                    if (response.ok) {
                        if (fileBadge) fileBadge.style.display = 'none';
                        pdfInput.value = '';
                    }
                } catch (error) {
                    console.error("Failed to clear context");
                }
            });
        }
    }

    // ─── Audio Recording Logic ───
    const micBtn = document.getElementById('mic-btn');
    let mediaRecorder;
    let audioChunks = [];
    let isRecording = false;

    if (micBtn) {
        micBtn.addEventListener('click', async () => {
            if (!isRecording) {
                try {
                    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    mediaRecorder = new MediaRecorder(stream);
                    audioChunks = [];

                    mediaRecorder.ondataavailable = (event) => {
                        audioChunks.push(event.data);
                    };

                    mediaRecorder.onstop = async () => {
                        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                        const formData = new FormData();
                        formData.append('audio', audioBlob);

                        const searchInput = document.querySelector('.search-input');
                        const originalPlaceholder = searchInput ? searchInput.placeholder : "Type / for search modes";
                        if (searchInput) {
                            searchInput.placeholder = "Transcribing your voice...";
                            searchInput.disabled = true;
                        }
                        micBtn.style.opacity = '0.5';
                        micBtn.style.pointerEvents = 'none';

                        try {
                            const response = await fetch('/audio_chat', {
                                method: 'POST',
                                body: formData
                            });
                            const data = await response.json();
                            
                            if (searchInput) {
                                searchInput.placeholder = originalPlaceholder;
                                searchInput.disabled = false;
                            }
                            micBtn.style.opacity = '1';
                            micBtn.style.pointerEvents = 'auto';

                            if (data.transcript) {
                                // Put transcript in the search box so the user can review/edit
                                if (searchInput) {
                                    const currentVal = searchInput.value.trim();
                                    searchInput.value = currentVal ? currentVal + " " + data.transcript : data.transcript;
                                    
                                    // Manually trigger height auto-resize
                                    searchInput.style.height = '48px';
                                    searchInput.style.height = (searchInput.scrollHeight) + 'px';
                                    
                                    // Focus the input
                                    searchInput.focus();
                                }
                            } else if (data.error) {
                                alert("Transcription failed: " + data.error);
                            }
                        } catch (error) {
                            if (searchInput) {
                                searchInput.placeholder = originalPlaceholder;
                                searchInput.disabled = false;
                            }
                            micBtn.style.opacity = '1';
                            micBtn.style.pointerEvents = 'auto';
                            console.error("Audio upload failed", error);
                            alert("Failed to send audio to server.");
                        }

                        // Stop all tracks to release microphone
                        stream.getTracks().forEach(track => track.stop());
                    };

                    mediaRecorder.start();
                    isRecording = true;
                    micBtn.classList.add('recording');
                    console.log("Recording started...");
                } catch (err) {
                    console.error("Microphone access denied:", err);
                    alert("Please allow microphone access to use this feature.");
                }
            } else {
                mediaRecorder.stop();
                isRecording = false;
                micBtn.classList.remove('recording');
                console.log("Recording stopped.");
            }
        });
    }

    // ─── Submit prompt ───
    async function submitPrompt(prompt) {
        if (logoTitle) logoTitle.style.display = 'none';
        if (suggestionsContainer) suggestionsContainer.style.display = 'none';
        if (chatHistory) chatHistory.style.display = 'flex';
        
        appendMessage('user', prompt);
        chatContext.push({ role: 'user', content: prompt });
        
        const loadingId = appendLoadingMessage();
        
        try {
            // Auto-create thread if none active
            if (!currentThreadId) {
                const res = await fetch('/thread', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title: prompt.substring(0, 20) })
                });
                const tdata = await res.json();
                currentThreadId = tdata.id;
            }

            const response = await fetch('/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    prompt: prompt, 
                    mode: currentMode, 
                    history: chatContext.slice(0, -1),
                    thread_id: currentThreadId 
                }) 
            });
            const data = await response.json();
            
            const loadMsg = document.getElementById(loadingId);
            if(loadMsg) loadMsg.remove();
            
            if(data.error) {
                appendMessage('bot', data.error, true);
                chatContext.pop(); // remove user prompt if error
            } else {
                appendMessage(
                    'bot', 
                    data.response, 
                    false, 
                    data.sources && data.sources.length ? data.sources : null,
                    data.search_query || ''
                );
                chatContext.push({ role: 'model', content: data.response });
                
                // Sync Phase UI if BizMind is active
                if (data.current_phase) {
                    updatePhaseUI(data.current_phase);
                }
                
                // Refresh sidebar to update titles
                loadThreadsSidebar();
            }
            
        } catch (error) {
            const loadMsg = document.getElementById(loadingId);
            if(loadMsg) loadMsg.remove();
            appendMessage('bot', '🔌 Failed to connect to server. Make sure the Flask app is running.', true);
        }
    }

    // ─── Source cards ───
    function generateSourcesHtml(sources, searchQuery = '') {
        const headerHtml = `
            <div class="sources-header-title">
                <i class="fa-solid fa-list-ul"></i> SOURCES
                <span class="sources-count-badge">${sources.length} sources</span>
            </div>
        `;

        let cardsHtml = '';
        sources.forEach((src, idx) => {
            let domain = '';
            let faviconHtml = '';
            
            if (src.url === '#local-pdf') {
                domain = 'Local PDF';
                faviconHtml = `<i class="fa-solid fa-file-pdf" style="color: #c00; font-size: 14px;"></i>`;
            } else {
                try {
                    domain = new URL(src.url).hostname;
                    domain = domain.replace(/^www\./, '');
                    faviconHtml = `<img src="https://www.google.com/s2/favicons?domain=${domain}&sz=16" alt="" class="source-favicon">`;
                } catch(e) {
                    domain = src.url;
                    faviconHtml = `<i class="fa-solid fa-globe" style="font-size: 14px;"></i>`;
                }
            }
            
            const snippet = src.snippet ? src.snippet.substring(0, 70) + '...' : '';

            cardsHtml += `
                <a href="${src.url}" target="_blank" rel="noopener noreferrer" class="source-card">
                    <div class="source-card-header">
                        ${faviconHtml}
                        <span class="source-domain">${domain}</span>
                        <div class="source-card-number">${idx + 1}</div>
                    </div>
                    <div class="source-card-title">${escapeHtml(src.title)}</div>
                    <div class="source-card-snippet">${escapeHtml(snippet)}</div>
                </a>
            `;
        });

        return `
            <div class="sources-container">
                ${headerHtml}
                <div class="sources-row">${cardsHtml}</div>
            </div>
            <div class="answer-header">
                PERPLEXITY
            </div>
        `;
    }
    
    // ─── Loading message with multi-step progress ───
    function appendLoadingMessage() {
        const msgDiv = document.createElement('div');
        msgDiv.className = 'chat-message bot-message thinking-message';
        msgDiv.innerHTML = `
            <div class="search-progress">
                <div class="search-step active" id="step-search">
                    <i class="fa-solid fa-magnifying-glass"></i>
                    <span>Searching the web</span>
                    <span class="thinking-dots"><span>.</span><span>.</span><span>.</span></span>
                </div>
                <div class="search-step" id="step-crawl">
                    <i class="fa-solid fa-spider"></i>
                    <span>Crawling & extracting pages</span>
                    <span class="thinking-dots"><span>.</span><span>.</span><span>.</span></span>
                </div>
                <div class="search-step" id="step-generate">
                    <i class="fa-solid fa-brain"></i>
                    <span>Generating answer</span>
                    <span class="thinking-dots"><span>.</span><span>.</span><span>.</span></span>
                </div>
            </div>
        `;
        const msgId = 'msg-' + Date.now() + Math.floor(Math.random() * 100);
        msgDiv.id = msgId;
        if (chatHistory) {
            chatHistory.appendChild(msgDiv);
            msgDiv.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }

        // Auto-advance steps for visual feedback
        setTimeout(() => {
            const s1 = document.querySelector(`#${msgId} #step-search`);
            const s2 = document.querySelector(`#${msgId} #step-crawl`);
            if (s1) s1.classList.add('done');
            if (s2) s2.classList.add('active');
        }, 2500);
        setTimeout(() => {
            const s2 = document.querySelector(`#${msgId} #step-crawl`);
            const s3 = document.querySelector(`#${msgId} #step-generate`);
            if (s2) s2.classList.add('done');
            if (s3) s3.classList.add('active');
        }, 7000);

        return msgId;
    }

    // ─── Chat message ───
    function appendMessage(sender, text, isError = false, sources = null, searchQuery = '') {
        const msgDiv = document.createElement('div');
        msgDiv.className = `chat-message ${sender}-message${isError ? ' error-message' : ''}`;
        
        // Render sources at the top of Bot messages if available
        if (sender === 'bot' && sources) {
            const sourcesHtml = generateSourcesHtml(sources, searchQuery);
            msgDiv.innerHTML = sourcesHtml;
        }

        const textContainer = document.createElement('div');
        textContainer.className = 'message-text-content';

        let processedText = text;
        if (sender === 'bot' && sources) {
            processedText = processedText.replace(/\[(\d+)\]/g, (match, p1) => {
                const idx = parseInt(p1, 10) - 1;
                if (sources[idx]) {
                    return `<a href="${sources[idx].url}" target="_blank" class="citation-badge" title="${sources[idx].title.replace(/"/g, '&quot;')}">${p1}</a>`;
                }
                return match;
            });
            // Handle some unicode numbers Gemini might use occasionally
            const unicodeNumbers = {'❶':1, '❷':2, '❸':3, '❹':4, '❺':5};
            for (const [char, num] of Object.entries(unicodeNumbers)) {
                processedText = processedText.replace(new RegExp(char, 'g'), () => {
                    const idx = num - 1;
                    if (sources[idx]) {
                        return `<a href="${sources[idx].url}" target="_blank" class="citation-badge" title="${sources[idx].title.replace(/"/g, '&quot;')}">${num}</a>`;
                    }
                    return char;
                });
            }
        }

        if (sender === 'bot' && md) {
            textContainer.innerHTML = md.render(processedText);
        } else {
            textContainer.textContent = processedText;
        }
        
        msgDiv.appendChild(textContainer);
        
        const msgId = 'msg-' + Date.now() + Math.floor(Math.random() * 100);
        msgDiv.id = msgId;
        
        if (chatHistory) {
            chatHistory.appendChild(msgDiv);
            msgDiv.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
        
        return msgId;
    }

    // ─── Utility ───
    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
});
