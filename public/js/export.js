/**
 * Export functionality for athlete comparisons
 * Handles CSV, PDF exports and share link generation
 */

(function() {
  'use strict';

  /**
   * Export comparison as CSV
   * @param {string} name1 - First athlete name
   * @param {string} name2 - Second athlete name
   */
  window.exportComparisonAsCSV = function(name1, name2) {
    const params = new URLSearchParams({
      a1: name1,
      a2: name2
    });
    
    const url = `/api/export/compare-csv?${params.toString()}`;
    
    try {
      const link = document.createElement('a');
      link.href = url;
      link.download = `comparison_${sanitizeName(name1)}_vs_${sanitizeName(name2)}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showToast('CSV exported successfully', 'success');
    } catch (err) {
      console.error('CSV export failed:', err);
      showToast('Failed to export CSV', 'error');
    }
  };

  /**
   * Export comparison as PDF
   * @param {string} name1 - First athlete name
   * @param {string} name2 - Second athlete name
   */
  window.exportComparisonAsPDF = function(name1, name2) {
    const params = new URLSearchParams({
      a1: name1,
      a2: name2
    });
    
    const url = `/api/export/compare-pdf?${params.toString()}`;
    
    try {
      const link = document.createElement('a');
      link.href = url;
      link.download = `comparison_${sanitizeName(name1)}_vs_${sanitizeName(name2)}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showToast('PDF exported successfully', 'success');
    } catch (err) {
      console.error('PDF export failed:', err);
      showToast('Failed to export PDF', 'error');
    }
  };

  /**
   * Generate shareable comparison link
   * @param {string} name1 - First athlete name
   * @param {string} name2 - Second athlete name
   * @returns {string} Shareable URL
   */
  window.generateComparisonShareLink = function(name1, name2) {
    const baseUrl = window.location.origin;
    return `${baseUrl}/?compare=${encodeURIComponent(name1)}&with=${encodeURIComponent(name2)}`;
  };

  /**
   * Copy share link to clipboard (or use native share if available)
   * @param {string} name1 - First athlete name
   * @param {string} name2 - Second athlete name
   */
  window.copyComparisonShareLink = function(name1, name2) {
    const url = generateComparisonShareLink(name1, name2);
    
    // Try native share API first
    if (navigator.share) {
      navigator.share({
        title: `${name1} vs ${name2}`,
        text: 'Compare OSU Gymnastics athletes',
        url: url
      }).catch(err => console.log('Share cancelled:', err));
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
      // Fallback: copy to clipboard
      navigator.clipboard.writeText(url).then(() => {
        showToast('✅ Share link copied to clipboard', 'success');
      }).catch(err => {
        console.error('Failed to copy link:', err);
        fallbackCopyToClipboard(url);
      });
    } else {
      // Oldest fallback for browsers without clipboard API
      fallbackCopyToClipboard(url);
    }
  };

  /**
   * Fallback copy to clipboard for older browsers
   * @param {string} text - Text to copy
   */
  function fallbackCopyToClipboard(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    
    try {
      document.execCommand('copy');
      showToast('Share link copied to clipboard', 'success');
    } catch (err) {
      console.error('Fallback copy failed:', err);
      showToast('Failed to copy link', 'error');
    }
    
    document.body.removeChild(textarea);
  }

  /**
   * Sanitize athlete names for filenames
   * @param {string} name - Name to sanitize
   * @returns {string} Sanitized name
   */
  function sanitizeName(name) {
    return name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  }

  /**
   * Show toast notification (if available from main app)
   * @param {string} message - Message to display
   * @param {string} type - Type of toast (success, error, info, default)
   */
  function showToast(message, type = 'default') {
    if (typeof window.showToast === 'function') {
      window.showToast(message, type);
    } else if (window.top.showToast && typeof window.top.showToast === 'function') {
      window.top.showToast(message, type);
    } else {
      console.log(`Toast [${type}]: ${message}`);
    }
  }

  /**
   * Load comparison from URL parameters
   * Called on page load to restore comparison state from share link
   */
  window.loadComparisonFromURL = function() {
    const params = new URLSearchParams(window.location.search);
    const a1 = params.get('compare');
    const a2 = params.get('with');
    
    // URLSearchParams.get() returns already-decoded values, no need for decodeURIComponent
    if (a1 && a2) {
      try {
        // Trigger comparison view with these athletes
        if (typeof window.triggerComparison === 'function') {
          window.triggerComparison(a1, a2);
        }
      } catch (err) {
        console.error('Failed to load comparison from URL:', err);
      }
    }
  };

})();
