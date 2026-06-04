const fs = require('fs');
const path = require('path');

const appJs = fs.readFileSync(path.join(__dirname, 'public/js/app.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, 'public/css/style.css'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

console.log('--- UI STATIC VERIFICATION ---');
assert(!/\balert\s*\(/.test(appJs), 'Browser alert() calls must not be used for workflow feedback.');
assert(appJs.includes('setupFileDropZones'), 'Drag/drop setup function missing.');
assert(appJs.includes("zone.addEventListener('drop'"), 'Drop event listener missing.');
assert(appJs.includes('DataTransfer'), 'Dropped files are not transferred into file input state.');
assert(appJs.includes('/api/integrations/status'), 'Integration status endpoint is not wired in UI.');
assert(appJs.includes('drawDesignOnCanvas'), 'AI image preview renderer missing.');
assert(!appJs.includes('draw' + 'Asset' + 'Layer'), 'Legacy asset drawing helper must not exist.');
assert(!appJs.includes('layout' + 'Schema'), 'Frontend must not depend on legacy image-construction schemas.');
assert(css.includes('.file-upload-zone.drag-over'), 'Drag-over CSS state missing.');
assert(css.includes('.toast-region'), 'Toast feedback CSS missing.');
assert(css.includes('.integration-status-panel'), 'Integration status CSS missing.');
console.log('✔ UI has no alert() calls, drag/drop wiring, toast feedback, integration status, and no legacy asset drawing helper.');
