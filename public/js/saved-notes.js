/**
 * Saved Notes & Analysis Module
 * Handles displaying, viewing, and managing saved chatbot analyses
 */

class SavedNotesManager {
  constructor() {
    this.analyses = [];
    this.selectedAnalysis = null;
    this.currentFilter = 'all';
    this.init();
  }

  async init() {
    await this.loadAnalyses();
    this.attachEventListeners();
  }

  async loadAnalyses() {
    try {
      const response = await fetch('/api/analyses');
      if (!response.ok) throw new Error('Failed to load analyses');

      const data = await response.json();
      this.analyses = data.analyses || [];
      console.log(`[SavedNotes] Loaded ${this.analyses.length} analyses`);
    } catch (err) {
      console.error('[SavedNotes] Error loading analyses:', err.message);
      this.analyses = [];
    }
  }

  async loadAnalysisDetail(id) {
    try {
      const response = await fetch(`/api/analyses/${id}`);
      if (!response.ok) throw new Error('Analysis not found');

      const data = await response.json();
      this.selectedAnalysis = data.analysis;
      return data.analysis;
    } catch (err) {
      console.error('[SavedNotes] Error loading analysis:', err.message);
      return null;
    }
  }

  async addInsight(analysisId, content) {
    try {
      const response = await fetch(`/api/analyses/${analysisId}/insights`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });

      if (!response.ok) throw new Error('Failed to add insight');

      const data = await response.json();
      this.selectedAnalysis = data.analysis;
      return data.insight;
    } catch (err) {
      console.error('[SavedNotes] Error adding insight:', err.message);
      throw err;
    }
  }

  async updateAnalysis(id, updates) {
    try {
      const response = await fetch(`/api/analyses/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });

      if (!response.ok) throw new Error('Failed to update analysis');

      const data = await response.json();
      const index = this.analyses.findIndex(a => a.id === id);
      if (index !== -1) {
        this.analyses[index] = data.analysis;
      }
      if (this.selectedAnalysis?.id === id) {
        this.selectedAnalysis = data.analysis;
      }
      return data.analysis;
    } catch (err) {
      console.error('[SavedNotes] Error updating analysis:', err.message);
      throw err;
    }
  }

  async deleteAnalysis(id) {
    try {
      const response = await fetch(`/api/analyses/${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) throw new Error('Failed to delete analysis');

      this.analyses = this.analyses.filter(a => a.id !== id);
      if (this.selectedAnalysis?.id === id) {
        this.selectedAnalysis = null;
      }
      return true;
    } catch (err) {
      console.error('[SavedNotes] Error deleting analysis:', err.message);
      throw err;
    }
  }

  attachEventListeners() {
    // Listen for navigation event from chatbot
    window.addEventListener('navigateToNotes', () => {
      window.dispatchEvent(new CustomEvent('viewChange', { detail: { view: 'notes' } }));
    });
  }

  getCategories() {
    const categories = new Set(this.analyses.map(a => a.category).filter(Boolean));
    return ['all', ...Array.from(categories).sort()];
  }

  getFilteredAnalyses() {
    if (this.currentFilter === 'all') {
      return this.analyses;
    }
    return this.analyses.filter(a => a.category === this.currentFilter);
  }

  formatDate(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  formatDateShort(dateStr) {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now - date;

    // Less than 1 minute
    if (diff < 60000) return 'just now';
    // Less than 1 hour
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    // Less than 1 day
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    // Less than 7 days
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;

    // Otherwise show date
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  renderAnalysesList() {
    const analyses = this.getFilteredAnalyses();

    if (analyses.length === 0) {
      return `
        <div class="empty-state">
          <div class="empty-icon">📭</div>
          <p>No saved analyses yet</p>
          <small>Start a chat with the AI assistant and save your findings to build your notebook.</small>
        </div>
      `;
    }

    return analyses
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map(
        (analysis) => `
      <div class="analysis-card" data-id="${analysis.id}">
        <div class="analysis-card-header">
          <h3>${this.escapeHtml(analysis.title)}</h3>
          <span class="analysis-date">${this.formatDateShort(analysis.createdAt)}</span>
        </div>
        <div class="analysis-card-meta">
          <span class="analysis-category">${this.escapeHtml(analysis.category)}</span>
          ${
            analysis.insightCount > 0
              ? `<span class="insight-badge">${analysis.insightCount} insight${analysis.insightCount !== 1 ? 's' : ''}</span>`
              : ''
          }
        </div>
        ${
          analysis.summary
            ? `<p class="analysis-summary">${this.escapeHtml(analysis.summary.substring(0, 150))}${analysis.summary.length > 150 ? '...' : ''}</p>`
            : ''
        }
        <div class="analysis-card-actions">
          <button class="view-btn" data-id="${analysis.id}">View Full →</button>
        </div>
      </div>
    `
      )
      .join('');
  }

  renderAnalysisDetail(analysis) {
    if (!analysis) {
      return '<p>Analysis not found</p>';
    }

    const chatHtml = (analysis.chatHistory || [])
      .map((msg, idx) => {
        const isUser = msg.role === 'user';
        const content = this.escapeHtml(msg.content)
          .replace(/\n/g, '<br>')
          .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
          .replace(/\*([^*]+?)\*/g, '<em>$1</em>')
          .replace(/`([^`]+?)`/g, '<code>$1</code>');

        return `
        <div class="chat-message ${isUser ? 'user' : 'assistant'}">
          <div class="message-role">${isUser ? 'You' : 'AI Assistant'}</div>
          <div class="message-content">${content}</div>
        </div>
      `;
      })
      .join('');

    const insightsHtml =
      analysis.insights && analysis.insights.length > 0
        ? analysis.insights
            .map(
              (insight) => `
          <div class="insight-item">
            <div class="insight-header">
              <span class="insight-time">${this.formatDate(insight.createdAt)}</span>
              <button class="delete-insight-btn" data-insight-id="${insight.id}" title="Delete insight">
                ✕
              </button>
            </div>
            <div class="insight-content">${this.escapeHtml(insight.content)}</div>
          </div>
        `
            )
            .join('')
        : '<p class="no-insights">No insights added yet. Add one below to get started.</p>';

    return `
      <div class="analysis-detail-container">
        <div class="detail-header">
          <div class="detail-title-section">
            <h2>${this.escapeHtml(analysis.title)}</h2>
            <div class="detail-meta">
              <span class="category-badge">${this.escapeHtml(analysis.category)}</span>
              <span class="detail-date">Saved ${this.formatDate(analysis.createdAt)}</span>
            </div>
          </div>
          <div class="detail-actions">
            <button class="detail-btn edit-btn" id="editBtn" title="Edit title and category">
              ✏️ Edit
            </button>
            <button class="detail-btn delete-btn" id="deleteBtn" title="Delete this analysis">
              🗑️ Delete
            </button>
            <button class="detail-btn back-btn" id="backBtn" title="Back to list">
              ← Back
            </button>
          </div>
        </div>

        ${
          analysis.summary
            ? `
          <div class="detail-summary">
            <h3>Summary</h3>
            <p>${this.escapeHtml(analysis.summary)}</p>
          </div>
        `
            : ''
        }

        <div class="detail-section">
          <h3>📋 Chat Conversation</h3>
          <div class="chat-transcript">
            ${chatHtml}
          </div>
        </div>

        <div class="detail-section">
          <h3>📌 Insights & Notes</h3>
          <div class="insights-list">
            ${insightsHtml}
          </div>

          <div class="add-insight-form" id="addInsightForm">
            <textarea 
              id="insightInput" 
              placeholder="Add a new insight or finding..."
              maxlength="500"
            ></textarea>
            <div class="insight-form-footer">
              <span class="char-count"><span id="insightCharCount">0</span>/500</span>
              <button type="button" id="addInsightBtn" class="add-insight-btn">
                + Add Insight
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.savedNotesManager = new SavedNotesManager();
});
