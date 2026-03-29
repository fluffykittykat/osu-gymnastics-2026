/**
 * WebSocket client for real-time meet score updates
 * Handles connection, reconnection, and message broadcasting
 */

class WebSocketClient {
  constructor() {
    this.ws = null;
    this.url = this.getWebSocketURL();
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 3000; // Start with 3 seconds
    this.listeners = new Map();
    this.isManuallyDisconnected = false;
    this.pendingSubscriptions = new Set();
  }

  /**
   * Get the WebSocket URL based on the current location
   */
  getWebSocketURL() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}`;
  }

  /**
   * Connect to the WebSocket server
   */
  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      console.log('WebSocket already connected or connecting');
      return;
    }

    this.isManuallyDisconnected = false;

    try {
      this.ws = new WebSocket(this.url);

      this.ws.addEventListener('open', () => this.onOpen());
      this.ws.addEventListener('message', (event) => this.onMessage(event));
      this.ws.addEventListener('close', () => this.onClose());
      this.ws.addEventListener('error', (event) => this.onError(event));
    } catch (error) {
      console.error('Failed to create WebSocket:', error);
      this.scheduleReconnect();
    }
  }

  /**
   * Handle WebSocket connection open
   */
  onOpen() {
    console.log('📡 WebSocket connected');
    this.reconnectAttempts = 0;
    this.reconnectDelay = 3000;
    
    // Notify listeners
    this.emit('connected');
    
    // Resubscribe to any pending subscriptions
    this.pendingSubscriptions.forEach(meetId => {
      this.subscribeMeet(meetId);
    });
  }

  /**
   * Handle incoming WebSocket messages
   */
  onMessage(event) {
    try {
      const message = JSON.parse(event.data);
      console.log('📨 WebSocket message:', message.type);
      
      // Emit event based on message type
      this.emit(message.type, message.data);
      
      // Also emit a generic 'message' event
      this.emit('message', message);
    } catch (error) {
      console.error('Failed to parse WebSocket message:', error);
    }
  }

  /**
   * Handle WebSocket close
   */
  onClose() {
    console.log('📡 WebSocket disconnected');
    this.emit('disconnected');
    
    if (!this.isManuallyDisconnected) {
      this.scheduleReconnect();
    }
  }

  /**
   * Handle WebSocket errors
   */
  onError(event) {
    console.error('📡 WebSocket error:', event);
    this.emit('error', event);
  }

  /**
   * Schedule a reconnection attempt
   */
  scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.warn('⚠️  Max reconnection attempts reached');
      this.emit('maxReconnectAttemptsReached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1); // Exponential backoff
    console.log(`📡 Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    
    setTimeout(() => this.connect(), delay);
  }

  /**
   * Subscribe to updates for a specific meet
   */
  subscribeMeet(meetId) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'subscribeMeet',
        meetId: meetId
      }));
    } else {
      // Queue subscription for when connection is established
      this.pendingSubscriptions.add(meetId);
    }
  }

  /**
   * Register an event listener
   */
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  /**
   * Remove an event listener
   */
  off(event, callback) {
    if (!this.listeners.has(event)) return;
    const callbacks = this.listeners.get(event);
    const index = callbacks.indexOf(callback);
    if (index > -1) {
      callbacks.splice(index, 1);
    }
  }

  /**
   * Emit an event to all registered listeners
   */
  emit(event, data) {
    if (!this.listeners.has(event)) return;
    const callbacks = this.listeners.get(event);
    callbacks.forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error(`Error in event listener for '${event}':`, error);
      }
    });
  }

  /**
   * Disconnect from the WebSocket server
   */
  disconnect() {
    this.isManuallyDisconnected = true;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Get connection status
   */
  isConnected() {
    return this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Get connection state as a string
   */
  getState() {
    if (!this.ws) return 'CLOSED';
    const states = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'];
    return states[this.ws.readyState];
  }
}

// Create a singleton instance
const wsClient = new WebSocketClient();

// Auto-connect on page load if not in a restricted context
if (typeof window !== 'undefined' && document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    wsClient.connect();
  });
} else if (typeof window !== 'undefined') {
  wsClient.connect();
}
