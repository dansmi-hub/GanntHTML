/*
 * Export: SVG file, high-resolution PNG, and PNG to clipboard.
 * All done in the browser — the SVG is rasterised onto a local canvas.
 */
(function (global) {
  'use strict';
  const RM = global.RM;

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function svgBlob(svg) {
    return new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n', svg], { type: 'image/svg+xml;charset=utf-8' });
  }

  function exportSVG(svg, filename) {
    download(svgBlob(svg), filename || 'roadmap.svg');
  }

  /** Rasterise an SVG string to a PNG Blob at `scale` x its natural size. */
  function toPNGBlob(svg, width, height, scale) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(width * scale);
          canvas.height = Math.round(height * scale);
          const c = canvas.getContext('2d');
          c.imageSmoothingQuality = 'high';
          c.drawImage(img, 0, 0, canvas.width, canvas.height);
          canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png');
        } catch (e) { reject(e); }
      };
      img.onerror = () => reject(new Error('Could not rasterise the SVG'));
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
  }

  async function exportPNG(svg, width, height, scale, filename) {
    const blob = await toPNGBlob(svg, width, height, scale);
    download(blob, filename || 'roadmap.png');
  }

  async function copyPNG(svg, width, height, scale) {
    if (!navigator.clipboard || !global.ClipboardItem) throw new Error('Clipboard images are not supported in this browser');
    // Passing a promise keeps Safari happy (user-gesture requirement)
    const item = new ClipboardItem({ 'image/png': toPNGBlob(svg, width, height, scale) });
    await navigator.clipboard.write([item]);
  }

  RM.exporter = { exportSVG, exportPNG, copyPNG, toPNGBlob };
})(window);
