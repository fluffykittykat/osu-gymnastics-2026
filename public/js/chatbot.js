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
    this.init();
  }

  generateSessionId() {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  init() {
    this.createWidget();
    this.attachEventListeners();
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

    // Close button
    closeBtn.addEventListener('click', () => this.closeWindow());

    // Minimize button
    minimizeBtn.addEventListener('click', () => this.minimizeWindow());

    // Send message on button click
    sendBtn.addEventListener('click', () => this.sendMessage());

    // Send message on Enter (but allow Shift+Enter for newline)
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    // Auto-resize textarea
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    });

    // Greet user when widget is first opened
    if (this.messages.length === 0) {
      this.messages = [
        {
          role: 'assistant',
          content: 'Hi! 👋 I\'m your gymnastics AI assistant. Ask me about team stats, athlete performance, meet results, or anything else about OSU Gymnastics 2026!',
          timestamp: new Date(),
        },
      ];
    }
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

    if (!userMessage || this.isLoading) return;

    // Add user message to conversation
    this.messages.push({
      role: 'user',
      content: userMessage,
      timestamp: new Date(),
    });

    // Clear input
    input.value = '';
    input.style.height = 'auto';

    // Render messages
    this.renderMessages();

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
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();

      if (data.success && data.message) {
        // Add assistant response
        this.messages.push({
          role: 'assistant',
          content: data.message,
          timestamp: new Date(),
        });
      } else {
        throw new Error(data.error || 'Failed to get response');
      }
    } catch (error) {
      console.error('Chat error:', error);
      // Add error message
      this.messages.push({
        role: 'assistant',
        content: `Sorry, I encountered an error: ${error.message}. Please try again later.`,
        timestamp: new Date(),
        isError: true,
      });
    } finally {
      this.hideTypingIndicator();
      this.renderMessages();
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
  }

  formatMessage(content) {
    // Escape HTML
    let html = content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Convert URLs to links
    html = html.replace(
      /(https?:\/\/[^\s]+)/g,
      '<a href="$1" target="_blank" rel="noopener">$1</a>'
    );

    // Convert **bold** to <strong>
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    // Convert *italic* to <em>
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // Convert `code` to <code>
    html = html.replace(/`(.+?)`/g, '<code>$1</code>');

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
