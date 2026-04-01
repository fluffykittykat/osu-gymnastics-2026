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
            <button class="chatbot-btn clear-btn" id="clearChatBtn" title="Clear chat">
              <span>🗑</span>
            </button>
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

        <!-- Save Chat Button -->
        <div class="chatbot-save-area" id="chatbotSaveArea" style="display: none;">
          <button class="chatbot-save-btn" id="saveChatBtn" title="Save this conversation">
            <span>💾</span> Save This Chat
          </button>
        </div>

        <!-- Save Form (inline) -->
        <div class="chatbot-save-form" id="chatbotSaveForm" style="display: none;">
          <div class="save-form-header">Save Analysis</div>
          <input type="text" class="save-form-input" id="saveTitle" placeholder="Title (required)" maxlength="100">
          <textarea class="save-form-textarea" id="saveSummary" placeholder="Summary (optional)" rows="2" maxlength="300"></textarea>
          <select class="save-form-select" id="saveCategory">
            <option value="General">General</option>
            <option value="Athlete Performance">Athlete Performance</option>
            <option value="Team Analysis">Team Analysis</option>
            <option value="Event Breakdown">Event Breakdown</option>
            <option value="Comparison">Comparison</option>
          </select>
          <div class="save-form-actions">
            <button class="save-form-cancel" id="saveCancelBtn">Cancel</button>
            <button class="save-form-submit" id="saveSubmitBtn">Save</button>
          </div>
          <div class="save-form-feedback" id="saveFeedback" style="display: none;"></div>
        </div>

        <!-- Footer Info -->
        <div class="chatbot-footer">
          <small>💡 Ask about meet results, athlete stats, or gymnastics analysis</small>
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

    // Clear chat button
    document.getElementById('clearChatBtn').addEventListener('click', () => this.clearChat());

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

    // Save chat button
    const saveChatBtn = document.getElementById('saveChatBtn');
    const saveCancelBtn = document.getElementById('saveCancelBtn');
    const saveSubmitBtn = document.getElementById('saveSubmitBtn');

    saveChatBtn.addEventListener('click', () => this.showSaveForm());
    saveCancelBtn.addEventListener('click', () => this.hideSaveForm());
    saveSubmitBtn.addEventListener('click', () => this.saveChat());

    // Greet user when widget is first opened
    if (this.messages.length === 0) {
      this.messages = [
        {
          role: 'assistant',
          content: 'Hi! 👋 I\'m your gymnastics AI assistant. Ask me about team stats, athlete performance, meet results, or request detailed analysis of gymnastics data. What would you like to know?',
          timestamp: new Date(),
          isGreeting: true,
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

  clearChat() {
    this.messages = [
      {
        role: 'assistant',
        content: 'Chat cleared! Start a new conversation whenever you\'re ready. 👋',
        timestamp: new Date(),
        isGreeting: true,
      },
    ];
    this.renderMessages();
    this.saveConversationToStorage();
    this.hideSaveForm();
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
      // Auto-detect page context (gymnast profile, meet details, etc.)
      const pageContext = this.getPageContext();

      // Build messages, prepending any page context if set
      const apiMessages = [
        ...pageContext,
        ...(this.contextMessages || []),
        ...this.messages.filter(m => !m.isGreeting).map(m => ({ role: m.role, content: m.content })),
      ];

      // Send to backend (which proxies to Claude)
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiMessages }),
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

    // Scroll to bottom
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    // Update save button visibility
    this.updateSaveButtonVisibility();
  }

  updateSaveButtonVisibility() {
    const saveArea = document.getElementById('chatbotSaveArea');
    if (saveArea) {
      saveArea.style.display = 'flex';
    }
  }

  showSaveForm() {
    document.getElementById('chatbotSaveArea').style.display = 'none';
    document.getElementById('chatbotSaveForm').style.display = 'block';

    // Smart defaults based on page context and conversation
    const titleInput = document.getElementById('saveTitle');
    const summaryInput = document.getElementById('saveSummary');
    const categorySelect = document.getElementById('saveCategory');

    // Detect gymnast name from profile page
    const profileName = document.querySelector('.profile-name');
    const gymnastName = profileName ? profileName.textContent.trim() : '';

    // Get first user message for summary
    const firstUserMsg = this.messages.find(m => m.role === 'user' && !m.isGreeting);
    const firstQuestion = firstUserMsg ? firstUserMsg.content.substring(0, 100) : '';

    // Build default title
    const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    if (gymnastName) {
      titleInput.value = `${gymnastName} Analysis - ${today}`;
      categorySelect.value = 'Athlete Performance';
    } else if (firstQuestion.toLowerCase().includes('compare')) {
      titleInput.value = `Comparison Analysis - ${today}`;
      categorySelect.value = 'Comparison';
    } else if (firstQuestion.toLowerCase().includes('team') || firstQuestion.toLowerCase().includes('season')) {
      titleInput.value = `Team Analysis - ${today}`;
      categorySelect.value = 'Team Analysis';
    } else if (firstQuestion.toLowerCase().match(/vault|bars|beam|floor|event/)) {
      titleInput.value = `Event Analysis - ${today}`;
      categorySelect.value = 'Event Breakdown';
    } else {
      titleInput.value = `Chat Analysis - ${today}`;
      categorySelect.value = 'General';
    }

    // Default summary from first question
    if (firstQuestion) {
      summaryInput.value = firstQuestion;
    }

    titleInput.focus();
    titleInput.select();
  }

  hideSaveForm() {
    document.getElementById('chatbotSaveForm').style.display = 'none';
    document.getElementById('saveFeedback').style.display = 'none';
    document.getElementById('saveTitle').value = '';
    document.getElementById('saveSummary').value = '';
    document.getElementById('saveCategory').value = 'General';
    this.updateSaveButtonVisibility();
  }

  async saveChat() {
    const title = document.getElementById('saveTitle').value.trim();
    const summary = document.getElementById('saveSummary').value.trim();
    const category = document.getElementById('saveCategory').value;
    const feedback = document.getElementById('saveFeedback');

    if (!title) {
      feedback.textContent = 'Title is required';
      feedback.className = 'save-form-feedback error';
      feedback.style.display = 'block';
      return;
    }

    try {
      const chatHistory = this.messages.map(m => ({
        role: m.role,
        content: m.content
      }));

      const response = await fetch('/api/analyses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, summary, category, chatHistory })
      });

      if (!response.ok) {
        throw new Error('Failed to save');
      }

      const data = await response.json();
      feedback.textContent = 'Saved! Generating report... Redirecting to your notes.';
      feedback.className = 'save-form-feedback success';
      feedback.style.display = 'block';
      // Clear chat
      this.messages = [{
        role: 'assistant',
        content: 'Chat saved! Start a new conversation whenever you\'re ready.',
        timestamp: new Date(),
        isGreeting: true,
      }];
      this.saveConversationToStorage();
      // Redirect to notes page (keep feedback visible until navigation)
      setTimeout(() => { window.location.href = '/notes.html'; }, 1500);
    } catch (err) {
      feedback.textContent = 'Error saving. Please try again.';
      feedback.className = 'save-form-feedback error';
      feedback.style.display = 'block';
    }
  }

  /**
   * Auto-detect page context from the current view
   * Returns context messages to prepend to API calls
   */
  getPageContext() {
    // Skip if contextMessages already set (e.g., report pages)
    if (this.contextMessages && this.contextMessages.length > 0) return [];

    let context = '';

    // Detect gymnast profile page
    const profileName = document.querySelector('.profile-name');
    if (profileName && profileName.textContent.trim()) {
      const name = profileName.textContent.trim();
      // Grab visible stats from the profile
      const profileEl = document.getElementById('gymnastDetail');
      const profileText = profileEl ? profileEl.innerText.substring(0, 2000) : '';
      context = `The user is currently viewing the profile page for gymnast "${name}". Here is the profile content they see:\n\n${profileText}\n\nWhen the user says "her", "his", "she", "he", "their", "this gymnast", etc., they are referring to ${name}. Always answer in context. Do NOT ask who they mean.`;
    }

    // Detect meet detail view
    if (!context) {
      const meetTitle = document.querySelector('.meet-detail-title, .meet-header h2');
      if (meetTitle && meetTitle.textContent.trim()) {
        const meetEl = meetTitle.closest('.meet-detail, .meet-view, [id*="meet"]');
        const meetText = meetEl ? meetEl.innerText.substring(0, 2000) : meetTitle.textContent;
        context = `The user is currently viewing meet details: "${meetTitle.textContent.trim()}". Content:\n\n${meetText}\n\nAnswer questions in the context of this meet.`;
      }
    }

    // Detect which main view is active (season, gymnasts list, leaderboards, insights)
    if (!context) {
      const activeViews = document.querySelectorAll('.view[style*="display: block"], .view:not([style*="display: none"])');
      for (const view of activeViews) {
        if (view.id && view.offsetHeight > 0) {
          const viewName = view.id.replace('view-', '');
          const visibleText = view.innerText.substring(0, 2000);
          context = `The user is currently viewing the "${viewName}" page of the OSU Gymnastics site. Here is what they see on screen:\n\n${visibleText}\n\nAnswer questions in the context of what they are viewing. If they say "this", "these", etc., they refer to what is on screen.`;
          break;
        }
      }
    }

    // Notes page
    if (!context && window.location.pathname.includes('notes')) {
      context = 'The user is on the Saved Notes page viewing their saved analyses.';
    }

    if (!context) return [];

    return [
      { role: 'user', content: 'CONTEXT: ' + context },
      { role: 'assistant', content: 'Got it. I have full context on what the user is viewing and will answer all questions accordingly without asking for clarification.' }
    ];
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
}

// Initialize chatbot when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.chatbot = new ChatbotWidget();
});
