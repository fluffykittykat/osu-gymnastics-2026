/**
 * Notes Page - Saved Analyses viewer and manager
 * OSU Gymnastics 2026
 */

class NotesPage {
  constructor() {
    this.analyses = [];
    this.activeFilter = 'all';
    this.currentAnalysisId = null;
    this.init();
  }

  async init() {
    this.attachFilterListeners();
    this.attachModalListeners();
    await this.loadAnalyses();
  }

  attachFilterListeners() {
    document.querySelectorAll('.filter-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.activeFilter = btn.dataset.category;
        this.renderCards();
      });
    });
  }

  attachModalListeners() {
    document.getElementById('modalCloseBtn').addEventListener('click', () => this.closeModal());
    document.getElementById('notesModal').addEventListener('click', (e) => {
      if (e.target.id === 'notesModal') this.closeModal();
    });
    document.getElementById('modalEditBtn').addEventListener('click', () => this.showEditForm());
    document.getElementById('modalDeleteBtn').addEventListener('click', () => this.deleteAnalysis());
    document.getElementById('editCancelBtn').addEventListener('click', () => this.hideEditForm());
    document.getElementById('editSaveBtn').addEventListener('click', () => this.saveEdit());
    document.getElementById('addInsightBtn').addEventListener('click', () => this.addInsight());

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.closeModal();
    });
  }

  async loadAnalyses() {
    try {
      const response = await fetch('/api/analyses');
      if (!response.ok) throw new Error('Failed to load');
      this.analyses = await response.json();
      this.renderCards();
    } catch (err) {
      console.error('Failed to load analyses:', err);
      this.analyses = [];
      this.renderCards();
    } finally {
      document.getElementById('notesLoading').style.display = 'none';
    }
  }

  getFilteredAnalyses() {
    if (this.activeFilter === 'all') return this.analyses;
    return this.analyses.filter(a => a.category === this.activeFilter);
  }

  renderCards() {
    const grid = document.getElementById('notesGrid');
    const empty = document.getElementById('notesEmpty');
    const filtered = this.getFilteredAnalyses();

    if (filtered.length === 0) {
      grid.style.display = 'none';
      empty.style.display = 'flex';
      return;
    }

    grid.style.display = 'grid';
    empty.style.display = 'none';

    grid.innerHTML = filtered.map(analysis => {
      const date = new Date(analysis.updatedAt).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric'
      });
      const preview = this.getPreviewText(analysis);
      const categoryClass = this.getCategoryClass(analysis.category);
      const insightCount = analysis.insights ? analysis.insights.length : 0;

      return `
        <div class="note-card" data-id="${analysis.id}">
          <div class="card-header">
            <span class="card-category ${categoryClass}">${analysis.category}</span>
            <span class="card-date">${date}</span>
          </div>
          <h3 class="card-title">${this.escapeHtml(analysis.title)}</h3>
          <p class="card-preview">${this.escapeHtml(preview)}</p>
          <div class="card-footer">
            ${insightCount > 0 ? `<span class="card-insights">💡 ${insightCount} insight${insightCount !== 1 ? 's' : ''}</span>` : ''}
            <button class="card-view-btn">View</button>
          </div>
        </div>
      `;
    }).join('');

    // Attach click handlers
    grid.querySelectorAll('.note-card').forEach(card => {
      card.addEventListener('click', () => this.openAnalysis(card.dataset.id));
    });
  }

  getPreviewText(analysis) {
    if (analysis.summary) return analysis.summary;
    if (analysis.chatHistory && analysis.chatHistory.length > 0) {
      const firstUser = analysis.chatHistory.find(m => m.role === 'user');
      if (firstUser) return firstUser.content.substring(0, 120) + (firstUser.content.length > 120 ? '...' : '');
    }
    return 'No preview available';
  }

  getCategoryClass(category) {
    const map = {
      'Athlete Performance': 'cat-athlete',
      'Team Analysis': 'cat-team',
      'Event Breakdown': 'cat-event',
      'Comparison': 'cat-comparison',
      'General': 'cat-general'
    };
    return map[category] || 'cat-general';
  }

  async openAnalysis(id) {
    this.currentAnalysisId = id;

    try {
      const response = await fetch(`/api/analyses/${id}`);
      if (!response.ok) throw new Error('Not found');
      const analysis = await response.json();
      this.renderModal(analysis);
      document.getElementById('notesModal').style.display = 'flex';
      document.body.style.overflow = 'hidden';
    } catch (err) {
      console.error('Failed to load analysis:', err);
      alert('Failed to load analysis');
    }
  }

  renderModal(analysis) {
    document.getElementById('modalTitle').textContent = analysis.title;
    const badge = document.getElementById('modalCategory');
    badge.textContent = analysis.category;
    badge.className = `modal-category-badge ${this.getCategoryClass(analysis.category)}`;

    // Render formatted report or fallback to chat messages
    const chatContainer = document.getElementById('modalChatMessages');

    if (analysis.formattedReport) {
      // Show the AI-generated professional report
      chatContainer.innerHTML = `
        <div class="report-view active" id="reportView">
          <div class="formatted-report">${analysis.formattedReport}</div>
        </div>
        <div class="chat-view" id="chatView" style="display:none;">
          ${(analysis.chatHistory || []).map(msg => {
            const content = this.formatMessage(msg.content);
            return `
              <div class="modal-message ${msg.role}-message">
                <div class="modal-message-label">${msg.role === 'user' ? 'You' : 'AI Assistant'}</div>
                <div class="modal-message-content">${content}</div>
              </div>
            `;
          }).join('')}
        </div>
        <div class="view-toggle">
          <button class="toggle-btn active" id="toggleReport">Report</button>
          <button class="toggle-btn" id="toggleChat">Raw Chat</button>
        </div>
      `;

      // Attach toggle listeners
      document.getElementById('toggleReport').addEventListener('click', () => {
        document.getElementById('reportView').style.display = 'block';
        document.getElementById('chatView').style.display = 'none';
        document.getElementById('toggleReport').classList.add('active');
        document.getElementById('toggleChat').classList.remove('active');
      });
      document.getElementById('toggleChat').addEventListener('click', () => {
        document.getElementById('reportView').style.display = 'none';
        document.getElementById('chatView').style.display = 'block';
        document.getElementById('toggleChat').classList.add('active');
        document.getElementById('toggleReport').classList.remove('active');
      });
    } else {
      // No formatted report yet — show generating message + raw chat
      chatContainer.innerHTML = `
        <div class="report-generating">
          <p>Report is being generated... Refresh in a moment to see the formatted version.</p>
        </div>
        ${(analysis.chatHistory || []).map(msg => {
          const content = this.formatMessage(msg.content);
          return `
            <div class="modal-message ${msg.role}-message">
              <div class="modal-message-label">${msg.role === 'user' ? 'You' : 'AI Assistant'}</div>
              <div class="modal-message-content">${content}</div>
            </div>
          `;
        }).join('')}
      `;
    }

    // Render insights
    this.renderInsights(analysis.insights || []);

    // Timestamps
    const created = new Date(analysis.createdAt).toLocaleString();
    const updated = new Date(analysis.updatedAt).toLocaleString();
    document.getElementById('modalTimestamps').textContent = `Created: ${created} | Updated: ${updated}`;

    // Hide edit form
    this.hideEditForm();
  }

  renderInsights(insights) {
    const list = document.getElementById('modalInsightsList');
    if (insights.length === 0) {
      list.innerHTML = '<p class="no-insights">No insights yet. Add one below!</p>';
      return;
    }

    list.innerHTML = insights.map(insight => {
      const date = new Date(insight.createdAt).toLocaleString();
      return `
        <div class="insight-item">
          <div class="insight-content">${this.escapeHtml(insight.content)}</div>
          <div class="insight-date">${date}</div>
        </div>
      `;
    }).join('');
  }

  async addInsight() {
    const input = document.getElementById('insightInput');
    const content = input.value.trim();
    if (!content || !this.currentAnalysisId) return;

    try {
      const response = await fetch(`/api/analyses/${this.currentAnalysisId}/insights`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
      });

      if (!response.ok) throw new Error('Failed to add insight');
      const data = await response.json();

      input.value = '';

      // Refresh the modal
      const fullResponse = await fetch(`/api/analyses/${this.currentAnalysisId}`);
      const analysis = await fullResponse.json();
      this.renderInsights(analysis.insights || []);

      // Refresh the cards list
      await this.loadAnalyses();
    } catch (err) {
      console.error('Failed to add insight:', err);
      alert('Failed to add insight');
    }
  }

  showEditForm() {
    const analysis = this.analyses.find(a => a.id === this.currentAnalysisId);
    if (!analysis) return;

    document.getElementById('editTitleInput').value = analysis.title;
    document.getElementById('editCategorySelect').value = analysis.category || 'General';
    document.getElementById('modalEditForm').style.display = 'block';
  }

  hideEditForm() {
    document.getElementById('modalEditForm').style.display = 'none';
  }

  async saveEdit() {
    const title = document.getElementById('editTitleInput').value.trim();
    const category = document.getElementById('editCategorySelect').value;

    if (!title) {
      alert('Title is required');
      return;
    }

    try {
      const response = await fetch(`/api/analyses/${this.currentAnalysisId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, category })
      });

      if (!response.ok) throw new Error('Failed to update');

      this.hideEditForm();
      document.getElementById('modalTitle').textContent = title;
      const badge = document.getElementById('modalCategory');
      badge.textContent = category;
      badge.className = `modal-category-badge ${this.getCategoryClass(category)}`;

      await this.loadAnalyses();
    } catch (err) {
      console.error('Failed to update analysis:', err);
      alert('Failed to update');
    }
  }

  async deleteAnalysis() {
    if (!confirm('Are you sure you want to delete this analysis?')) return;

    try {
      const response = await fetch(`/api/analyses/${this.currentAnalysisId}`, {
        method: 'DELETE'
      });

      if (!response.ok) throw new Error('Failed to delete');

      this.closeModal();
      await this.loadAnalyses();
    } catch (err) {
      console.error('Failed to delete analysis:', err);
      alert('Failed to delete');
    }
  }

  closeModal() {
    document.getElementById('notesModal').style.display = 'none';
    document.body.style.overflow = '';
    this.currentAnalysisId = null;
  }

  formatMessage(content) {
    // Same markdown formatting as chatbot
    let html = content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    html = html.replace(
      /!\[([^\]]*)\]\((https?:\/\/[^\s)]+(?:\.(?:jpg|jpeg|png|gif|webp)))\)/gi,
      '<img src="$2" alt="$1" style="max-width: 100%; height: auto; border-radius: 8px; margin: 8px 0;" />'
    );

    html = html.replace(
      /(https?:\/\/[^\s<]+)/g,
      '<a href="$1" target="_blank" rel="noopener">$1</a>'
    );

    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*]+?)\*/g, '<em>$1</em>');
    html = html.replace(/`([^`]+?)`/g, '<code>$1</code>');
    html = html.replace(/^### (.+?)$/gm, '<h4 style="margin: 8px 0; font-weight: 600;">$1</h4>');
    html = html.replace(/^## (.+?)$/gm, '<h3 style="margin: 8px 0; font-weight: 600;">$1</h3>');
    html = html.replace(/^# (.+?)$/gm, '<h2 style="margin: 8px 0; font-weight: 600;">$1</h2>');
    html = html.replace(/\n/g, '<br>');

    return html;
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.notesPage = new NotesPage();
});
