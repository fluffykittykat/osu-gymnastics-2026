/**
 * Saved Notes & Analysis Manager
 * Handles display, management, and interaction with saved chat analyses
 */

class SavedNotesManager {
  constructor() {
    this.analyses = [];
    this.currentAnalysisId = null;
    this.filteredAnalyses = [];
    this.currentFilter = 'all';
    this.searchTerm = '';
    this.init();
  }

  init() {
    this.attachEventListeners();
    this.loadAnalysesFromServer();
  }

  /**
   * Load all saved analyses from backend API
   */
  async loadAnalysesFromServer() {
    try {
      const response = await fetch('/api/analyses');
      if (!response.ok) {
        throw new Error('Failed to load analyses');
      }
      const data = await response.json();
      this.analyses = data.analyses || [];
      this.analyses.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      this.renderListView();
    } catch (e) {
      console.error('Failed to load analyses from server:', e);
      this.analyses = [];
      this.showToast('Error loading saved analyses', 'error');
      this.renderListView();
    }
  }

  /**
   * Attach event listeners to UI elements
   */
  attachEventListeners() {
    // Navigation
    document.getElementById('backToChatBtn').addEventListener('click', () => this.backToChat());
    document.getElementById('startChatBtn').addEventListener('click', () => this.backToChat());
    document.getElementById('backToListBtn').addEventListener('click', () => this.backToListView());

    // Filter and search
    document.getElementById('searchInput').addEventListener('input', (e) => {
      this.searchTerm = e.target.value.toLowerCase();
      this.applyFiltersAndRender();
    });

    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        this.currentFilter = e.target.dataset.filter;
        this.applyFiltersAndRender();
      });
    });

    // Detail view actions
    document.getElementById('addInsightBtn').addEventListener('click', () => this.showAddInsightForm());
    document.getElementById('cancelInsightBtn').addEventListener('click', () => this.hideAddInsightForm());
    document.getElementById('saveInsightBtn').addEventListener('click', () => this.saveNewInsight());
    document.getElementById('deleteAnalysisBtn').addEventListener('click', () => this.deleteCurrentAnalysis());

    // Refresh button
    document.getElementById('refreshBtn').addEventListener('click', () => {
      this.loadAnalysesFromServer().then(() => {
        if (this.currentAnalysisId) {
          this.showDetailView(this.currentAnalysisId);
        } else {
          this.applyFiltersAndRender();
        }
      });
    });
  }

  /**
   * Apply filters and render the list
   */
  applyFiltersAndRender() {
    this.filteredAnalyses = this.analyses.filter(analysis => {
      // Filter by category
      if (this.currentFilter !== 'all' && analysis.category !== this.currentFilter) {
        return false;
      }

      // Filter by search term
      if (this.searchTerm) {
        const searchableText = `${analysis.title} ${analysis.summary || ''} ${analysis.category || ''}`.toLowerCase();
        return searchableText.includes(this.searchTerm);
      }

      return true;
    });

    this.renderListView();
  }

  /**
   * Render the list view with all saved analyses
   */
  renderListView() {
    const listView = document.getElementById('listView');
    const detailView = document.getElementById('detailView');
    listView.style.display = 'block';
    detailView.style.display = 'none';
    this.currentAnalysisId = null;

    const emptyState = document.getElementById('emptyState');
    const grid = document.getElementById('analysesGrid');

    if (this.filteredAnalyses.length === 0) {
      emptyState.style.display = 'block';
      grid.style.display = 'none';
      return;
    }

    emptyState.style.display = 'none';
    grid.style.display = 'grid';
    grid.innerHTML = '';

    this.filteredAnalyses.forEach(analysis => {
      const card = this.createAnalysisCard(analysis);
      grid.appendChild(card);
    });
  }

  /**
   * Create a card element for an analysis
   */
  createAnalysisCard(analysis) {
    const card = document.createElement('div');
    card.className = 'analysis-card';

    const createdDate = new Date(analysis.createdAt);
    const formattedDate = createdDate.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: createdDate.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
    });

    const categoryLabel = this.getCategoryLabel(analysis.category);

    card.innerHTML = `
      <div class="card-header">
        <h3 class="card-title">${this.escapeHtml(analysis.title)}</h3>
        <span class="card-date">${formattedDate}</span>
      </div>
      <div class="card-category ${analysis.category || 'other'}">
        ${categoryLabel}
      </div>
      <p class="card-summary">${this.escapeHtml(analysis.summary || 'Click to view full analysis and add insights...')}</p>
      <div class="card-footer">
        <div class="card-meta">
          <span class="card-meta-item">
            <span>💬</span>
            <span>${analysis.chatHistory?.length || 0} messages</span>
          </span>
          <span class="card-meta-item">
            <span>📌</span>
            <span>${analysis.insights?.length || 0} insights</span>
          </span>
        </div>
        <button class="card-action" onclick="return false;">View Full →</button>
      </div>
    `;

    card.addEventListener('click', () => this.showDetailView(analysis.id));

    return card;
  }

  /**
   * Show the detail view for an analysis
   */
  showDetailView(analysisId) {
    const analysis = this.analyses.find(a => a.id === analysisId);
    if (!analysis) return;

    this.currentAnalysisId = analysisId;

    // Update header
    document.getElementById('detailTitle').textContent = analysis.title;
    document.getElementById('detailDate').textContent = new Date(analysis.createdAt).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    // Update category badge
    const categoryBadge = document.getElementById('categoryBadge');
    categoryBadge.innerHTML = `<span class="badge">${this.getCategoryLabel(analysis.category)}</span>`;
    categoryBadge.className = 'meta-item';

    // Update insight count
    const insightCount = analysis.insights?.length || 0;
    const insightCountBadge = document.getElementById('insightCountBadge');
    insightCountBadge.innerHTML = `<span>📌 ${insightCount} ${insightCount === 1 ? 'insight' : 'insights'}</span>`;
    insightCountBadge.className = 'meta-item';

    // Update summary
    document.getElementById('detailSummary').textContent = analysis.summary || 'No summary provided.';

    // Render chat history
    this.renderChatHistory(analysis.chatHistory);

    // Render insights
    this.renderInsights(analysis.insights || []);

    // Hide add insight form
    this.hideAddInsightForm();

    // Switch to detail view
    document.getElementById('listView').style.display = 'none';
    document.getElementById('detailView').style.display = 'block';

    // Scroll to top
    window.scrollTo(0, 0);
  }

  /**
   * Render chat history
   */
  renderChatHistory(chatHistory) {
    const container = document.getElementById('chatHistoryContainer');
    container.innerHTML = '';

    if (!chatHistory || chatHistory.length === 0) {
      container.innerHTML = '<p class="empty-message">No chat history available.</p>';
      return;
    }

    chatHistory.forEach((msg) => {
      const bubble = document.createElement('div');
      bubble.className = `chat-bubble ${msg.role}`;

      // Format message content
      const content = this.formatMessage(msg.content);
      const time = new Date(msg.timestamp).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
      });

      bubble.innerHTML = `
        <div>${content}</div>
        <div class="chat-message-time">${time}</div>
      `;

      container.appendChild(bubble);
    });
  }

  /**
   * Render insights
   */
  renderInsights(insights) {
    const list = document.getElementById('insightsList');
    const emptyMsg = document.getElementById('emptyInsights');

    if (!insights || insights.length === 0) {
      list.innerHTML = '';
      emptyMsg.style.display = 'block';
      return;
    }

    emptyMsg.style.display = 'none';
    list.innerHTML = '';

    insights.forEach((insight) => {
      const item = document.createElement('div');
      item.className = 'insight-item';

      const createdDate = new Date(insight.createdAt);
      const formattedDate = createdDate.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      });
      const formattedTime = createdDate.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
      });

      item.innerHTML = `
        <p class="insight-content">${this.escapeHtml(insight.content)}</p>
        <div class="insight-time">📌 ${formattedDate} at ${formattedTime}</div>
      `;

      list.appendChild(item);
    });
  }

  /**
   * Show the add insight form
   */
  showAddInsightForm() {
    const form = document.getElementById('addInsightForm');
    const textarea = document.getElementById('insightTextarea');
    form.style.display = 'block';
    textarea.focus();
    textarea.value = '';
  }

  /**
   * Hide the add insight form
   */
  hideAddInsightForm() {
    const form = document.getElementById('addInsightForm');
    form.style.display = 'none';
    document.getElementById('insightTextarea').value = '';
  }

  /**
   * Save a new insight
   */
  async saveNewInsight() {
    const textarea = document.getElementById('insightTextarea');
    const content = textarea.value.trim();

    if (!content) {
      this.showToast('Please enter an insight', 'error');
      return;
    }

    if (content.length > 2000) {
      this.showToast('Insight is too long (max 2000 characters)', 'error');
      return;
    }

    try {
      // Call API to add insight
      const response = await fetch(`/api/analyses/${this.currentAnalysisId}/insights`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to add insight');
      }

      const data = await response.json();

      if (data.success) {
        // Update local analysis
        const analysis = this.analyses.find(a => a.id === this.currentAnalysisId);
        if (analysis) {
          analysis.insights = data.analysis.insights;
          analysis.updatedAt = data.analysis.updatedAt;
        }

        // Clear textarea and re-render
        textarea.value = '';
        this.showDetailView(this.currentAnalysisId);
        this.showToast('Insight added successfully! 📌', 'success');
      } else {
        throw new Error('Failed to add insight');
      }
    } catch (e) {
      console.error('Failed to add insight:', e);
      this.showToast(`Error: ${e.message}`, 'error');
    }
  }

  /**
   * Delete the current analysis
   */
  async deleteCurrentAnalysis() {
    if (!this.currentAnalysisId) return;

    if (!confirm('Are you sure you want to delete this analysis? This action cannot be undone.')) {
      return;
    }

    try {
      // Call API to delete analysis
      const response = await fetch(`/api/analyses/${this.currentAnalysisId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete analysis');
      }

      const data = await response.json();

      if (data.success) {
        // Remove from local array
        this.analyses = this.analyses.filter(a => a.id !== this.currentAnalysisId);
        this.showToast('Analysis deleted successfully', 'success');
        this.backToListView();
      } else {
        throw new Error('Failed to delete analysis');
      }
    } catch (e) {
      console.error('Failed to delete analysis:', e);
      this.showToast(`Error: ${e.message}`, 'error');
    }
  }

  /**
   * Go back to list view
   */
  backToListView() {
    this.loadAnalysesFromServer();
  }

  /**
   * Navigate back to main page (to chat)
   */
  backToChat() {
    window.location.href = 'index.html#insights';
  }

  /**
   * Get a label for a category
   */
  getCategoryLabel(category) {
    const labels = {
      athlete: '🤸 Athlete Performance',
      comparison: '⚖️ Athlete Comparison',
      trends: '📈 Performance Trends',
      other: '📌 Other',
    };
    return labels[category] || labels.other;
  }

  /**
   * Format message content (basic markdown-like)
   */
  formatMessage(content) {
    return this.escapeHtml(content)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+?)\*/g, '<em>$1</em>')
      .replace(/`([^`]+?)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br>');
  }

  /**
   * Escape HTML to prevent XSS
   */
  escapeHtml(text) {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    };
    return text.replace(/[&<>"']/g, m => map[m]);
  }

  /**
   * Show a toast notification
   */
  showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;

    container.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = 'slideUp 0.3s ease reverse';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }
}

// Initialize the saved notes manager when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.savedNotesManager = new SavedNotesManager();
});
