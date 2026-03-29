/**
 * Live updates UI module
 * Handles displaying and updating live badges on meets
 */

class LiveUpdatesUI {
  constructor() {
    this.activeMeetIds = new Set();
    this.meetElements = new Map();
    this.setupWebSocketListeners();
  }

  /**
   * Setup WebSocket event listeners
   */
  setupWebSocketListeners() {
    // Initial data from server
    wsClient.on('initialData', (data) => {
      this.updateActiveMeets(data);
    });

    // Periodic meets updates
    wsClient.on('meetsUpdate', (data) => {
      this.updateActiveMeets(data);
    });

    // Full data refresh
    wsClient.on('dataRefreshed', (data) => {
      if (data.meets) {
        this.updateActiveMeets(data.meets);
      }
    });

    // Connection status
    wsClient.on('connected', () => {
      this.showConnectionStatus('Connected', 'connected');
    });

    wsClient.on('disconnected', () => {
      this.showConnectionStatus('Disconnected', 'disconnected');
    });

    wsClient.on('error', () => {
      this.showConnectionStatus('Connection Error', 'error');
    });
  }

  /**
   * Update which meets are currently active
   */
  updateActiveMeets(meets) {
    // Clear previous active meets
    this.activeMeetIds.clear();
    
    if (!Array.isArray(meets)) return;
    
    // Mark meets from the past week as active
    const now = new Date();
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    meets.forEach(meet => {
      try {
        const meetDate = new Date(meet.date);
        if (meetDate >= oneWeekAgo) {
          this.activeMeetIds.add(meet.id);
        }
      } catch (e) {
        // Invalid date, skip
      }
    });
    
    // Update UI for all meet cards
    this.updateMeetIndicators();
  }

  /**
   * Update live indicators on all meet cards
   */
  updateMeetIndicators() {
    const meetCards = document.querySelectorAll('[data-meet-id]');
    
    meetCards.forEach(card => {
      const meetId = card.getAttribute('data-meet-id');
      const isActive = this.activeMeetIds.has(meetId);
      
      this.updateMeetCard(card, isActive);
    });
  }

  /**
   * Update a specific meet card with live indicator
   */
  updateMeetCard(card, isActive) {
    let liveBadge = card.querySelector('.live-badge');
    
    if (isActive) {
      if (!liveBadge) {
        liveBadge = document.createElement('div');
        liveBadge.className = 'live-badge';
        liveBadge.innerHTML = '<span class="live-pulse"></span> LIVE';
        
        // Insert at the beginning of the card
        const firstChild = card.firstChild;
        if (firstChild) {
          card.insertBefore(liveBadge, firstChild);
        } else {
          card.appendChild(liveBadge);
        }
      }
      
      card.classList.add('is-live');
    } else {
      if (liveBadge) {
        liveBadge.remove();
      }
      card.classList.remove('is-live');
    }
  }

  /**
   * Show connection status indicator
   */
  showConnectionStatus(status, type) {
    // Try to find or create a connection status indicator
    let statusEl = document.querySelector('.ws-status-indicator');
    
    if (!statusEl) {
      statusEl = document.createElement('div');
      statusEl.className = 'ws-status-indicator';
      document.body.appendChild(statusEl);
    }
    
    statusEl.className = `ws-status-indicator ws-status-${type}`;
    statusEl.innerHTML = `<span class="status-dot"></span> ${status}`;
    
    // Auto-hide after 3 seconds for temporary messages
    if (type === 'disconnected' || type === 'error') {
      setTimeout(() => {
        if (wsClient.isConnected()) {
          statusEl.style.display = 'none';
        }
      }, 3000);
    } else {
      statusEl.style.display = 'block';
    }
  }

  /**
   * Register a meet card for live updates
   * Call this when a new meet card is added to the DOM
   */
  registerMeetCard(meetElement) {
    const meetId = meetElement.getAttribute('data-meet-id');
    if (meetId) {
      this.meetElements.set(meetId, meetElement);
      
      // Check if this meet should have a live indicator
      const isActive = this.activeMeetIds.has(meetId);
      this.updateMeetCard(meetElement, isActive);
    }
  }

  /**
   * Get live indicator HTML for a meet
   */
  getLiveIndicatorHTML(meetId) {
    if (this.activeMeetIds.has(meetId)) {
      return '<div class="live-badge"><span class="live-pulse"></span> LIVE</div>';
    }
    return '';
  }

  /**
   * Check if a meet is live
   */
  isMeetLive(meetId) {
    return this.activeMeetIds.has(meetId);
  }
}

// Create singleton instance
const liveUI = new LiveUpdatesUI();
