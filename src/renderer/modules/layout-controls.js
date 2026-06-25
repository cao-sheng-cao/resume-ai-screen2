// layout-controls.js - extracted from renderer.js in v1.0.30 modular refactor.
function setZoomLabel(factor) {
  const btn = $('zoomResetBtn');
  if (btn) btn.textContent = `${Math.round(Number(factor || 1) * 100)}%`;
}

async function adjustZoom(delta) {
  if (!window.resumeApp?.adjustZoom) return;
  const result = await window.resumeApp.adjustZoom(delta);
  setZoomLabel(result?.zoomFactor || 1);
}

async function resetZoom() {
  if (!window.resumeApp?.resetZoom) return;
  const result = await window.resumeApp.resetZoom();
  setZoomLabel(result?.zoomFactor || 1);
}

async function initZoomLabel() {
  try {
    if (window.resumeApp?.getZoom) {
      const result = await window.resumeApp.getZoom();
      setZoomLabel(result?.zoomFactor || 1);
    }
  } catch {
    setZoomLabel(1);
  }
}

function toggleSidebar(force) {
  const shell = document.querySelector('.app-shell');
  if (!shell) return;
  const shouldCollapse = typeof force === 'boolean' ? force : !shell.classList.contains('sidebar-collapsed');
  shell.classList.toggle('sidebar-collapsed', shouldCollapse);
  localStorage.setItem('sidebarCollapsed', shouldCollapse ? '1' : '0');
}

function toggleSetupSection(sectionId, force) {
  const section = $(sectionId);
  if (!section) return;
  const shouldCollapse = typeof force === 'boolean' ? force : !section.classList.contains('setup-collapsed');
  section.classList.toggle('setup-collapsed', shouldCollapse);
  const btn = sectionId === 'key' ? $('toggleKeySectionBtn') : $('toggleStandardSectionBtn');
  if (btn) btn.textContent = shouldCollapse ? '展开设置' : '收起设置';
  localStorage.setItem(`${sectionId}SetupCollapsed`, shouldCollapse ? '1' : '0');
}

function initLayoutControls() {
  toggleSidebar(localStorage.getItem('sidebarCollapsed') === '1');
  toggleSetupSection('key', localStorage.getItem('keySetupCollapsed') === '1');
  toggleSetupSection('standard', localStorage.getItem('standardSetupCollapsed') === '1');
  initZoomLabel();

  window.addEventListener('keydown', async (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      await adjustZoom(0.1);
    } else if (event.key === '-' || event.key === '_') {
      event.preventDefault();
      await adjustZoom(-0.1);
    } else if (event.key === '0') {
      event.preventDefault();
      await resetZoom();
    }
  });

  window.addEventListener('wheel', async (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    await adjustZoom(event.deltaY < 0 ? 0.1 : -0.1);
  }, { passive: false });
}
