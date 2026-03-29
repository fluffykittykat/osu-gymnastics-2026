/**
 * Export utilities for athlete comparison data
 * Handles CSV and PDF generation for comparison exports
 */

const Papa = require('papaparse');
const PDFDocument = require('pdfkit');

/**
 * Generate CSV data for athlete comparison
 * @param {Object} athlete1 - First athlete stats object
 * @param {Object} athlete2 - Second athlete stats object
 * @param {string} name1 - Name of athlete 1
 * @param {string} name2 - Name of athlete 2
 * @returns {string} CSV string
 */
function generateComparisonCSV(athlete1, athlete2, name1, name2) {
  const events = ['vault', 'bars', 'beam', 'floor'];
  const eventNames = {
    vault: 'Vault',
    bars: 'Bars',
    beam: 'Beam',
    floor: 'Floor'
  };

  // Build CSV data
  const csvData = [];
  
  // Header
  csvData.push(['Athlete Comparison Report']);
  csvData.push([]);
  csvData.push(['Athlete 1', name1]);
  csvData.push(['Athlete 2', name2]);
  csvData.push([]);
  
  // Event Statistics
  csvData.push(['Event', 'Metric', name1, name2]);
  
  events.forEach(event => {
    const a1Event = athlete1[event] || {};
    const a2Event = athlete2[event] || {};
    
    csvData.push([eventNames[event], 'Average', 
      a1Event.avg != null ? a1Event.avg.toFixed(3) : '', 
      a2Event.avg != null ? a2Event.avg.toFixed(3) : ''
    ]);
    
    csvData.push(['', 'Best', 
      a1Event.best != null ? a1Event.best.toFixed(3) : '', 
      a2Event.best != null ? a2Event.best.toFixed(3) : ''
    ]);
    
    csvData.push(['', 'Appearances', 
      a1Event.scores ? a1Event.scores.length : 0,
      a2Event.scores ? a2Event.scores.length : 0
    ]);
    
    if (a1Event.scores && a2Event.scores) {
      csvData.push(['', 'Std Dev',
        a1Event.stddev != null ? a1Event.stddev.toFixed(3) : '',
        a2Event.stddev != null ? a2Event.stddev.toFixed(3) : ''
      ]);
    }
  });
  
  // All-Around Summary
  csvData.push([]);
  csvData.push(['All-Around Summary', 'Metric', name1, name2]);
  
  const a1AA = athlete1.aa || {};
  const a2AA = athlete2.aa || {};
  
  if (a1AA.avg != null || a2AA.avg != null) {
    csvData.push(['', 'AA Average',
      a1AA.avg != null ? a1AA.avg.toFixed(3) : '',
      a2AA.avg != null ? a2AA.avg.toFixed(3) : ''
    ]);
  }
  
  if (a1AA.best != null || a2AA.best != null) {
    csvData.push(['', 'AA Best',
      a1AA.best != null ? a1AA.best.toFixed(3) : '',
      a2AA.best != null ? a2AA.best.toFixed(3) : ''
    ]);
  }
  
  // Convert to CSV format
  return Papa.unparse(csvData);
}

/**
 * Generate PDF document for athlete comparison
 * @param {Object} athlete1 - First athlete stats object
 * @param {Object} athlete2 - Second athlete stats object
 * @param {string} name1 - Name of athlete 1
 * @param {string} name2 - Name of athlete 2
 * @param {string} photo1 - Photo URL or path for athlete 1
 * @param {string} photo2 - Photo URL or path for athlete 2
 * @returns {PDFKit.PDFDocument} PDF document
 */
function generateComparisonPDF(athlete1, athlete2, name1, name2, photo1, photo2) {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  
  const events = ['vault', 'bars', 'beam', 'floor'];
  const eventNames = {
    vault: 'Vault',
    bars: 'Bars',
    beam: 'Beam',
    floor: 'Floor'
  };
  
  const colors = {
    primary: '#D84315', // OSU Orange
    secondary: '#1976D2', // Blue
    accent: '#757575'
  };
  
  // Title
  doc.fontSize(24).font('Helvetica-Bold').fillColor(colors.primary);
  doc.text('ATHLETE COMPARISON REPORT', { align: 'center' });
  
  doc.moveDown(0.5);
  doc.fontSize(12).fillColor(colors.accent);
  const today = new Date().toLocaleDateString('en-US', { 
    year: 'numeric', month: 'long', day: 'numeric' 
  });
  doc.text(`Generated: ${today}`, { align: 'center' });
  
  // Athlete headers
  doc.moveDown(1);
  const pageWidth = doc.page.width - 80;
  const colWidth = pageWidth / 2;
  
  doc.fontSize(14).font('Helvetica-Bold');
  
  // Athlete 1 header
  doc.fillColor(colors.primary);
  doc.text(name1, 40, doc.y, { width: colWidth - 10, align: 'left' });
  
  // Athlete 2 header
  doc.fillColor(colors.secondary);
  doc.text(name2, 40 + colWidth, doc.y - 18, { width: colWidth - 10, align: 'right' });
  
  // Event Statistics
  doc.moveDown(2);
  doc.fontSize(11).font('Helvetica-Bold').fillColor('#000');
  doc.text('EVENT STATISTICS', 40, doc.y);
  
  doc.moveTo(40, doc.y + 5).lineTo(pageWidth + 40, doc.y + 5).stroke();
  doc.moveDown(0.8);
  
  events.forEach((event, idx) => {
    const a1Event = athlete1[event] || {};
    const a2Event = athlete2[event] || {};
    
    // Event name
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#000');
    if (idx > 0) doc.moveDown(0.5);
    doc.text(eventNames[event], 40, doc.y);
    
    doc.moveDown(0.4);
    
    // Average
    doc.fontSize(10).font('Helvetica');
    const avg1 = a1Event.avg != null ? a1Event.avg.toFixed(3) : '—';
    const avg2 = a2Event.avg != null ? a2Event.avg.toFixed(3) : '—';
    
    doc.fillColor(colors.primary);
    doc.text(`Average: ${avg1}`, 50, doc.y);
    doc.fillColor(colors.secondary);
    doc.text(`Average: ${avg2}`, 40 + colWidth, doc.y - 15, { align: 'right' });
    
    doc.moveDown(0.4);
    
    // Best
    const best1 = a1Event.best != null ? a1Event.best.toFixed(3) : '—';
    const best2 = a2Event.best != null ? a2Event.best.toFixed(3) : '—';
    
    doc.fillColor(colors.primary);
    doc.text(`Best: ${best1}`, 50, doc.y);
    doc.fillColor(colors.secondary);
    doc.text(`Best: ${best2}`, 40 + colWidth, doc.y - 15, { align: 'right' });
    
    doc.moveDown(0.4);
    
    // Appearances
    const app1 = a1Event.scores ? a1Event.scores.length : 0;
    const app2 = a2Event.scores ? a2Event.scores.length : 0;
    
    doc.fillColor(colors.accent);
    doc.text(`Appearances: ${app1}`, 50, doc.y);
    doc.text(`Appearances: ${app2}`, 40 + colWidth, doc.y - 15, { align: 'right' });
  });
  
  // All-Around Summary
  doc.moveDown(1);
  doc.fontSize(11).font('Helvetica-Bold').fillColor('#000');
  doc.text('ALL-AROUND SUMMARY', 40, doc.y);
  
  doc.moveTo(40, doc.y + 5).lineTo(pageWidth + 40, doc.y + 5).stroke();
  doc.moveDown(0.8);
  
  const a1AA = athlete1.aa || {};
  const a2AA = athlete2.aa || {};
  
  if (a1AA.avg != null || a2AA.avg != null) {
    const aaAvg1 = a1AA.avg != null ? a1AA.avg.toFixed(3) : '—';
    const aaAvg2 = a2AA.avg != null ? a2AA.avg.toFixed(3) : '—';
    
    doc.fontSize(10).font('Helvetica');
    doc.fillColor(colors.primary);
    doc.text(`AA Average: ${aaAvg1}`, 50, doc.y);
    doc.fillColor(colors.secondary);
    doc.text(`AA Average: ${aaAvg2}`, 40 + colWidth, doc.y - 15, { align: 'right' });
  }
  
  if (a1AA.best != null || a2AA.best != null) {
    doc.moveDown(0.4);
    const aaBest1 = a1AA.best != null ? a1AA.best.toFixed(3) : '—';
    const aaBest2 = a2AA.best != null ? a2AA.best.toFixed(3) : '—';
    
    doc.fillColor(colors.primary);
    doc.text(`AA Best: ${aaBest1}`, 50, doc.y);
    doc.fillColor(colors.secondary);
    doc.text(`AA Best: ${aaBest2}`, 40 + colWidth, doc.y - 15, { align: 'right' });
  }
  
  // Footer
  doc.moveDown(2);
  doc.fontSize(8).fillColor(colors.accent);
  doc.text('OSU Gymnastics 2026 — Athlete Comparison Export', { align: 'center' });
  
  return doc;
}

module.exports = {
  generateComparisonCSV,
  generateComparisonPDF
};
