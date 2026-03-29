/**
 * Live Updates Module - WebSocket client for real-time meet score updates
 */

(function () {
  'use strict';

  const LiveUpdates = {
    // Connection state
    ws: null,
    isConnected: false,
    reconnectAttempts: 0,
    maxReconnectAttempts: 10,
    reconnectDelay: 3000,
    reconnectBackoffMultiplier: 1.5,
    messageQueue: [],
    
    // Callbacks
    onConnected: null,
    onDisconnected: null,
    onScoresUpdated: null,
    onConnectionError: null,
    
    /**
     * Initialize WebSocket connection
     */
    init(options = {}) {
      this.onConnected = options.onConnected || (() => {});
      this.onDisconnected = options.onDisconnected || (() => {});
      this.onScoresUpdated = options.onScoresUpdated || (() => {});
      this.onConnectionError = options.onConnectionError || (() => {});
      
      this.connect();
    },
    
    /**
     * Establish WebSocket connection
     */
    connect() {
      try {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const url = `${protocol}//${window.location.host}/ws`;
        
        console.log('[LiveUpdates] Connecting to', url);
        
        this.ws = new WebSocket(url);
        
        this.ws.onopen = () => this.handleOpen();
        this.ws.onmessage = (event) => this.handleMessage(event);
        this.ws.onerror = (error) => this.handleError(error);
        this.ws.onclose = () => this.handleClose();
      } catch (error) {
        console.error('[LiveUpdates] Connection error:', error);
        this.scheduleReconnect();
      }
    },
    
    /**
     * Handle successful connection
     */
    handleOpen() {
      console.log('[LiveUpdates] Connected to server');
      this.isConnected = true;
      this.reconnectAttempts = 0;
      
      // Update UI indicators
      this.updateConnectionIndicator(true);
      
      // Call user callback
      this.onConnected();
      
      // Send queued messages
      this.flushMessageQueue();
      
      // Start keep-alive ping
      this.startKeepAlive();
    },
    
    /**
     * Handle incoming messages
     */
    handleMessage(event) {
      try {
        const message = JSON.parse(event.data);
        
        switch (message.event) {
          case 'connected':
            console.log('[LiveUpdates] Received initial data with', message.meets?.length || 0, 'meets');
            break;
            
          case 'scoresUpdated':
            console.log('[LiveUpdates] Score update received at', new Date(message.timestamp).toLocaleTimeString());
            this.onScoresUpdated(message.meets);
            break;
            
          case 'meetStatus':
            console.log('[LiveUpdates] Meet status update:', message.meetId);
            this.onScoresUpdated(message.meets);
            break;
            
          case 'pong':
            // Keep-alive response, ignore
            break;
            
          default:
            console.log('[LiveUpdates] Unknown message event:', message.event);
        }
      } catch (error) {
        console.error('[LiveUpdates] Error processing message:', error);
      }
    },
    
    /**
     * Handle connection errors
     */
    handleError(error) {
      console.error('[LiveUpdates] WebSocket error:', error);
      this.onConnectionError(error);
      this.updateConnectionIndicator(false);
    },
    
    /**
     * Handle connection close
     */
    handleClose() {
      console.log('[LiveUpdates] Disconnected from server');
      this.isConnected = false;
      this.stopKeepAlive();
      this.updateConnectionIndicator(false);
      
      this.onDisconnected();
      this.scheduleReconnect();
    },
    
    /**
     * Schedule reconnection with exponential backoff
     */
    scheduleReconnect() {
      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        console.error('[LiveUpdates] Max reconnection attempts reached');
        return;
      }
      
      this.reconnectAttempts++;
      const delay = this.reconnectDelay * Math.pow(this.reconnectBackoffMultiplier, this.reconnectAttempts - 1);
      
      console.log(`[LiveUpdates] Reconnecting in ${Math.round(delay / 1000)}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
      
      setTimeout(() => this.connect(), delay);
    },
    
    /**
     * Send message to server
     */
    send(message) {
      if (this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(message));
      } else {
        // Queue message for later
        this.messageQueue.push(message);
      }
    },
    
    /**
     * Flush queued messages
     */
    flushMessageQueue() {
      while (this.messageQueue.length > 0) {
        const message = this.messageQueue.shift();
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify(message));
        }
      }
    },
    
    /**
     * Keep-alive mechanism (ping every 30 seconds)
     */
    keepAliveInterval: null,
    startKeepAlive() {
      this.stopKeepAlive();
      this.keepAliveInterval = setInterval(() => {
        if (this.isConnected) {
          this.send({ type: 'ping', timestamp: new Date().toISOString() });
        }
      }, 30000);
    },
    
    /**
     * Stop keep-alive
     */
    stopKeepAlive() {
      if (this.keepAliveInterval) {
        clearInterval(this.keepAliveInterval);
        this.keepAliveInterval = null;
      }
    },
    
    /**
     * Update connection indicator in UI
     */
    updateConnectionIndicator(connected) {
      const indicator = document.getElementById('liveIndicator');
      if (indicator) {
        if (connected) {
          indicator.classList.add('connected');
          indicator.classList.remove('disconnected');
          indicator.title = 'Live updates connected';
        } else {
          indicator.classList.remove('connected');
          indicator.classList.add('disconnected');
          indicator.title = 'Live updates disconnected - will reconnect automatically';
        }
      }
    },
    
    /**
     * Get connection status
     */
    getStatus() {
      return {
        isConnected: this.isConnected,
        reconnectAttempts: this.reconnectAttempts,
        maxReconnectAttempts: this.maxReconnectAttempts,
      };
    },
    
    /**
     * Disconnect from server
     */
    disconnect() {
      this.stopKeepAlive();
      if (this.ws) {
        this.ws.close();
      }
    },
  };
  
  // Export to global scope
  window.LiveUpdates = LiveUpdates;
  
  console.log('[LiveUpdates] Module loaded');
})();
