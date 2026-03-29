/**
 * Saved Notes & Analysis Manager
 * Handles saving, retrieving, and managing chat analyses with insights
 */

class SavedNotesManager {
  constructor() {
    this.storageKey = 'savedAnalyses';
    this.init();
  }

  /**
   * Initialize the saved notes manager
   */
  init() {
    this.loadAllAnalyses = this.loadAllAnalyses.bind(this);
    this.saveAnalysis = this.saveAnalysis.bind(this);
    this.getAnalysis = this.getAnalysis.bind(this);
    this.addInsight = this.addInsight.bind(this);
    this.deleteAnalysis = this.deleteAnalysis.bind(this);
    this.updateAnalysis = this.updateAnalysis.bind(this);
  }

  /**
   * Get all saved analyses for the current user
   */
  loadAllAnalyses() {
    try {
      const data = localStorage.getItem(this.storageKey);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      console.error('Failed to load saved analyses:', e);
      return [];
    }
  }

  /**
   * Save a new chat analysis
   * @param {Object} analysis - Analysis object with title, summary, category, chatHistory
   * @returns {Object} - Saved analysis with ID
   */
  saveAnalysis(analysis) {
    try {
      const analyses = this.loadAllAnalyses();
      
      const newAnalysis = {
        id: `analysis_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        title: analysis.title || 'Untitled Analysis',
        summary: analysis.summary || '',
        category: analysis.category || 'General',
        chatHistory: analysis.chatHistory || [],
        insights: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      analyses.push(newAnalysis);
      localStorage.setItem(this.storageKey, JSON.stringify(analyses));
      
      return newAnalysis;
    } catch (e) {
      console.error('Failed to save analysis:', e);
      throw e;
    }
  }

  /**
   * Get a specific analysis by ID
   * @param {String} analysisId
   * @returns {Object|null}
   */
  getAnalysis(analysisId) {
    const analyses = this.loadAllAnalyses();
    return analyses.find(a => a.id === analysisId) || null;
  }

  /**
   * Update analysis metadata (title, category, summary)
   * @param {String} analysisId
   * @param {Object} updates
   * @returns {Object|null}
   */
  updateAnalysis(analysisId, updates) {
    try {
      const analyses = this.loadAllAnalyses();
      const index = analyses.findIndex(a => a.id === analysisId);
      
      if (index === -1) return null;
      
      analyses[index] = {
        ...analyses[index],
        ...updates,
        updatedAt: new Date().toISOString(),
      };
      
      localStorage.setItem(this.storageKey, JSON.stringify(analyses));
      return analyses[index];
    } catch (e) {
      console.error('Failed to update analysis:', e);
      throw e;
    }
  }

  /**
   * Add an insight to an analysis
   * @param {String} analysisId
   * @param {String} content - Insight text
   * @returns {Object|null} - Updated analysis
   */
  addInsight(analysisId, content) {
    try {
      const analyses = this.loadAllAnalyses();
      const analysis = analyses.find(a => a.id === analysisId);
      
      if (!analysis) return null;
      
      const newInsight = {
        id: `insight_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        content,
        createdAt: new Date().toISOString(),
      };
      
      if (!analysis.insights) {
        analysis.insights = [];
      }
      
      analysis.insights.push(newInsight);
      analysis.updatedAt = new Date().toISOString();
      
      localStorage.setItem(this.storageKey, JSON.stringify(analyses));
      return analysis;
    } catch (e) {
      console.error('Failed to add insight:', e);
      throw e;
    }
  }

  /**
   * Delete a saved analysis
   * @param {String} analysisId
   * @returns {Boolean}
   */
  deleteAnalysis(analysisId) {
    try {
      let analyses = this.loadAllAnalyses();
      const initialLength = analyses.length;
      analyses = analyses.filter(a => a.id !== analysisId);
      
      if (analyses.length === initialLength) return false; // Not found
      
      localStorage.setItem(this.storageKey, JSON.stringify(analyses));
      return true;
    } catch (e) {
      console.error('Failed to delete analysis:', e);
      throw e;
    }
  }

  /**
   * Format date for display
   * @param {String} dateString - ISO date string
   * @returns {String}
   */
  formatDate(dateString) {
    const date = new Date(dateString);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (date.toDateString() === yesterday.toDateString()) {
      return 'Yesterday';
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined });
    }
  }
}

/**
 * Saved Notes UI Manager
 * Handles rendering and user interactions for the saved notes page
 */
class SavedNotesUI {
  constructor() {
    this.manager = new SavedNotesManager();
    this.currentDetailAnalysisId = null;
    this.init();
  }

  init() {
    this.setupEventListeners();
  }

  setupEventListeners() {
    // Back button from detail view
    document.addEventListener('click', (e) => {
      if (e.target.closest('.back-to-notes')) {
        this.closeDetailView();
      }
      
      // Open detail view
      if (e.target.closest('.analysis-card')) {
        const card = e.target.closest('.analysis-card');
        const analysisId = card.dataset.analysisId;
        this.showDetailView(analysisId);
      }

      // Delete analysis
      if (e.target.closest('.delete-analysis-btn')) {
        e.stopPropagation();
        const btn = e.target.closest('.delete-analysis-btn');
        const analysisId = btn.dataset.analysisId;
        this.deleteAnalysis(analysisId);
      }

      // Add insight
      if (e.target.closest('.add-insight-btn')) {
        e.stopPropagation();
        this.showAddInsightForm();
      }

      // Submit insight
      if (e.target.closest('.submit-insight-btn')) {
        e.stopPropagation();
        this.submitInsight();
      }

      // Cancel adding insight
      if (e.target.closest('.cancel-insight-btn')) {
        e.stopPropagation();
        this.hideAddInsightForm();
      }

      // Edit analysis
      if (e.target.closest('.edit-analysis-btn')) {
        e.stopPropagation();
        this.showEditForm();
      }

      // Submit edit
      if (e.target.closest('.submit-edit-btn')) {
        e.stopPropagation();
        this.submitEdit();
      }

      // Cancel edit
      if (e.target.closest('.cancel-edit-btn')) {
        e.stopPropagation();
        this.hideEditForm();
      }
    });
  }

  /**
   * Render the saved notes page
   */
  render() {
    const analyses = this.manager.loadAllAnalyses();
    const container = document.getElementById('view-notes');

    if (!container) return;

    if (analyses.length === 0) {
      container.innerHTML = `
        <div class="notes-empty-state">
          <div class="empty-icon">📔</div>
          <h2>No Saved Analyses Yet</h2>
          <p>Start a conversation with the Gymnastics AI Assistant and click "Save This Chat" to build your personal notebook of insights.</p>
          <button class="btn btn-primary" onclick="document.getElementById('chatbotBubble').click()">
            Start New Analysis
          </button>
        </div>
      `;
      return;
    }

    // Group by category
    const byCategory = {};
    analyses.forEach(a => {
      const cat = a.category || 'General';
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(a);
    });

    let html = `
      <div class="notes-container">
        <div class="notes-header">
          <h1>📔 Saved Analyses</h1>
          <p class="notes-subtitle">${analyses.length} saved analysis${analyses.length !== 1 ? 'es' : ''}</p>
        </div>
        
        <div class="notes-filters">
          <button class="filter-tag active" data-filter="all">All</button>
    `;

    Object.keys(byCategory).forEach(cat => {
      html += `<button class="filter-tag" data-filter="${cat}">${cat}</button>`;
    });

    html += `
        </div>

        <div class="notes-grid">
    `;

    // Sort analyses by date (newest first)
    const sortedAnalyses = analyses.sort((a, b) => 
      new Date(b.createdAt) - new Date(a.createdAt)
    );

    sortedAnalyses.forEach(analysis => {
      const preview = analysis.summary || analysis.chatHistory
        .filter(m => m.role === 'assistant')
        .map(m => m.content)
        .join(' ')
        .substring(0, 150) + '...';

      html += `
        <div class="analysis-card" data-analysis-id="${analysis.id}" data-category="${analysis.category}">
          <div class="card-header">
            <h3 class="card-title">${this.escapeHtml(analysis.title)}</h3>
            <button class="delete-analysis-btn" data-analysis-id="${analysis.id}" title="Delete">🗑️</button>
          </div>
          
          <div class="card-meta">
            <span class="card-date">${this.manager.formatDate(analysis.createdAt)}</span>
            <span class="card-category">${analysis.category}</span>
          </div>

          <p class="card-preview">${this.escapeHtml(preview)}</p>

          <div class="card-footer">
            <span class="insight-count">💡 ${analysis.insights?.length || 0} insights</span>
            <span class="message-count">💬 ${analysis.chatHistory?.length || 0} messages</span>
          </div>
        </div>
      `;
    });

    html += `
        </div>
      </div>
    `;

    container.innerHTML = html;
    this.attachFilterListeners();
  }

  /**
   * Show detail view for an analysis
   */
  showDetailView(analysisId) {
    const analysis = this.manager.getAnalysis(analysisId);
    if (!analysis) return;

    this.currentDetailAnalysisId = analysisId;
    const container = document.getElementById('view-notes');

    let html = `
      <div class="notes-detail">
        <button class="back-to-notes back-btn">← Back to Analyses</button>

        <div class="detail-header">
          <div class="detail-title-section">
            <h1>${this.escapeHtml(analysis.title)}</h1>
            <p class="detail-date">${this.manager.formatDate(analysis.createdAt)}</p>
          </div>
          <div class="detail-actions">
            <button class="edit-analysis-btn" title="Edit title/category">✏️ Edit</button>
            <button class="delete-analysis-btn" data-analysis-id="${analysisId}" title="Delete">🗑️ Delete</button>
          </div>
        </div>

        <div class="detail-meta">
          <span class="badge category-badge">${analysis.category}</span>
          ${analysis.summary ? `<p class="detail-summary"><strong>Summary:</strong> ${this.escapeHtml(analysis.summary)}</p>` : ''}
        </div>

        <!-- Chat Section -->
        <div class="detail-section">
          <h2 class="section-title">💬 Conversation</h2>
          <div class="chat-transcript">
    `;

    analysis.chatHistory.forEach(msg => {
      const formatted = this.formatMessageContent(msg.content);
      html += `
        <div class="transcript-message ${msg.role}-message">
          <div class="transcript-role">${msg.role === 'user' ? 'You' : 'AI Assistant'}</div>
          <div class="transcript-content">${formatted}</div>
          ${msg.timestamp ? `<div class="transcript-time">${new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>` : ''}
        </div>
      `;
    });

    html += `
          </div>
        </div>

        <!-- Insights Section -->
        <div class="detail-section">
          <div class="insights-header">
            <h2 class="section-title">📌 Insights Added</h2>
            <button class="add-insight-btn">+ Add Insight</button>
          </div>

          <div class="insights-list" id="insightsList">
    `;

    if (analysis.insights && analysis.insights.length > 0) {
      analysis.insights.forEach(insight => {
        html += `
          <div class="insight-item">
            <div class="insight-date">${this.manager.formatDate(insight.createdAt)}</div>
            <div class="insight-content">${this.escapeHtml(insight.content)}</div>
          </div>
        `;
      });
    } else {
      html += `<p class="no-insights">No insights added yet. Click "Add Insight" to start building your analysis.</p>`;
    }

    html += `
          </div>

          <!-- Add Insight Form (hidden by default) -->
          <div class="add-insight-form" id="addInsightForm" style="display: none;">
            <textarea class="insight-textarea" id="insightTextarea" placeholder="Add a finding, observation, or note..." rows="3"></textarea>
            <div class="form-actions">
              <button class="submit-insight-btn btn btn-primary">Save Insight</button>
              <button class="cancel-insight-btn btn btn-secondary">Cancel</button>
            </div>
          </div>
        </div>

        <!-- Edit Form (hidden by default) -->
        <div class="edit-form" id="editForm" style="display: none;">
          <div class="form-group">
            <label for="editTitle">Title</label>
            <input type="text" id="editTitle" class="form-input" value="${this.escapeHtml(analysis.title)}" />
          </div>
          <div class="form-group">
            <label for="editCategory">Category</label>
            <input type="text" id="editCategory" class="form-input" value="${this.escapeHtml(analysis.category)}" />
          </div>
          <div class="form-group">
            <label for="editSummary">Summary (optional)</label>
            <textarea id="editSummary" class="form-input" rows="3">${this.escapeHtml(analysis.summary || '')}</textarea>
          </div>
          <div class="form-actions">
            <button class="submit-edit-btn btn btn-primary">Save Changes</button>
            <button class="cancel-edit-btn btn btn-secondary">Cancel</button>
          </div>
        </div>
      </div>
    `;

    container.innerHTML = html;
    this.setupEventListeners();
  }

  /**
   * Close detail view and return to list
   */
  closeDetailView() {
    this.currentDetailAnalysisId = null;
    this.render();
  }

  /**
   * Show the add insight form
   */
  showAddInsightForm() {
    const form = document.getElementById('addInsightForm');
    if (form) {
      form.style.display = 'block';
      document.getElementById('insightTextarea').focus();
    }
  }

  /**
   * Hide the add insight form
   */
  hideAddInsightForm() {
    const form = document.getElementById('addInsightForm');
    if (form) {
      form.style.display = 'none';
      document.getElementById('insightTextarea').value = '';
    }
  }

  /**
   * Submit a new insight
   */
  submitInsight() {
    const textarea = document.getElementById('insightTextarea');
    const content = textarea.value.trim();

    if (!content) {
      alert('Please enter an insight');
      return;
    }

    try {
      this.manager.addInsight(this.currentDetailAnalysisId, content);
      this.showDetailView(this.currentDetailAnalysisId);
    } catch (e) {
      alert('Failed to add insight: ' + e.message);
    }
  }

  /**
   * Show the edit form
   */
  showEditForm() {
    const form = document.getElementById('editForm');
    if (form) form.style.display = 'block';
  }

  /**
   * Hide the edit form
   */
  hideEditForm() {
    const form = document.getElementById('editForm');
    if (form) form.style.display = 'none';
  }

  /**
   * Submit edits to analysis
   */
  submitEdit() {
    const title = document.getElementById('editTitle').value.trim();
    const category = document.getElementById('editCategory').value.trim();
    const summary = document.getElementById('editSummary').value.trim();

    if (!title) {
      alert('Title is required');
      return;
    }

    try {
      this.manager.updateAnalysis(this.currentDetailAnalysisId, {
        title,
        category,
        summary,
      });
      this.showDetailView(this.currentDetailAnalysisId);
    } catch (e) {
      alert('Failed to update analysis: ' + e.message);
    }
  }

  /**
   * Delete an analysis
   */
  deleteAnalysis(analysisId) {
    if (!confirm('Are you sure you want to delete this analysis? This cannot be undone.')) {
      return;
    }

    try {
      this.manager.deleteAnalysis(analysisId);
      if (this.currentDetailAnalysisId === analysisId) {
        this.closeDetailView();
      } else {
        this.render();
      }
    } catch (e) {
      alert('Failed to delete analysis: ' + e.message);
    }
  }

  /**
   * Attach filter listeners
   */
  attachFilterListeners() {
    document.querySelectorAll('.filter-tag').forEach(btn => {
      btn.addEventListener('click', () => {
        const filter = btn.dataset.filter;
        
        // Update active button
        document.querySelectorAll('.filter-tag').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        // Filter cards
        const cards = document.querySelectorAll('.analysis-card');
        cards.forEach(card => {
          if (filter === 'all' || card.dataset.category === filter) {
            card.style.display = '';
          } else {
            card.style.display = 'none';
          }
        });
      });
    });
  }

  /**
   * Format message content (same as chatbot formatting)
   */
  formatMessageContent(content) {
    let html = this.escapeHtml(content);

    // Convert markdown-like formatting
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*]+?)\*/g, '<em>$1</em>');
    html = html.replace(/`([^`]+?)`/g, '<code>$1</code>');
    html = html.replace(/^### (.+?)$/gm, '<h4 style="margin: 8px 0; font-weight: 600;">$1</h4>');
    html = html.replace(/^## (.+?)$/gm, '<h3 style="margin: 8px 0; font-weight: 600;">$1</h3>');
    html = html.replace(/^# (.+?)$/gm, '<h2 style="margin: 8px 0; font-weight: 600;">$1</h2>');
    html = html.replace(/\n/g, '<br>');

    return html;
  }

  /**
   * Escape HTML
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Initialize when page loads
let savedNotesUI = null;
document.addEventListener('DOMContentLoaded', () => {
  savedNotesUI = new SavedNotesUI();
});
