/**
 * AI Chatbot Widget - Facebook Messenger style floating window
 * Integrates with Claude API via backend proxy
 */

class ChatbotWidget {
  constructor() {
    this.isOpen = false;
    this.messages = [];
    this.isLoading = false;
    this.sessionId = this.generateSessionId();
    this.sendDebounceTimer = null;
    this.lastSendTime = 0;
    this.init();
    this.loadConversationFromStorage();
  }

  generateSessionId() {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  init() {
    this.createWidget();
    this.attachEventListeners();
  }

  /**
   * Load conversation history from localStorage if available
   */
  loadConversationFromStorage() {
    try {
      const stored = localStorage.getItem(`chatbot_conversation_${this.sessionId}`);
      if (stored) {
        const data = JSON.parse(stored);
        this.messages = data.map(m => ({
          ...m,
          timestamp: new Date(m.timestamp),
        }));
      }
    } catch (e) {
      console.warn('Failed to load conversation from storage:', e);
    }
  }

  /**
   * Save conversation history to localStorage
   */
  saveConversationToStorage() {
    try {
      localStorage.setItem(`chatbot_conversation_${this.sessionId}`, JSON.stringify(this.messages));
    } catch (e) {
      console.warn('Failed to save conversation to storage:', e);
    }
  }

  createWidget() {
    // Create container for chatbot
    const container = document.createElement('div');
    container.id = 'chatbot-widget';
    container.className = 'chatbot-widget';
    container.innerHTML = `
      <!-- Floating Chat Bubble -->
      <div class="chatbot-bubble" id="chatbotBubble">
        <div class="bubble-content">
          <span class="bubble-icon">💬</span>
        </div>
      </div>

      <!-- Chat Window -->
      <div class="chatbot-window" id="chatbotWindow" style="display: none;">
        <!-- Header -->
        <div class="chatbot-header">
          <div class="header-left">
            <h3>Gymnastics AI Assistant</h3>
            <p class="status-text">Powered by Claude</p>
          </div>
          <div class="header-actions">
            <button class="chatbot-btn minimize-btn" id="minimizeBtn" title="Minimize">
              <span>−</span>
            </button>
            <button class="chatbot-btn close-btn" id="closeBtn" title="Close">
              <span>✕</span>
            </button>
          </div>
        </div>

        <!-- Messages Container -->
        <div class="chatbot-messages" id="chatbotMessages"></div>

        <!-- Typing Indicator -->
        <div class="typing-indicator" id="typingIndicator" style="display: none;">
          <span></span><span></span><span></span>
        </div>

        <!-- Input Area -->
        <div class="chatbot-input-area">
          <textarea 
            class="chatbot-input" 
            id="chatbotInput" 
            placeholder="Ask about gymnastics stats, athletes, or meets..."
            rows="1"
          ></textarea>
          <button class="chatbot-send-btn" id="sendBtn" title="Send message">
            <span>📤</span>
          </button>
        </div>

        <!-- Save Chat Section -->
        <div class="chatbot-save-section" id="saveChatSection" style="display: none;">
          <button class="save-chat-btn" id="saveChatBtn" title="Save this chat to your notes">
            <span>💾</span> Save This Chat
          </button>
          <a href="saved-notes.html" class="view-notes-btn" title="View your saved analyses">
            <span>📔</span> View Saved Notes
          </a>
        </div>

        <!-- Footer Info -->
        <div class="chatbot-footer">
          <small>💡 Ask about meet results, athlete stats, or gymnastics analysis</small>
        </div>
      </div>

      <!-- Save Chat Modal -->
      <div class="save-chat-modal" id="saveChatModal" style="display: none;">
        <div class="modal-overlay" id="modalOverlay"></div>
        <div class="modal-content">
          <div class="modal-header">
            <h2>Save This Analysis</h2>
            <button class="modal-close-btn" id="modalCloseBtn">✕</button>
          </div>
          <div class="modal-body">
            <div class="form-group">
              <label for="analysisTitleInput">Title *</label>
              <input 
                type="text" 
                id="analysisTitleInput" 
                placeholder="e.g., Savannah Mill Season Analysis"
                maxlength="200"
              >
              <small class="char-count"><span id="titleCharCount">0</span>/200</small>
            </div>

            <div class="form-group">
              <label for="analysisSummaryInput">Summary (optional)</label>
              <textarea 
                id="analysisSummaryInput" 
                placeholder="Add a brief summary of this analysis..."
                rows="3"
                maxlength="500"
              ></textarea>
              <small class="char-count"><span id="summaryCharCount">0</span>/500</small>
            </div>

            <div class="form-group">
              <label for="analysisCategorySelect">Category</label>
              <select id="analysisCategorySelect">
                <option value="other">📌 Other</option>
                <option value="athlete">🤸 Athlete Performance</option>
                <option value="comparison">⚖️ Athlete Comparison</option>
                <option value="trends">📈 Performance Trends</option>
              </select>
            </div>

            <div class="form-message" id="formMessage"></div>
          </div>
          <div class="modal-footer">
            <button class="btn-secondary" id="modalCancelBtn">Cancel</button>
            <button class="btn-primary" id="modalSaveBtn">Save Analysis</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(container);
  }

  attachEventListeners() {
    const bubble = document.getElementById('chatbotBubble');
    const window = document.getElementById('chatbotWindow');
    const closeBtn = document.getElementById('closeBtn');
    const minimizeBtn = document.getElementById('minimizeBtn');
    const input = document.getElementById('chatbotInput');
    const sendBtn = document.getElementById('sendBtn');

    // Toggle window on bubble click
    bubble.addEventListener('click', () => {
      if (this.isOpen) {
        this.closeWindow();
      } else {
        this.openWindow();
      }
    });

    // Close button
    closeBtn.addEventListener('click', () => this.closeWindow());

    // Minimize button
    minimizeBtn.addEventListener('click', () => this.minimizeWindow());

    // Send message on button click with debouncing
    sendBtn.addEventListener('click', () => this.debouncedSend());

    // Send message on Enter (but allow Shift+Enter for newline)
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.debouncedSend();
      }
    });

    // Auto-resize textarea and enforce max length
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
      
      // Enforce max length of 2000 characters
      if (input.value.length > 2000) {
        input.value = input.value.substring(0, 2000);
      }
    });

    // Save chat functionality
    document.getElementById('saveChatBtn')?.addEventListener('click', () => this.openSaveChatModal());
    document.getElementById('modalCloseBtn')?.addEventListener('click', () => this.closeSaveChatModal());
    document.getElementById('modalOverlay')?.addEventListener('click', () => this.closeSaveChatModal());
    document.getElementById('modalCancelBtn')?.addEventListener('click', () => this.closeSaveChatModal());
    document.getElementById('modalSaveBtn')?.addEventListener('click', () => this.saveChat());

    // Character counters for save modal
    document.getElementById('analysisTitleInput')?.addEventListener('input', (e) => {
      document.getElementById('titleCharCount').textContent = e.target.value.length;
    });

    document.getElementById('analysisSummaryInput')?.addEventListener('input', (e) => {
      document.getElementById('summaryCharCount').textContent = e.target.value.length;
    });

    // Greet user when widget is first opened
    if (this.messages.length === 0) {
      this.messages = [
        {
          role: 'assistant',
          content: 'Hi! 👋 I\'m your gymnastics AI assistant. Ask me about team stats, athlete performance, meet results, or request detailed analysis of gymnastics data. What would you like to know?',
          timestamp: new Date(),
        },
      ];
      this.saveConversationToStorage();
    }
  }

  /**
   * Debounce sending messages to prevent rapid-fire API requests
   */
  debouncedSend() {
    const now = Date.now();
    const timeSinceLastSend = now - this.lastSendTime;

    if (timeSinceLastSend < 500) {
      // Too soon, reschedule
      clearTimeout(this.sendDebounceTimer);
      this.sendDebounceTimer = setTimeout(() => {
        this.debouncedSend();
      }, 500 - timeSinceLastSend);
      return;
    }

    this.lastSendTime = now;
    this.sendMessage();
  }

  openWindow() {
    const window = document.getElementById('chatbotWindow');
    const bubble = document.getElementById('chatbotBubble');
    window.style.display = 'flex';
    bubble.classList.add('active');
    this.isOpen = true;
    this.renderMessages();
    document.getElementById('chatbotInput').focus();
  }

  closeWindow() {
    const window = document.getElementById('chatbotWindow');
    const bubble = document.getElementById('chatbotBubble');
    window.style.display = 'none';
    bubble.classList.remove('active');
    this.isOpen = false;
  }

  minimizeWindow() {
    const window = document.getElementById('chatbotWindow');
    const isMinimized = window.classList.toggle('minimized');
    if (isMinimized) {
      window.style.height = '60px';
    } else {
      window.style.height = '';
    }
  }

  async sendMessage() {
    const input = document.getElementById('chatbotInput');
    const userMessage = input.value.trim();

    // Validation: empty message, whitespace-only, or already loading
    if (!userMessage || this.isLoading) return;
    if (userMessage.length > 2000) {
      alert('Message is too long (max 2000 characters)');
      return;
    }

    // Add user message to conversation
    this.messages.push({
      role: 'user',
      content: userMessage,
      timestamp: new Date(),
    });

    // Clear input
    input.value = '';
    input.style.height = 'auto';

    // Render messages and save to storage
    this.renderMessages();
    this.saveConversationToStorage();

    // Show typing indicator
    this.showTypingIndicator();

    try {
      // Send to backend (which proxies to Claude)
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: this.messages.map(m => ({
            role: m.role,
            content: m.content,
          })),
        }),
        timeout: 35000, // 35 second timeout to match server config
      });

      if (!response.ok) {
        if (response.status === 429) {
          throw new Error('Too many requests. Please wait a moment before sending another message.');
        }
        if (response.status === 504) {
          throw new Error('The AI service is responding slowly. Please try again in a moment.');
        }
        if (response.status === 503) {
          throw new Error('The AI service is temporarily unavailable. Please try again shortly.');
        }
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();

      if (data.success && data.message) {
        // Add assistant response
        this.messages.push({
          role: 'assistant',
          content: data.message,
          timestamp: new Date(),
          statsAvailable: data.statsAvailable !== false,
        });
      } else if (data.error) {
        throw new Error(data.error);
      } else {
        throw new Error('Failed to get response from AI assistant');
      }
    } catch (error) {
      console.error('Chat error:', error.message);
      // Add error message - be helpful and specific
      let errorMessage = `Sorry, I encountered an error: ${error.message}`;
      
      if (error.message.includes('network') || error.message.includes('fetch')) {
        errorMessage = 'Network error. Please check your internet connection and try again.';
      } else if (error.message.includes('timeout')) {
        errorMessage = 'The request took too long. Please try again.';
      }
      
      this.messages.push({
        role: 'assistant',
        content: errorMessage + ' 🔄 Please try again or refresh the page if the problem persists.',
        timestamp: new Date(),
        isError: true,
      });
    } finally {
      this.hideTypingIndicator();
      this.renderMessages();
      this.saveConversationToStorage();
    }
  }

  renderMessages() {
    const messagesContainer = document.getElementById('chatbotMessages');
    messagesContainer.innerHTML = '';

    this.messages.forEach((msg) => {
      const messageEl = document.createElement('div');
      messageEl.className = `message ${msg.role}-message`;
      if (msg.isError) messageEl.classList.add('error');

      // Parse markdown-like formatting
      const content = this.formatMessage(msg.content);

      messageEl.innerHTML = `
        <div class="message-content">
          ${content}
        </div>
        <div class="message-time">${msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
      `;

      messagesContainer.appendChild(messageEl);
    });

    // Show save button if there are at least 2 messages (user + assistant response)
    const saveSection = document.getElementById('saveChatSection');
    if (saveSection && this.messages.length >= 2) {
      saveSection.style.display = 'flex';
    }

    // Scroll to bottom
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  formatMessage(content) {
    // Escape HTML first
    let html = content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Convert markdown images ![alt](url) to <img> tags
    // Only allow images from common sources for security
    html = html.replace(
      /!\[([^\]]*)\]\((https?:\/\/[^\s)]+(?:\.(?:jpg|jpeg|png|gif|webp)))\)/gi,
      '<img src="$2" alt="$1" style="max-width: 100%; height: auto; border-radius: 8px; margin: 8px 0;" />'
    );

    // Convert URLs to links (but not image URLs already processed)
    html = html.replace(
      /(https?:\/\/[^\s<]+)/g,
      '<a href="$1" target="_blank" rel="noopener">$1</a>'
    );

    // Convert **bold** to <strong>
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    // Convert *italic* to <em>
    html = html.replace(/\*([^*]+?)\*/g, '<em>$1</em>');

    // Convert `code` to <code>
    html = html.replace(/`([^`]+?)`/g, '<code>$1</code>');

    // Convert ### Heading to <h4>, ## to <h3>, # to <h2>
    html = html.replace(/^### (.+?)$/gm, '<h4 style="margin: 8px 0; font-weight: 600;">$1</h4>');
    html = html.replace(/^## (.+?)$/gm, '<h3 style="margin: 8px 0; font-weight: 600;">$1</h3>');
    html = html.replace(/^# (.+?)$/gm, '<h2 style="margin: 8px 0; font-weight: 600;">$1</h2>');

    // Convert line breaks
    html = html.replace(/\n/g, '<br>');

    return html;
  }

  showTypingIndicator() {
    const indicator = document.getElementById('typingIndicator');
    indicator.style.display = 'flex';
    const messagesContainer = document.getElementById('chatbotMessages');
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    this.isLoading = true;
  }

  hideTypingIndicator() {
    const indicator = document.getElementById('typingIndicator');
    indicator.style.display = 'none';
    this.isLoading = false;
  }

  /**
   * Open the save chat modal
   */
  openSaveChatModal() {
    const modal = document.getElementById('saveChatModal');
    if (modal) {
      modal.style.display = 'flex';
      document.getElementById('analysisTitleInput').focus();
      // Reset form
      document.getElementById('analysisTitleInput').value = '';
      document.getElementById('analysisSummaryInput').value = '';
      document.getElementById('analysisCategorySelect').value = 'other';
      document.getElementById('titleCharCount').textContent = '0';
      document.getElementById('summaryCharCount').textContent = '0';
      document.getElementById('formMessage').textContent = '';
      document.getElementById('formMessage').className = 'form-message';
    }
  }

  /**
   * Close the save chat modal
   */
  closeSaveChatModal() {
    const modal = document.getElementById('saveChatModal');
    if (modal) {
      modal.style.display = 'none';
    }
  }

  /**
   * Save the current chat as an analysis
   */
  async saveChat() {
    const title = document.getElementById('analysisTitleInput').value.trim();
    const summary = document.getElementById('analysisSummaryInput').value.trim();
    const category = document.getElementById('analysisCategorySelect').value;

    // Validation
    if (!title) {
      this.showFormMessage('Please enter a title for your analysis', 'error');
      document.getElementById('analysisTitleInput').focus();
      return;
    }

    if (title.length < 5) {
      this.showFormMessage('Title must be at least 5 characters', 'error');
      return;
    }

    // Show loading state
    this.showFormMessage('Saving analysis...', 'info');
    const saveBtn = document.getElementById('modalSaveBtn');
    if (saveBtn) saveBtn.disabled = true;

    try {
      // Call backend API to save analysis
      const response = await fetch('/api/analyses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          summary,
          category,
          chatHistory: this.messages.map(m => ({
            role: m.role,
            content: m.content,
            timestamp: m.timestamp instanceof Date ? m.timestamp.toISOString() : m.timestamp,
          })),
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to save analysis');
      }

      const data = await response.json();

      if (data.success) {
        this.showFormMessage('✓ Analysis saved successfully!', 'success');
        
        // Close modal after a short delay
        setTimeout(() => {
          this.closeSaveChatModal();
          // Clear the input fields
          document.getElementById('analysisTitleInput').value = '';
          document.getElementById('analysisSummaryInput').value = '';
        }, 1000);
      } else {
        throw new Error('Failed to save analysis');
      }
    } catch (e) {
      console.error('Failed to save analysis:', e);
      this.showFormMessage(`Error: ${e.message}`, 'error');
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  /**
   * Show a message in the save modal form
   */
  showFormMessage(message, type = 'info') {
    const messageEl = document.getElementById('formMessage');
    messageEl.textContent = message;
    messageEl.className = `form-message ${type}`;
  }
}

// Initialize chatbot when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.chatbot = new ChatbotWidget();
});
