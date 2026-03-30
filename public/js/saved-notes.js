/**
 * Saved Notes & Analysis Manager
 * Manages the user's notebook of saved chatbot analyses
 */

class SavedNotesManager {
  constructor() {
    this.analyses = [];
    this.currentAnalysisId = null;
    this.init();
  }

  init() {
    this.attachEventListeners();
  }

  attachEventListeners() {
    // Listen for note view changes
    document.addEventListener('viewChanged', (e) => {
      if (e.detail === 'notes') {
        this.loadAndRender();
      }
    });
  }

  /**
   * Load analyses from server
   */
  async loadAnalyses() {
    try {
      const response = await fetch('/api/analyses');
      if (!response.ok) {
        throw new Error(`Failed to load analyses: ${response.status}`);
      }
      this.analyses = await response.json();
      return this.analyses;
    } catch (err) {
      console.error('[SavedNotes] Load error:', err.message);
      this.showToast('Failed to load saved analyses', 'error');
      return [];
    }
  }

  /**
   * Load and render the saved notes view
   */
  async loadAndRender() {
    const container = document.getElementById('savedNotesContainer');
    if (!container) return;

    // Show loading state
    container.innerHTML = '<div class="loading-text">📚 Loading your saved analyses...</div>';

    await this.loadAnalyses();

    if (this.analyses.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📝</div>
          <h2>No Saved Analyses Yet</h2>
          <p>Start a conversation with the chatbot and save interesting findings to build your personal gymnastics notebook!</p>
          <button class="btn-primary" id="startChatBtn">💬 Start a Chat</button>
        </div>
      `;

      document.getElementById('startChatBtn').addEventListener('click', () => {
        const bubble = document.getElementById('chatbotBubble');
        if (bubble) bubble.click();
      });
      return;
    }

    // Render list view
    this.renderListView();
  }

  /**
   * Render the list of saved analyses
   */
  renderListView() {
    const container = document.getElementById('savedNotesContainer');
    if (!container) return;

    const filterOptions = ['All', 'General', 'Athlete Performance', 'Athlete Comparison', 'Performance Trends'];
    const selectedFilter = sessionStorage.getItem('notesFilter') || 'All';

    let filtered = this.analyses;
    if (selectedFilter !== 'All') {
      filtered = this.analyses.filter(a => a.category === selectedFilter);
    }

    const filtersHTML = filterOptions.map(filter => 
      `<button class="filter-btn ${selectedFilter === filter ? 'active' : ''}" data-filter="${filter}">${filter}</button>`
    ).join('');

    const cardsHTML = filtered.map(analysis => `
      <div class="analysis-card" data-id="${analysis.id}">
        <div class="card-header">
          <h3 class="card-title">${this.escapeHtml(analysis.title)}</h3>
          <span class="card-date">${new Date(analysis.createdAt).toLocaleDateString()}</span>
        </div>
        <div class="card-body">
          ${analysis.summary ? `<p class="card-summary">${this.escapeHtml(analysis.summary.substring(0, 100))}${analysis.summary.length > 100 ? '...' : ''}</p>` : ''}
          <div class="card-meta">
            <span class="badge">${this.escapeHtml(analysis.category)}</span>
            <span class="meta-text">💬 ${analysis.chatLength || 0} messages</span>
            <span class="meta-text">📌 ${analysis.insightCount || 0} insights</span>
          </div>
        </div>
        <button class="btn-view-full">View Full Analysis →</button>
      </div>
    `).join('');

    container.innerHTML = `
      <div class="notes-header">
        <h2>📓 My Saved Analyses</h2>
        <div class="filter-bar">
          ${filtersHTML}
        </div>
      </div>
      <div class="analysis-grid">
        ${cardsHTML}
      </div>
    `;

    // Attach filter listeners
    container.querySelectorAll('[data-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        sessionStorage.setItem('notesFilter', btn.textContent.trim());
        this.renderListView();
      });
    });

    // Attach card click listeners
    container.querySelectorAll('.analysis-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (!e.target.classList.contains('btn-view-full')) return;
        const id = card.dataset.id;
        this.renderDetailView(id);
      });
    });
  }

  /**
   * Render the detail view of a specific analysis
   */
  async renderDetailView(analysisId) {
    try {
      const response = await fetch(`/api/analyses/${analysisId}`);
      if (!response.ok) {
        throw new Error('Failed to load analysis');
      }
      const analysis = await response.json();
      this.currentAnalysisId = analysisId;

      const container = document.getElementById('savedNotesContainer');
      if (!container) return;

      // Format chat history
      const chatHTML = (analysis.chatHistory || []).map((msg, idx) => `
        <div class="chat-message ${msg.role}-message">
          <div class="message-role">${msg.role === 'user' ? 'You' : '🤖 AI'}</div>
          <div class="message-content">${this.formatMessage(msg.content)}</div>
        </div>
      `).join('');

      // Format insights
      const insightsHTML = (analysis.insights || []).map(insight => `
        <div class="insight-item">
          <div class="insight-time">${new Date(insight.createdAt).toLocaleString()}</div>
          <div class="insight-content">📌 ${this.escapeHtml(insight.content)}</div>
        </div>
      `).join('');

      container.innerHTML = `
        <button class="back-btn" id="backToList">← Back to List</button>
        
        <div class="analysis-detail">
          <div class="detail-header">
            <h2>${this.escapeHtml(analysis.title)}</h2>
            <div class="detail-meta">
              <span>📅 ${new Date(analysis.createdAt).toLocaleDateString()}</span>
              <span class="badge">${this.escapeHtml(analysis.category)}</span>
            </div>
            ${analysis.summary ? `<p class="detail-summary">${this.escapeHtml(analysis.summary)}</p>` : ''}
            <div class="detail-actions">
              <button class="btn-secondary" id="editBtn">✏️ Edit</button>
              <button class="btn-danger" id="deleteBtn">🗑️ Delete</button>
            </div>
          </div>

          <div class="detail-section">
            <h3>💬 Chat Conversation</h3>
            <div class="chat-display">
              ${chatHTML}
            </div>
          </div>

          <div class="detail-section">
            <h3>📌 Your Insights</h3>
            <div class="insights-display">
              ${insightsHTML || '<p class="empty-text">No insights added yet. Click below to add one!</p>'}
            </div>
            <button class="btn-primary" id="addInsightBtn">➕ Add Insight</button>
          </div>
        </div>
      `;

      // Attach event listeners
      document.getElementById('backToList').addEventListener('click', () => {
        this.currentAnalysisId = null;
        this.renderListView();
      });

      document.getElementById('editBtn').addEventListener('click', () => {
        this.showEditModal(analysis);
      });

      document.getElementById('deleteBtn').addEventListener('click', () => {
        this.showDeleteConfirmation(analysisId);
      });

      document.getElementById('addInsightBtn').addEventListener('click', () => {
        this.showInsightModal();
      });
    } catch (err) {
      console.error('[SavedNotes] Detail view error:', err.message);
      this.showToast('Failed to load analysis details', 'error');
    }
  }

  /**
   * Show modal to add insight
   */
  showInsightModal() {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-content">
        <h3>Add Insight</h3>
        <textarea id="insightInput" placeholder="Write your finding or observation..." rows="4"></textarea>
        <div class="modal-actions">
          <button class="btn-secondary" id="cancelInsightBtn">Cancel</button>
          <button class="btn-primary" id="saveInsightBtn">Save Insight</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const input = modal.querySelector('#insightInput');
    input.focus();

    modal.querySelector('#cancelInsightBtn').addEventListener('click', () => {
      modal.remove();
    });

    modal.querySelector('#saveInsightBtn').addEventListener('click', async () => {
      const content = input.value.trim();
      if (content.length < 3) {
        this.showToast('Insight must be at least 3 characters', 'error');
        return;
      }

      try {
        const response = await fetch(`/api/analyses/${this.currentAnalysisId}/insights`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content })
        });

        if (!response.ok) {
          throw new Error(`Failed to add insight: ${response.status}`);
        }

        modal.remove();
        this.showToast('✅ Insight saved!');
        
        // Refresh detail view
        this.renderDetailView(this.currentAnalysisId);
      } catch (err) {
        console.error('[SavedNotes] Insight error:', err.message);
        this.showToast('Failed to save insight', 'error');
      }
    });

    // Close on overlay click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });
  }

  /**
   * Show modal to edit analysis
   */
  showEditModal(analysis) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-content">
        <h3>Edit Analysis</h3>
        <div class="form-group">
          <label>Title</label>
          <input type="text" id="editTitle" value="${this.escapeHtml(analysis.title)}" maxlength="200">
        </div>
        <div class="form-group">
          <label>Summary (optional)</label>
          <textarea id="editSummary" placeholder="Add a summary..." rows="3" maxlength="500">${this.escapeHtml(analysis.summary || '')}</textarea>
        </div>
        <div class="form-group">
          <label>Category</label>
          <select id="editCategory">
            <option ${analysis.category === 'General' ? 'selected' : ''}>General</option>
            <option ${analysis.category === 'Athlete Performance' ? 'selected' : ''}>Athlete Performance</option>
            <option ${analysis.category === 'Athlete Comparison' ? 'selected' : ''}>Athlete Comparison</option>
            <option ${analysis.category === 'Performance Trends' ? 'selected' : ''}>Performance Trends</option>
          </select>
        </div>
        <div class="modal-actions">
          <button class="btn-secondary" id="cancelEditBtn">Cancel</button>
          <button class="btn-primary" id="saveEditBtn">Save Changes</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('#cancelEditBtn').addEventListener('click', () => {
      modal.remove();
    });

    modal.querySelector('#saveEditBtn').addEventListener('click', async () => {
      const title = modal.querySelector('#editTitle').value.trim();
      const summary = modal.querySelector('#editSummary').value.trim();
      const category = modal.querySelector('#editCategory').value;

      if (title.length < 3) {
        this.showToast('Title must be at least 3 characters', 'error');
        return;
      }

      try {
        const response = await fetch(`/api/analyses/${analysis.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, summary, category })
        });

        if (!response.ok) {
          throw new Error(`Failed to update analysis: ${response.status}`);
        }

        modal.remove();
        this.showToast('✅ Analysis updated!');
        
        // Refresh
        await this.loadAnalyses();
        this.renderDetailView(analysis.id);
      } catch (err) {
        console.error('[SavedNotes] Edit error:', err.message);
        this.showToast('Failed to update analysis', 'error');
      }
    });

    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });
  }

  /**
   * Show delete confirmation
   */
  showDeleteConfirmation(analysisId) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-content modal-confirm">
        <h3>Delete Analysis?</h3>
        <p>This action cannot be undone.</p>
        <div class="modal-actions">
          <button class="btn-secondary" id="cancelDeleteBtn">Cancel</button>
          <button class="btn-danger" id="confirmDeleteBtn">Delete</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('#cancelDeleteBtn').addEventListener('click', () => {
      modal.remove();
    });

    modal.querySelector('#confirmDeleteBtn').addEventListener('click', async () => {
      try {
        const response = await fetch(`/api/analyses/${analysisId}`, {
          method: 'DELETE'
        });

        if (!response.ok) {
          throw new Error(`Failed to delete analysis: ${response.status}`);
        }

        modal.remove();
        this.showToast('✅ Analysis deleted');
        
        // Refresh list
        await this.loadAnalyses();
        this.currentAnalysisId = null;
        this.renderListView();
      } catch (err) {
        console.error('[SavedNotes] Delete error:', err.message);
        this.showToast('Failed to delete analysis', 'error');
      }
    });

    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });
  }

  /**
   * Helper: Format message content (same as chatbot)
   */
  formatMessage(content) {
    let html = content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Convert markdown bold
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*]+?)\*/g, '<em>$1</em>');
    html = html.replace(/`([^`]+?)`/g, '<code>$1</code>');

    // Convert headings
    html = html.replace(/^### (.+?)$/gm, '<h4>$1</h4>');
    html = html.replace(/^## (.+?)$/gm, '<h3>$1</h3>');
    html = html.replace(/^# (.+?)$/gm, '<h2>$1</h2>');

    // Convert line breaks
    html = html.replace(/\n/g, '<br>');

    return html;
  }

  /**
   * Helper: Escape HTML
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Helper: Show toast notification
   */
  showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;

    container.appendChild(toast);

    setTimeout(() => {
      toast.remove();
    }, 3000);
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.savedNotesManager = new SavedNotesManager();
});
