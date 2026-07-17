/** Self-contained, sandboxed local viewer for immutable prototype versions. */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildViewerShell(input: {
  title: string;
  intent: string;
  plan: string;
  slug: string;
}): string {
  const title = escapeHtml(input.title);
  const intent = escapeHtml(input.intent);
  const plan = escapeHtml(input.plan);
  const slug = escapeHtml(input.slug);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
:root{color-scheme:dark;--bg:#0f0f0f;--surface:#1a1a1a;--surface2:#222;--border:#303030;--text:#f5f5f5;--muted:#999;--accent:#00d4aa;--warn:#d4a72c;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);min-height:100vh}.viewer{max-width:1080px;margin:auto;background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden}.header{min-height:54px;padding:9px 16px;display:flex;align-items:center;gap:12px;border-bottom:1px solid var(--border)}.meta{min-width:0}.meta h1,.meta p{margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.meta h1{font-size:14px}.meta p{color:var(--muted);font-size:12px}.grow{flex:1}.status{display:flex;gap:6px;align-items:center;font-size:12px;white-space:nowrap}.dot{width:7px;height:7px;border-radius:50%;background:var(--accent)}.disconnected .dot{background:var(--warn)}.versions{display:flex;border:1px solid var(--border);border-radius:7px;padding:2px;max-width:320px;overflow:auto}.versions button,.button{border:0;border-radius:5px;background:transparent;color:var(--muted);padding:5px 10px;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;cursor:pointer}.versions button:hover,.versions button.active{background:var(--surface2);color:var(--text)}.versions button.latest{color:var(--accent)}.button{font-family:inherit;color:var(--text);background:var(--surface2);border:1px solid var(--border);border-radius:7px}.button.live{color:var(--accent);border-color:rgba(0,212,170,.4)}.notice{display:none;gap:10px;align-items:center;padding:7px 16px;border-bottom:1px solid rgba(212,167,44,.25);background:var(--surface2);color:var(--warn);font-size:12px}.notice.show{display:flex}.notice button{margin-left:auto;color:var(--text);background:none;border:0;text-decoration:underline;cursor:pointer}.stage{position:relative;height:calc(100vh - 190px);min-height:420px;background:#fafafa}.stage iframe{display:block;width:100%;height:100%;border:0}.toast{position:absolute;left:50%;bottom:16px;transform:translateX(-50%);padding:7px 14px;border:1px solid var(--border);border-radius:7px;background:var(--surface);opacity:0;transition:opacity .15s;pointer-events:none}.toast.show{opacity:1}.feedback{display:none;border-top:1px solid var(--border);padding:14px 16px}.feedback.open{display:block}.feedback label{display:block;margin-bottom:6px;color:var(--muted);font-size:12px}.feedback textarea{width:100%;min-height:70px;resize:vertical;padding:9px;border:1px solid var(--border);border-radius:7px;background:var(--bg);color:var(--text);font:13px/1.5 inherit}.actions{display:flex;align-items:center;gap:10px;margin-top:10px}.copied{color:var(--accent);font-size:12px;opacity:0}.copied.show{opacity:1}.hint{margin-left:auto;color:var(--muted);font:12px ui-monospace,SFMono-Regular,Menlo,monospace}@media(max-width:800px){.header{flex-wrap:wrap}.meta{width:100%}.grow{display:none}.stage{height:520px}.intent{display:none}}
</style>
</head>
<body data-plan="${plan}" data-slug="${slug}">
<main class="viewer">
<header class="header">
<div class="meta"><h1 id="title">${title}</h1><p class="intent" id="intent">${intent}</p></div>
<div class="grow"></div>
<div class="status" id="status"><span class="dot"></span><span id="status-text">Loading</span></div>
<nav class="versions" id="versions" aria-label="Prototype versions"></nav>
<button class="button live" id="live" type="button">Live updates</button>
<button class="button" id="feedback-button" type="button">Give feedback</button>
</header>
<div class="notice" id="notice"><span id="notice-text"></span><button id="notice-action" type="button"></button></div>
<div class="stage"><iframe id="frame" title="Prototype preview" sandbox="allow-scripts allow-forms allow-modals allow-downloads" allow="clipboard-write"></iframe><div class="toast" id="toast"></div></div>
<section class="feedback" id="feedback"><label for="notes">Feedback for the agent — copied text includes the version you are reviewing</label><textarea id="notes" placeholder="Describe what should change."></textarea><div class="actions"><button class="button" id="copy" type="button">Copy for pi</button><span class="copied" id="copied">Copied — paste it into the pi session</span><span class="hint" id="context"></span></div></section>
</main>
<script>
(() => {
  const $ = (id) => document.getElementById(id);
  const frame = $('frame');
  const versions = $('versions');
  const status = $('status');
  const statusText = $('status-text');
  const notice = $('notice');
  const noticeText = $('notice-text');
  const noticeAction = $('notice-action');
  const liveButton = $('live');
  const feedback = $('feedback');
  const notes = $('notes');
  const copied = $('copied');
  const context = $('context');
  const toastElement = $('toast');
  const plan = document.body.dataset.plan;
  const slug = document.body.dataset.slug;
  let manifest;
  let current;
  let live = true;
  let connected = true;
  let pausedReadyVersion;
  let toastTimer;

  function toast(text) {
    toastElement.textContent = text;
    toastElement.classList.add('show');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toastElement.classList.remove('show'), 1800);
  }

  function latest() {
    return manifest.latest_version;
  }

  function render() {
    if (!manifest || !current) return;
    $('title').textContent = manifest.title;
    const currentVersion = manifest.versions.find((entry) => entry.version === current);
    $('intent').textContent = currentVersion ? currentVersion.intent : '';
    versions.replaceChildren();
    for (const entry of manifest.versions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'v' + entry.version;
      button.title = entry.intent;
      button.classList.toggle('active', entry.version === current);
      button.classList.toggle('latest', entry.version === latest());
      button.addEventListener('click', () => {
        current = entry.version;
        pausedReadyVersion = undefined;
        render();
      });
      versions.append(button);
    }
    const nextSrc = './v/' + current;
    if (frame.getAttribute('src') !== nextSrc) frame.src = nextSrc;
    const viewingHistory = current !== latest();
    const pausedReady = !live && pausedReadyVersion === latest();
    status.classList.toggle('disconnected', !connected);
    statusText.textContent = !connected ? 'Disconnected · v' + current : pausedReady || !viewingHistory ? live ? 'Live · v' + current : 'Paused · v' + current : 'Snapshot · v' + current;
    liveButton.textContent = live ? 'Live updates' : 'Updates paused';
    liveButton.classList.toggle('live', live);
    notice.classList.toggle('show', viewingHistory);
    if (pausedReady) {
      noticeText.textContent = 'v' + latest() + ' is ready.';
      noticeAction.textContent = 'Show v' + latest();
    } else if (viewingHistory) {
      noticeText.textContent = 'Viewing an immutable snapshot. Live updates wait while you look back.';
      noticeAction.textContent = 'Jump to v' + latest();
    }
    noticeAction.onclick = () => {
      current = latest();
      pausedReadyVersion = undefined;
      render();
    };
    context.textContent = 're: prototype v' + current;
  }

  async function refresh(fromVersionEvent) {
    const previousLatest = manifest && manifest.latest_version;
    const response = await fetch('./manifest.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('manifest unavailable');
    manifest = await response.json();
    if (!current) current = latest();
    if (fromVersionEvent && current === previousLatest) {
      if (live) current = latest();
      else pausedReadyVersion = latest();
    }
    render();
    if (fromVersionEvent) toast(live && current === latest() ? 'Updated in place to v' + latest() : 'v' + latest() + ' is ready');
  }

  liveButton.addEventListener('click', () => {
    live = !live;
    if (live) pausedReadyVersion = undefined;
    render();
  });
  $('feedback-button').addEventListener('click', () => {
    feedback.classList.toggle('open');
    if (feedback.classList.contains('open')) notes.focus();
  });
  $('copy').addEventListener('click', async () => {
    const text = 'Prototype feedback [' + slug + ' v' + current + ', plan ' + plan + ']:\\n' + notes.value.trim();
    try { await navigator.clipboard.writeText(text); } catch { /* The visible feedback still lets the user retry. */ }
    copied.classList.add('show');
    window.setTimeout(() => copied.classList.remove('show'), 1800);
  });
  document.addEventListener('keydown', (event) => {
    if (event.target === notes || !manifest) return;
    if (event.key === '[' && current > 1) { current -= 1; render(); }
    if (event.key === ']' && current < latest()) { current += 1; render(); }
  });

  const events = new EventSource('./events');
  events.onopen = () => { connected = true; render(); };
  events.onerror = () => { connected = false; render(); };
  events.addEventListener('version', () => { refresh(true).catch(() => { connected = false; render(); }); });
  refresh(false).catch(() => { connected = false; statusText.textContent = 'Disconnected'; });
})();
</script>
</body>
</html>`;
}
