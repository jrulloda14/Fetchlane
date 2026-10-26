/* Fetchlane design system — reference renderer (vanilla JS, no dependencies).
   window.Fetchlane exposes the icon set, sample data, formatters, HTML builders for each
   component, and mountApp() which renders the whole working window with live interaction.
   Engineers: treat the builders as the markup + class contract; the app is a behaviour spec. */
(function () {
  var NS = (window.Fetchlane = window.Fetchlane || {});

  /* ---------------- icons: 24-unit grid, 1.6 stroke, round joins; drawn at 16px ---------------- */
  var P = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.4-4.4"/>',
    pause: '<path d="M9 5.5v13M15 5.5v13"/>',
    play: '<path d="M7.5 5.2v13.6a.6.6 0 0 0 .9.5l10.8-6.8a.6.6 0 0 0 0-1L8.4 4.7a.6.6 0 0 0-.9.5z"/>',
    retry: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4h-4"/>',
    restart: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4.5v4h4"/><path d="M12 9v3l2 1.5"/>',
    x: '<path d="m6 6 12 12M18 6 6 18"/>',
    more: '<circle cx="6" cy="12" r=".9" fill="currentColor"/><circle cx="12" cy="12" r=".9" fill="currentColor"/><circle cx="18" cy="12" r=".9" fill="currentColor"/>',
    folder: '<path d="M3.5 7.5V17a1.5 1.5 0 0 0 1.5 1.5h14a1.5 1.5 0 0 0 1.5-1.5V9.5A1.5 1.5 0 0 0 19 8h-7l-2-2.5H5A1.5 1.5 0 0 0 3.5 7z"/>',
    folderOpen: '<path d="M3.5 17V7a1.5 1.5 0 0 1 1.5-1.5h5l2 2.5h6.5A1.5 1.5 0 0 1 20 9.5V11"/><path d="M3.5 17.5 6 11.6a1 1 0 0 1 .9-.6h14a.7.7 0 0 1 .6 1L19 17.7a1.3 1.3 0 0 1-1.2.8H4.3a.7.7 0 0 1-.8-1z"/>',
    open: '<path d="M14 4.5h5.5V10M19.5 4.5l-8 8"/><path d="M17.5 13.5v4.5a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 18V8A1.5 1.5 0 0 1 6 6.5h4.5"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    checkCircle: '<circle cx="12" cy="12" r="8.5"/><path d="m8.3 12.3 2.6 2.6 5-5.3"/>',
    alert: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.8v5M12 16.2v.1"/>',
    warn: '<path d="M10.7 4.6 3.4 17.3a1.5 1.5 0 0 0 1.3 2.2h14.6a1.5 1.5 0 0 0 1.3-2.2L13.3 4.6a1.5 1.5 0 0 0-2.6 0z"/><path d="M12 9.5v4M12 16.6v.1"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 7.9v.1"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    down: '<path d="M12 4.5v12M6.5 11 12 16.5 17.5 11"/><path d="M5 20h14"/>',
    all: '<path d="M8.5 6.5h11M8.5 12h11M8.5 17.5h11"/><path d="M4.5 6.5h.1M4.5 12h.1M4.5 17.5h.1"/>',
    active: '<path d="M12 4v10M7.5 9.5 12 14l4.5-4.5"/><path d="M4.5 17.5v1a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-1"/>',
    queue: '<path d="M4.5 6.5h15M4.5 12h15M4.5 17.5h9"/><path d="m17 15.5 2.5 2-2.5 2"/>',
    done: '<circle cx="12" cy="12" r="8.5"/><path d="m8.3 12.3 2.6 2.6 5-5.3"/>',
    failed: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.8v5M12 16.2v.1"/>',
    sliders: '<path d="M4.5 7h9M17.5 7h2M4.5 17h2M10.5 17h9"/><circle cx="15.5" cy="7" r="2"/><circle cx="8.5" cy="17" r="2"/>',
    trash: '<path d="M5 7h14M10 4.5h4M7 7l.8 11.1a1.5 1.5 0 0 0 1.5 1.4h5.4a1.5 1.5 0 0 0 1.5-1.4L17 7"/>',
    remove: '<path d="M5 7.5h14M5 12h8M5 16.5h6"/><path d="m15.5 14.5 4 4M19.5 14.5l-4 4"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="1.5"/><path d="M15.5 8.5V6A1.5 1.5 0 0 0 14 4.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
    paste: '<rect x="5.5" y="5" width="13" height="15.5" rx="1.5"/><path d="M9 5V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1"/><path d="M9 11h6M9 15h4"/>',
    chevDown: '<path d="m7 10 5 5 5-5"/>',
    chevRight: '<path d="m10 7 5 5-5 5"/>',
    chevUp: '<path d="m7 14 5-5 5 5"/>',
    sortDown: '<path d="M12 5v14M7.5 14.5 12 19l4.5-4.5"/>',
    arrowUp: '<path d="M12 19V5M6.5 10.5 12 5l5.5 5.5"/>',
    arrowDown: '<path d="M12 5v14M6.5 13.5 12 19l5.5-5.5"/>',
    toTop: '<path d="M5.5 4.5h13M12 20V9M7 13.5 12 8.5l5 5"/>',
    comfortable: '<rect x="4.5" y="5" width="15" height="5.5" rx="1"/><rect x="4.5" y="13.5" width="15" height="5.5" rx="1"/>',
    compact: '<path d="M4.5 5.5h15M4.5 10h15M4.5 14.5h15M4.5 19h15"/>',
    drive: '<rect x="3.5" y="13" width="17" height="6" rx="1.5"/><path d="M5 13 7.2 6a1.5 1.5 0 0 1 1.4-1h6.8a1.5 1.5 0 0 1 1.4 1L19 13"/><path d="M16.5 16h.1"/>',
    globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.5 3.5 5.3 3.5 8.5s-1.1 6-3.5 8.5c-2.4-2.5-3.5-5.3-3.5-8.5s1.1-6 3.5-8.5z"/>',
    lock: '<rect x="5" y="10.5" width="14" height="9" rx="1.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
    eye: '<path d="M2.8 12S6 5.8 12 5.8 21.2 12 21.2 12 18 18.2 12 18.2 2.8 12 2.8 12z"/><circle cx="12" cy="12" r="2.8"/>',
    grip: '<circle cx="9.5" cy="7" r=".9" fill="currentColor"/><circle cx="14.5" cy="7" r=".9" fill="currentColor"/><circle cx="9.5" cy="12" r=".9" fill="currentColor"/><circle cx="14.5" cy="12" r=".9" fill="currentColor"/><circle cx="9.5" cy="17" r=".9" fill="currentColor"/><circle cx="14.5" cy="17" r=".9" fill="currentColor"/>',
    stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="1.5"/>',
    spinner: '<path d="M12 3.5a8.5 8.5 0 1 1-8.5 8.5" />',
    minimize: '<path d="M7 12h10" stroke-width="1"/>',
    maximize: '<rect x="7" y="7" width="10" height="10" rx="1.5" stroke-width="1"/>',
    close: '<path d="m7.5 7.5 9 9M16.5 7.5l-9 9" stroke-width="1"/>',
    minus: '<path d="M6 12h12"/>',
    mark: '' /* filled below */
  };
  function icon(n, s, cls) {
    s = s || 16;
    return '<svg class="fl-i' + (cls ? ' ' + cls : '') + '" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (P[n] || '') + '</svg>';
  }
  /* Logo mark: a file travelling down a dashed lane into a tray. */
  function mark(s) {
    s = s || 16;
    return '<svg class="fl-i" width="' + s + '" height="' + s + '" viewBox="0 0 32 32" aria-hidden="true">' +
      '<rect width="32" height="32" rx="7" fill="var(--accent)"/>' +
      '<path d="M7 6.5v3M7 12.5v3M25 6.5v3M25 12.5v3" stroke="var(--on-accent)" stroke-width="2" stroke-linecap="round" opacity=".55"/>' +
      '<path d="M12 5.5h5.2L21 9.3V17a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1z" fill="var(--on-accent)"/>' +
      '<path d="M17 5.5v4h4" fill="none" stroke="var(--accent)" stroke-width="1.4" stroke-linejoin="round"/>' +
      '<path d="M6.5 19.5v3.5a2.5 2.5 0 0 0 2.5 2.5h14a2.5 2.5 0 0 0 2.5-2.5v-3.5" fill="none" stroke="var(--on-accent)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>' +
      '</svg>';
  }

  /* ---------------- file type icons: page outline + a small glyph, ink-subtle ---------------- */
  var KIND = { iso: 'disc', img: 'disc', vhdx: 'disc', zip: 'archive', gz: 'archive', '7z': 'archive', exe: 'app', msi: 'app', mp4: 'video', mkv: 'video', wav: 'audio', mp3: 'audio', flac: 'audio', png: 'image', jpg: 'image', tif: 'image', pdf: 'doc', pptx: 'doc', docx: 'doc', csv: 'data', parquet: 'data', json: 'data' };
  var GLYPH = {
    disc: '<circle cx="12" cy="15" r="3.6"/><circle cx="12" cy="15" r=".8"/>',
    archive: '<path d="M11 9.5h2M11 12h2M11 14.5h2"/><rect x="10.5" y="16.5" width="3" height="2.5" rx=".5"/>',
    app: '<rect x="8.5" y="12" width="7" height="6" rx="1"/><path d="M8.5 14h7"/>',
    video: '<path d="M10.5 12.3v5.4l4.5-2.7z"/>',
    audio: '<path d="M9 14v3M11 12v7M13 13v5M15 14.5v2"/>',
    image: '<circle cx="10" cy="12.5" r="1.1"/><path d="m8 19 3.2-3.2 1.6 1.6 1.4-1.4L16 18"/>',
    doc: '<path d="M8.5 12h7M8.5 14.5h7M8.5 17h4.5"/>',
    data: '<path d="M8.5 12h7M8.5 15h7M8.5 18h7M11 12v6"/>',
    file: '<path d="M8.5 13h7M8.5 16h5"/>'
  };
  function ext(name) { var m = /\.([a-z0-9]+)$/i.exec(name || ''); return m ? m[1].toLowerCase() : ''; }
  function fileIcon(name, s) {
    var k = KIND[ext(name)] || 'file';
    return '<svg class="fl-ftype" ' + (s ? 'style="width:' + s + 'px;height:' + s + 'px" ' : '') + 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M6.5 2.8h7.2L18.8 8v12.2a1 1 0 0 1-1 1H6.5a1 1 0 0 1-1-1V3.8a1 1 0 0 1 1-1z"/><path d="M13.5 2.8V8h5.3"/>' + GLYPH[k] + '</svg>';
  }

  /* ---------------- formatting ---------------- */
  var KB = 1024, MB = KB * 1024, GB = MB * 1024;
  function fmtSize(b) {
    if (b == null) return null;
    if (b >= GB) return (b / GB).toFixed(b >= 10 * GB ? 1 : 2) + ' GB';
    if (b >= MB) return (b / MB).toFixed(b >= 100 * MB ? 0 : 1) + ' MB';
    if (b >= KB) return Math.round(b / KB) + ' KB';
    return b + ' B';
  }
  function unit(b) { return b >= GB ? 'GB' : b >= MB ? 'MB' : b >= KB ? 'KB' : 'B'; }
  function num(b, u) { var d = { GB: GB, MB: MB, KB: KB, B: 1 }[u]; var v = b / d; return u === 'GB' ? v.toFixed(2) : u === 'MB' ? v.toFixed(v >= 100 ? 0 : 1) : Math.round(v) + ''; }
  /* "3.68 / 5.91 GB" when units match, "152 MB / 1.20 GB" otherwise */
  function fmtPair(done, total) {
    if (total == null) return fmtSize(done) + ' / <span class="fl-na">unknown</span>';
    var u = unit(total), du = unit(done);
    if (u === du) return num(done, u) + ' / ' + num(total, u) + ' ' + u;
    return fmtSize(done) + ' / ' + fmtSize(total);
  }
  function fmtSpeed(bps) { return bps == null ? null : bps >= MB ? (bps / MB).toFixed(1) + ' MB/s' : Math.round(bps / KB) + ' KB/s'; }
  function fmtDur(s, long) {
    if (s == null) return null;
    s = Math.max(0, Math.round(s));
    if (s < 60) return s + ' s';
    var m = Math.floor(s / 60), r = s % 60;
    if (m < 60) return m + ' min' + (long && r ? ' ' + r + ' s' : '');
    var h = Math.floor(m / 60); m = m % 60;
    return h + ' h ' + (m ? m + ' min' : '');
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pct(d) { return d.total ? Math.floor((d.done / d.total) * 100) : null; }

  /* ---------------- sample session ---------------- */
  function sample() {
    return [
      { id: 'ubuntu', name: 'ubuntu-24.04.3-desktop-amd64.iso', host: 'releases.ubuntu.com', url: 'https://releases.ubuntu.com/24.04.3/ubuntu-24.04.3-desktop-amd64.iso', status: 'downloading', done: 3.68 * GB, total: 5.91 * GB, speed: 8.4 * MB, elapsed: 448, started: 'Today, 14:02', folder: 'D:\\Downloads\\ISO', resumable: true },
      { id: 'blender', name: 'blender-4.5.2-windows-x64.msi', host: 'download.blender.org', url: 'https://download.blender.org/release/Blender4.5/blender-4.5.2-windows-x64.msi', status: 'downloading', done: 152 * MB, total: 371 * MB, speed: 6.1 * MB, elapsed: 25, started: 'Today, 14:09', folder: 'D:\\Downloads', resumable: true },
      { id: 'nightly', name: 'nightly-build-20261026.zip', host: 'ci.lanternworks.dev', url: 'https://ci.lanternworks.dev/artifacts/nightly-build-20261026.zip?job=8812&sig=Q2h4bXZ0OHlKaXBtZmd3', status: 'downloading', done: 48.2 * MB, total: null, speed: 3.9 * MB, elapsed: 13, started: 'Today, 14:09', folder: 'D:\\Downloads', resumable: false, note: 'The server didn’t report a file size, so progress and time left can’t be estimated.' },
      { id: 'sentinel', name: 'sentinel2-tile-T51QTV-20261019.tif', host: 'data.openearth-archive.org', url: 'https://data.openearth-archive.org/s2/T51QTV/20261019/tile.tif?X-Amz-Credential=AKIA%2F2026&X-Amz-Signature=9f2c1e', status: 'retrying', done: 1.02 * GB, total: 2.4 * GB, speed: null, elapsed: 391, started: 'Today, 14:01', folder: 'D:\\Data\\Satellite', resumable: true, retryIn: 8, attempt: 2, maxAttempts: 5, reason: 'conn' },
      { id: 'obs', name: 'OBS-Studio-31.1-Windows-x64-Installer.exe', host: 'cdn-fastly.obsproject.com', url: 'https://cdn-fastly.obsproject.com/downloads/OBS-Studio-31.1-Windows-x64-Installer.exe', status: 'paused', done: 58.9 * MB, total: 154 * MB, elapsed: 31, started: 'Today, 13:55', folder: 'D:\\Downloads', resumable: true },
      { id: 'libre', name: 'LibreOffice_25.8.2_Win_x86-64.msi', host: 'download.documentfoundation.org', url: 'https://download.documentfoundation.org/libreoffice/stable/25.8.2/win/x86_64/LibreOffice_25.8.2_Win_x86-64.msi', status: 'queued', pos: 1, done: 0, total: 352 * MB, folder: 'D:\\Downloads' },
      { id: 'podcast', name: 'podcast-ep142-master-48k.wav', host: 'files.harborline-audio.net', url: 'https://files.harborline-audio.net/share/ep142/podcast-ep142-master-48k.wav?token=hb_7Yx2kQpL0s', status: 'queued', pos: 2, done: 0, total: 1.8 * GB, folder: 'D:\\Audio\\Masters' },
      { id: 'traffic', name: 'city-traffic-counts-2025.csv.gz', host: 'data.portmeridian.gov', url: 'https://data.portmeridian.gov/exports/city-traffic-counts-2025.csv.gz', status: 'queued', pos: 3, done: 0, total: null, folder: 'D:\\Data' },
      { id: 'node', name: 'node-v22.20.0-x64.msi', host: 'nodejs.org', url: 'https://nodejs.org/dist/v22.20.0/node-v22.20.0-x64.msi', status: 'queued', pos: 4, done: 0, total: 31.4 * MB, folder: 'D:\\Downloads' },
      { id: 'vhdx', name: 'vm-backup-2026-10-24.vhdx', host: 'files.northgate-it.net', url: 'https://files.northgate-it.net/backups/vm-backup-2026-10-24.vhdx?key=ng_44f1a0c9', status: 'failed', reason: 'disk', done: 2.9 * GB, total: 18.2 * GB, elapsed: 1290, started: 'Today, 12:40', folder: 'D:\\Backups', resumable: true, need: 15.3 * GB, free: 6.1 * GB, drive: 'D:' },
      { id: 'keynote', name: 'conference-keynote-1080p.mp4', host: 'media.summitstream.io', url: 'https://media.summitstream.io/vod/keynote-2026/conference-keynote-1080p.mp4?exp=1793050000&sig=c1a9', status: 'failed', reason: 'noresume', done: 412 * MB, total: 1.2 * GB, elapsed: 214, started: 'Today, 13:20', folder: 'D:\\Videos', resumable: false },
      { id: 'fonts', name: 'font-pack-variable-2026.zip', host: 'assets.typecrate.net', url: 'https://assets.typecrate.net/packs/font-pack-variable-2026.zip', status: 'failed', reason: 'conn', done: 21.6 * MB, total: 88 * MB, elapsed: 96, started: 'Today, 11:52', folder: 'D:\\Downloads', resumable: true, attempt: 5, maxAttempts: 5 },
      { id: 'c1', name: '7z2501-x64.exe', host: 'www.7-zip.org', url: 'https://www.7-zip.org/a/7z2501-x64.exe', status: 'completed', done: 1.6 * MB, total: 1.6 * MB, at: '14:10', day: 'today', elapsed: 2, folder: 'D:\\Downloads' },
      { id: 'c2', name: 'Q3-operations-review.pptx', host: 'share.northgate-it.net', url: 'https://share.northgate-it.net/f/Q3-operations-review.pptx?dl=1&t=ng_77ac', status: 'completed', done: 24.8 * MB, total: 24.8 * MB, at: '13:47', day: 'today', elapsed: 5, folder: 'D:\\Downloads' },
      { id: 'c3', name: 'VSCodeUserSetup-x64-1.105.1.exe', host: 'update.code.visualstudio.com', url: 'https://update.code.visualstudio.com/1.105.1/win32-x64-user/stable', status: 'completed', done: 108 * MB, total: 108 * MB, at: '11:20', day: 'today', elapsed: 14, folder: 'D:\\Downloads' },
      { id: 'c4', name: 'family-reunion-photos.zip', host: 'dl.photovault-share.net', url: 'https://dl.photovault-share.net/s/family-reunion-photos.zip?auth=pv_12ab', status: 'completed', done: 2.3 * GB, total: 2.3 * GB, at: '10:58', day: 'today', elapsed: 252, folder: 'D:\\Pictures', started: 'Today, 10:54' },
      { id: 'c5', name: 'python-3.13.9-amd64.exe', host: 'www.python.org', url: 'https://www.python.org/ftp/python/3.13.9/python-3.13.9-amd64.exe', status: 'completed', done: 27.4 * MB, total: 27.4 * MB, at: '09:31', day: 'today', elapsed: 4, folder: 'D:\\Downloads' },
      { id: 'c6', name: 'invoice-2026-1048.pdf', host: 'billing.lanternworks.dev', url: 'https://billing.lanternworks.dev/invoices/2026-1048.pdf', status: 'completed', done: 214 * KB, total: 214 * KB, at: '09:05', day: 'today', elapsed: 1, folder: 'D:\\Documents' },
      { id: 'y1', name: 'wallpaper-pack-4k.zip', host: 'cdn.palettefield.art', url: 'https://cdn.palettefield.art/packs/wallpaper-pack-4k.zip', status: 'completed', done: 486 * MB, total: 486 * MB, at: '21:14', day: 'yesterday', elapsed: 61, folder: 'D:\\Pictures' },
      { id: 'y2', name: 'driver-pack-2026.10.zip', host: 'support.kestrelboards.com', url: 'https://support.kestrelboards.com/drivers/driver-pack-2026.10.zip', status: 'cancelled', done: 0, total: 640 * MB, at: '18:30', day: 'yesterday', folder: 'D:\\Downloads' },
      { id: 'y3', name: 'Git-2.51.1-64-bit.exe', host: 'github.com', url: 'https://github.com/git-for-windows/git/releases/download/v2.51.1.windows.1/Git-2.51.1-64-bit.exe', status: 'completed', done: 66.8 * MB, total: 66.8 * MB, at: '16:02', day: 'yesterday', elapsed: 9, folder: 'D:\\Downloads' },
      { id: 'y4', name: 'field-survey-scan-0412.png', host: 'files.northgate-it.net', url: 'https://files.northgate-it.net/scans/field-survey-scan-0412.png', status: 'completed', done: 3.2 * MB, total: 3.2 * MB, at: '15:47', day: 'yesterday', elapsed: 1, folder: 'D:\\Pictures' },
      { id: 'y5', name: 'transit-ridership-2025.parquet', host: 'data.portmeridian.gov', url: 'https://data.portmeridian.gov/exports/transit-ridership-2025.parquet', status: 'completed', done: 912 * MB, total: 912 * MB, at: '10:15', day: 'yesterday', elapsed: 118, folder: 'D:\\Data' }
    ];
  }
  var OLDER = 16; /* completed history entries collapsed under "Earlier" */

  /* ---------------- status + progress ---------------- */
  var ST = {
    downloading: { label: 'Downloading', icon: 'down' },
    queued: { label: 'Queued', icon: 'clock' },
    paused: { label: 'Paused', icon: 'pause' },
    retrying: { label: 'Retrying', icon: 'retry' },
    failed: { label: 'Failed', icon: 'alert' },
    completed: { label: 'Completed', icon: 'checkCircle' },
    cancelled: { label: 'Cancelled', icon: 'stop' }
  };
  var REASON = { disk: 'Disk full', noresume: 'Can’t resume', conn: 'Connection lost' };
  function statusText(d, inline) {
    switch (d.status) {
      case 'downloading': return d.total == null ? '<b>Downloading</b><span class="fl-sep"> · </span><span class="fl-detail">size unknown</span>' : '<b>Downloading</b>';
      case 'retrying': return '<b>Retrying in <span class="fl-num" data-m="retry-' + d.id + '">' + d.retryIn + '</span> s</b><span class="fl-sep"> · </span><span class="fl-detail fl-num" title="Attempt ' + d.attempt + ' of ' + d.maxAttempts + '">' + d.attempt + ' of ' + d.maxAttempts + '</span>';
      case 'queued': return '<b>Queued</b>';
      case 'paused': return '<b>Paused</b>';
      case 'failed': return '<b>Failed</b><span class="fl-sep"> · </span><span>' + REASON[d.reason] + '</span>';
      case 'completed': return '<b>Completed</b>' + (d.at ? '<span class="fl-sep"> · </span><span class="fl-detail fl-num">' + (d.day === 'yesterday' ? 'Yesterday ' : '') + d.at + '</span>' : '');
      case 'cancelled': return '<b>Cancelled</b><span class="fl-sep"> · </span><span class="fl-detail">partial file deleted</span>';
    }
  }
  function statusHTML(d) {
    var s = ST[d.status];
    var ic = d.status === 'downloading' && d.total == null ? icon('down', 14) : icon(s.icon, 14);
    return '<span class="fl-status fl-st-' + d.status + '">' + ic + '<span>' + statusText(d) + '</span></span>';
  }
  function barHTML(d, lg) {
    if (d.status === 'completed' || d.status === 'cancelled') return '';
    if (d.status === 'queued') return '';
    var p = pct(d);
    if (p == null) return '<div class="fl-bar fl-bar-ind' + (lg ? ' fl-bar-lg' : '') + '" role="progressbar" aria-label="Downloading, size unknown"><i></i></div>';
    return '<div class="fl-bar is-' + d.status + (lg ? ' fl-bar-lg' : '') + '" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + p + '"><i data-m="bar-' + d.id + '" style="width:' + (d.done / d.total * 100).toFixed(2) + '%"></i></div>';
  }
  function speedCell(d) {
    if (d.status === 'downloading') return '<span class="fl-metric is-strong" data-m="speed-' + d.id + '">' + fmtSpeed(d.speed) + '</span>';
    if (d.status === 'retrying') return '<span class="fl-metric fl-na" title="Waiting to reconnect">—</span>';
    return '';
  }
  function etaCell(d) {
    if (d.status === 'downloading') {
      if (d.total == null) return '<span class="fl-metric fl-na" title="Can’t estimate: the server didn’t report a file size" aria-label="Time left unavailable">—</span>';
      return '<span class="fl-metric" data-m="eta-' + d.id + '">' + fmtDur((d.total - d.done) / d.speed) + '</span>';
    }
    if (d.status === 'retrying') return '<span class="fl-metric fl-na" aria-label="Time left unavailable while reconnecting">—</span>';
    return '';
  }
  function sizeCell(d) {
    if (d.status === 'completed') return '<span class="fl-metric">' + fmtSize(d.total) + '</span>';
    if (d.status === 'cancelled') return '<span class="fl-metric fl-na">' + fmtSize(d.total) + '</span>';
    if (d.status === 'queued') return d.total == null ? '<span class="fl-metric fl-na" title="Known when the download starts">Unknown</span>' : '<span class="fl-metric">' + fmtSize(d.total) + '</span>';
    return '<span class="fl-metric" data-m="size-' + d.id + '">' + fmtPair(d.done, d.total) + '</span>';
  }
  function inlineMetrics(d) { /* used when speed/time columns collapse into the status cell */
    if (d.status !== 'downloading') return '';
    var e = d.total == null ? '' : ' · <span data-m="eta-' + d.id + '">' + fmtDur((d.total - d.done) / d.speed) + '</span> left';
    return '<span class="fl-sep"> · </span><span class="fl-detail fl-num"><span data-m="speed-' + d.id + '">' + fmtSpeed(d.speed) + '</span>' + e + '</span>';
  }

  /* contextual row actions: one primary icon action + overflow */
  function primaryAction(d) {
    switch (d.status) {
      case 'downloading': return d.resumable === false ? { a: 'cancel', icon: 'stop', label: 'Cancel…' } : { a: 'pause', icon: 'pause', label: 'Pause' };
      case 'paused': return { a: 'resume', icon: 'play', label: 'Resume' };
      case 'queued': return { a: 'start', icon: 'play', label: 'Start now' };
      case 'retrying': return { a: 'retrynow', icon: 'retry', label: 'Retry now' };
      case 'failed': return d.reason === 'noresume' ? { a: 'restart', icon: 'restart', label: 'Restart…', text: true } : { a: 'retry', icon: 'retry', label: 'Retry', text: true };
      case 'completed': return { a: 'openfolder', icon: 'folderOpen', label: 'Show in folder' };
      case 'cancelled': return { a: 'restart0', icon: 'retry', label: 'Download again' };
    }
  }
  function actionsHTML(d, compact) {
    var p = primaryAction(d), nm = esc(d.name);
    var h = '<div class="fl-actions">';
    if (p.text && compact === 'icon') h += '<button class="fl-ibtn fl-ibtn-sm" data-a="' + p.a + '" data-id="' + d.id + '" tabindex="-1" title="' + p.label + '" aria-label="' + p.label.replace('…', '') + ' ' + nm + '">' + icon(p.icon) + '</button>';
    else if (p.text) h += '<button class="fl-btn fl-btn-sm" data-a="' + p.a + '" data-id="' + d.id + '" tabindex="-1" aria-label="' + p.label.replace('…', '') + ' ' + nm + '">' + icon(p.icon, 14) + p.label + '</button>';
    else {
      if (d.status === 'completed') h += '<button class="fl-ibtn fl-ibtn-sm fl-hover-only" data-a="openfile" data-id="' + d.id + '" tabindex="-1" title="Open file" aria-label="Open ' + nm + '">' + icon('open') + '</button>';
      h += '<button class="fl-ibtn fl-ibtn-sm fl-hover-only" data-a="' + p.a + '" data-id="' + d.id + '" tabindex="-1" title="' + p.label + '" aria-label="' + p.label + ' ' + nm + '">' + icon(p.icon) + '</button>';
    }
    h += '<button class="fl-ibtn fl-ibtn-sm fl-hover-only" data-a="menu" data-id="' + d.id + '" tabindex="-1" title="More actions" aria-haspopup="menu" aria-label="More actions for ' + nm + '">' + icon('more') + '</button>';
    return h + '</div>';
  }

  /* ---------------- table ---------------- */
  function colsFor(o) {
    var c = ['18px', 'minmax(220px,1fr)'];
    if (o.queueView) c.splice(1, 0, '28px');
    c.push(o.wide ? '248px' : 'minmax(220px,280px)');
    c.push(o.wide ? '128px' : '116px');
    if (o.wide) { c.push('76px', '68px'); }
    c.push(o.hasTextAction ? '100px' : '92px');
    return c.join(' ');
  }
  function theadHTML(o) {
    var h = '<div class="fl-thead" role="row"><div class="fl-th" role="columnheader"><span class="fl-sr">Select</span></div>';
    if (o.queueView) h += '<div class="fl-th r" role="columnheader">#</div>';
    h += '<div class="fl-th' + (o.queueView ? '' : ' is-sorted') + '" role="columnheader" aria-sort="' + (o.queueView ? 'none' : 'descending') + '">' + (o.queueView ? 'Name — in start order' : 'Name') + '</div>';
    h += '<div class="fl-th" role="columnheader">Status</div><div class="fl-th r" role="columnheader">Size</div>';
    if (o.wide) h += '<div class="fl-th r" role="columnheader">Speed</div><div class="fl-th r" role="columnheader">Time left</div>';
    return h + '<div class="fl-th r" role="columnheader"><span class="fl-sr">Actions</span></div></div>';
  }
  function rowHTML(d, o) {
    o = o || {};
    var sel = o.selected, cls = 'fl-row' + (sel ? ' is-selected' : '') + (o.focus ? ' is-focus' : '') + (o.hover ? ' is-hover' : '') + (o.open ? ' is-open' : '');
    var h = '<div class="' + cls + '" role="row" aria-selected="' + (!!sel) + '" data-row="' + d.id + '" tabindex="' + (o.tab ? 0 : -1) + '"' + (o.compact ? ' title="' + esc(d.host) + '"' : '') + '>';
    h += '<div class="fl-cell" role="gridcell"><button class="fl-check' + (sel || o.anySel ? '' : ' fl-hover-only') + '" role="checkbox" aria-checked="' + (!!sel) + '" aria-label="Select ' + esc(d.name) + '" data-a="check" data-id="' + d.id + '" tabindex="-1">' + icon('check', 12) + '</button></div>';
    if (o.queueView) h += '<div class="fl-cell r" role="gridcell"><span class="fl-qpos">' + d.pos + '</span></div>';
    h += '<div class="fl-cell" role="gridcell">' + (o.queueView ? '<span class="fl-grip" title="Drag to reorder">' + icon('grip', 14) + '</span>' : '') + fileIcon(d.name) + '<div class="fl-name"><span class="fl-fn" title="' + esc(d.name) + '">' + esc(d.name) + '</span><span class="fl-host">' + esc(d.host) + '</span></div></div>';
    var st = statusHTML(d);
    if (!o.wide && o.inline !== false) st = st.replace(/<\/span><\/span>$/, inlineMetrics(d) + '</span></span>');
    if (d.status === 'queued' && !o.queueView) st = st.replace('<b>Queued</b>', '<b>Queued</b><span class="fl-sep"> · </span><span class="fl-detail fl-num">#' + d.pos + ' in line</span>');
    var pv = pct(d), showPct = (d.status === 'downloading' || d.status === 'paused' || d.status === 'retrying' || d.status === 'failed') && pv != null;
    h += '<div class="fl-cell" role="gridcell"><div class="fl-statcell" style="flex:1;min-width:0">' +
      '<div style="display:flex;align-items:center;gap:8px;min-width:0">' + st + (showPct && !o.compact ? '<span class="fl-metric" style="margin-left:auto" data-m="pct-' + d.id + '">' + pv + '%</span>' : '') + '</div>' +
      barHTML(d) + '</div></div>';
    h += '<div class="fl-cell r" role="gridcell">' + sizeCell(d) + '</div>';
    if (o.wide) h += '<div class="fl-cell r" role="gridcell">' + speedCell(d) + '</div><div class="fl-cell r" role="gridcell">' + etaCell(d) + '</div>';
    h += '<div class="fl-cell r" role="gridcell">' + actionsHTML(d, o.wide ? '' : 'icon') + '</div>';
    return h + '</div>';
  }

  /* ---------------- details panel ---------------- */
  function redactUrl(u, reveal) {
    var i = u.indexOf('?');
    var base = u.slice(0, i < 0 ? u.length : i).replace(/^https?:\/\//, function (m) { return '<span class="fl-subtle">' + m + '</span>'; });
    if (i < 0) return base;
    if (reveal) return base + '<span class="fl-subtle">' + esc(u.slice(i)) + '</span>';
    var n = u.slice(i + 1).split('&').length;
    return base + '<span class="fl-redact">?' + n + ' hidden parameter' + (n > 1 ? 's' : '') + '</span>';
  }
  function spark() {
    var pts = [5.1, 6.8, 7.4, 6.2, 7.9, 8.8, 8.1, 7.6, 8.9, 9.4, 8.2, 8.6, 8.0, 8.7, 8.4], w = 300, hgt = 48, mx = 10;
    var path = pts.map(function (v, i) { return (i ? 'L' : 'M') + (i * w / (pts.length - 1)).toFixed(1) + ' ' + (hgt - v / mx * hgt).toFixed(1); }).join(' ');
    return '<svg class="fl-spark" viewBox="0 0 300 48" preserveAspectRatio="none" role="img" aria-label="Speed over the last 15 minutes, between 5 and 9.4 MB/s"><line class="gd" x1="0" x2="300" y1="0.5" y2="0.5"/><line class="gd" x1="0" x2="300" y1="24" y2="24"/><path class="ar" d="' + path + ' L300 48 L0 48 Z"/><path class="ln" d="' + path + '" vector-effect="non-scaling-stroke"/></svg>' +
      '<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--ink-subtle)" class="fl-num"><span>15 min ago</span><span>peak 9.4 MB/s</span><span>now</span></div>';
  }
  function explainHTML(d) {
    var e = '';
    if (d.status === 'retrying') e = '<div class="fl-explain is-retry" role="status">' + icon('retry') + '<div><p class="fl-etitle">Connection dropped — retrying automatically</p><p>Fetchlane will reconnect in <span class="fl-num" data-m="retry2-' + d.id + '">' + d.retryIn + '</span> s (attempt ' + d.attempt + ' of ' + d.maxAttempts + '). The ' + fmtSize(d.done) + ' already downloaded is kept.</p></div></div>';
    if (d.status === 'failed' && d.reason === 'conn') e = '<div class="fl-explain is-error" role="alert">' + icon('alert') + '<div><p class="fl-etitle">Connection lost — stopped after ' + d.maxAttempts + ' attempts</p><p>Fetchlane couldn’t reach ' + esc(d.host) + '. Check your connection, then retry. It continues from ' + fmtSize(d.done) + '.</p></div></div>';
    if (d.status === 'failed' && d.reason === 'disk') e = '<div class="fl-explain is-error" role="alert">' + icon('alert') + '<div><p class="fl-etitle">Not enough space on drive ' + d.drive + '</p><p>This file needs ' + fmtSize(d.need) + ' more, but only ' + fmtSize(d.free) + ' is free. Free up space or choose another folder, then retry. The ' + fmtSize(d.done) + ' already downloaded is kept.</p></div></div>';
    if (d.status === 'failed' && d.reason === 'noresume') e = '<div class="fl-explain is-error" role="alert">' + icon('alert') + '<div><p class="fl-etitle">The server can’t continue this download</p><p>' + esc(d.host) + ' doesn’t support resuming, so the ' + fmtSize(d.done) + ' already downloaded can’t be reused. Restarting downloads the whole file again.</p></div></div>';
    if (d.status === 'paused') e = '<div class="fl-explain">' + icon('pause', 16, 'fl-muted') + '<div><p>Paused by you. The partial file is kept; resuming continues from ' + fmtSize(d.done) + '.</p></div></div>';
    if (d.status === 'queued') e = '<div class="fl-explain">' + icon('clock', 16, 'fl-muted') + '<div><p><strong>#' + d.pos + ' in line.</strong> Starts when one of the 4 download slots frees up.</p></div></div>';
    if (d.status === 'downloading' && d.total == null) e = '<div class="fl-explain">' + icon('info', 16, 'fl-muted') + '<div><p>' + d.note + '</p><p>This server also can’t resume, so pausing would restart it.</p></div></div>';
    if (d.status === 'completed') e = '<div class="fl-explain is-done" role="status">' + icon('checkCircle') + '<div><p class="fl-etitle">Downloaded ' + (d.day === 'yesterday' ? 'yesterday' : 'today') + ' at ' + d.at + '</p><p>' + fmtSize(d.total) + ' in ' + fmtDur(d.elapsed, true) + (d.elapsed > 2 ? ' · average ' + fmtSpeed(d.total / d.elapsed) : '') + '</p></div></div>';
    if (d.status === 'cancelled') e = '<div class="fl-explain">' + icon('stop', 16, 'fl-muted') + '<div><p>You cancelled this download and its partial file was deleted. Download again to start over.</p></div></div>';
    return e;
  }
  function detailsHTML(d, o) {
    o = o || {};
    var p = pct(d), h = '<aside class="fl-details' + (o.overlay ? ' is-overlay' : '') + '" aria-label="Download details">';
    h += '<div class="fl-dhead">' + fileIcon(d.name, 32) + '<div style="flex:1;min-width:0"><h2>' + esc(d.name) + '</h2><div class="fl-host">' + icon(d.url.indexOf('https') === 0 ? 'lock' : 'globe', 12) + esc(d.host) + '</div></div><button class="fl-ibtn fl-ibtn-sm" data-a="closepanel" title="Close details (Esc)" aria-label="Close details">' + icon('x') + '</button></div>';
    h += '<div class="fl-dbody">';
    h += '<div style="display:flex;align-items:center;justify-content:space-between">' + statusHTML(d) + '</div>';
    if (d.status !== 'completed' && d.status !== 'cancelled' && d.status !== 'queued') {
      h += '<div class="fl-dprogress"><div class="fl-big"><span class="fl-pct" data-m="pctbig-' + d.id + '">' + (p == null ? fmtSize(d.done) : p + '%') + '</span><span class="fl-of" data-m="of-' + d.id + '">' + (d.total == null ? 'of unknown size' : fmtSize(d.done) + ' of ' + fmtSize(d.total)) + '</span></div>' + barHTML(d, true) + '</div>';
    }
    h += explainHTML(d);
    var rows = [];
    var na = function (t, why) { return '<dd class="fl-na" title="' + why + '">— <small>' + t + '</small></dd>'; };
    if (d.status === 'downloading') {
      rows.push(['Speed', '<dd data-m="speedd-' + d.id + '">' + fmtSpeed(d.speed) + '</dd>']);
      rows.push(['Time left', d.total == null ? na('needs file size', 'The server didn’t report a size') : '<dd data-m="etad-' + d.id + '">' + fmtDur((d.total - d.done) / d.speed, true) + '</dd>']);
    } else if (d.status === 'retrying' || (d.status === 'failed')) {
      rows.push(['Speed', na(d.status === 'retrying' ? 'reconnecting' : 'stopped', '')]);
      rows.push(['Time left', na('not available', '')]);
    }
    if (d.status !== 'queued' && d.status !== 'cancelled') rows.push(['Elapsed', '<dd data-m="el-' + d.id + '">' + fmtDur(d.elapsed || 0, true) + '</dd>']);
    rows.push(['Size', d.total == null ? (d.status === 'queued' ? na('known when started', '') : '<dd>' + fmtSize(d.done) + ' so far<small>total unknown</small></dd>') : '<dd>' + fmtSize(d.total) + '</dd>']);
    if (d.started) rows.push(['Started', '<dd>' + d.started + '</dd>']);
    if (d.status !== 'completed' && d.status !== 'cancelled' && d.resumable != null) rows.push(['Resumable', '<dd>' + (d.resumable ? 'Yes' : 'No') + '<small>' + (d.resumable ? 'pause keeps progress' : 'server doesn’t allow it') + '</small></dd>']);
    h += '<dl class="fl-dl">' + rows.map(function (r) { return '<div><dt>' + r[0] + '</dt>' + r[1] + '</div>'; }).join('') + '</dl>';
    h += '<div class="fl-dsec"><h3>Saved to</h3><div class="fl-path"><span class="fl-mono" title="' + esc(d.folder + '\\' + d.name) + '">' + esc(d.folder) + '\\</span><button class="fl-ibtn fl-ibtn-sm" data-a="openfolder" data-id="' + d.id + '" title="Show in folder" aria-label="Show in folder">' + icon('folderOpen') + '</button></div></div>';
    h += '<div class="fl-dsec"><h3>Source</h3><div class="fl-path' + (o.reveal ? ' is-wrap' : '') + '"><span class="fl-mono">' + redactUrl(d.url, o.reveal) + '</span>' +
      (d.url.indexOf('?') > 0 ? '<button class="fl-ibtn fl-ibtn-sm" data-a="reveal" title="' + (o.reveal ? 'Hide' : 'Show') + ' parameters" aria-pressed="' + !!o.reveal + '" aria-label="' + (o.reveal ? 'Hide' : 'Show') + ' link parameters">' + icon('eye') + '</button>' : '') +
      '<button class="fl-ibtn fl-ibtn-sm" data-a="copylink" title="Copy full link" aria-label="Copy full link">' + icon('copy') + '</button></div>' +
      (d.url.indexOf('?') > 0 && !o.reveal ? '<div class="fl-hint">' + icon('lock', 12) + 'Parameters can contain access tokens, so they’re hidden. Copy still copies the full link.</div>' : '') + '</div>';
    if (d.status === 'downloading' && d.total != null) {
      h += '<div class="fl-dsec"><button class="fl-disclosure" data-a="spark" aria-expanded="' + !!o.spark + '">' + icon(o.spark ? 'chevDown' : 'chevRight', 12) + 'Speed history <span class="fl-subtle" style="font-weight:400">· optional</span></button>' + (o.spark ? spark() : '') + '</div>';
    }
    h += '</div>';
    h += '<div class="fl-dactions">' + detailActions(d) + '</div>';
    return h + '</aside>';
  }
  function detailActions(d) {
    var B = function (a, ic, t, cls) { return '<button class="fl-btn ' + (cls || '') + '" data-a="' + a + '" data-id="' + d.id + '">' + icon(ic) + t + '</button>'; };
    var more = '<button class="fl-ibtn" data-a="menu" data-id="' + d.id + '" title="More actions" aria-haspopup="menu" aria-label="More actions">' + icon('more') + '</button>';
    switch (d.status) {
      case 'downloading': return (d.resumable === false ? '' : B('pause', 'pause', 'Pause')) + B('cancel', 'stop', 'Cancel…') + more;
      case 'paused': return B('resume', 'play', 'Resume', 'fl-btn-primary') + B('cancel', 'stop', 'Cancel…') + more;
      case 'queued': return B('start', 'play', 'Start now', 'fl-btn-primary') + B('cancel', 'stop', 'Cancel…') + more;
      case 'retrying': return B('retrynow', 'retry', 'Retry now') + B('pause', 'pause', 'Pause') + more;
      case 'failed':
        if (d.reason === 'noresume') return B('restart', 'restart', 'Restart download…', 'fl-btn-primary') + more;
        if (d.reason === 'disk') return B('retry', 'retry', 'Retry', 'fl-btn-primary') + B('changefolder', 'folder', 'Change folder…') + more;
        return B('retry', 'retry', 'Retry', 'fl-btn-primary') + more;
      case 'completed': return B('openfile', 'open', 'Open file', 'fl-btn-primary') + B('openfolder', 'folderOpen', 'Show in folder') + more;
      case 'cancelled': return B('restart0', 'retry', 'Download again', 'fl-btn-primary') + more;
    }
  }

  /* ---------------- overflow menu ---------------- */
  function menuItems(d) {
    var I = function (a, ic, t, opt) { opt = opt || {}; return '<button class="fl-mi' + (opt.danger ? ' is-danger' : '') + '" role="menuitem" data-a="' + a + '" data-id="' + d.id + '"' + (opt.disabled ? ' disabled' : '') + ' tabindex="-1">' + icon(ic) + '<span>' + t + '</span>' + (opt.sc ? '<span class="fl-sc">' + opt.sc + '</span>' : '') + '</button>'; };
    var S = '<div class="fl-msep" role="separator"></div>', h = '';
    if (d.status === 'downloading') h += I('pause', 'pause', d.resumable === false ? 'Pause (server can’t resume)' : 'Pause', { disabled: d.resumable === false });
    if (d.status === 'paused') h += I('resume', 'play', 'Resume');
    if (d.status === 'retrying') h += I('retrynow', 'retry', 'Retry now') + I('pause', 'pause', 'Pause');
    if (d.status === 'queued') h += I('start', 'play', 'Start now') + S + I('top', 'toTop', 'Move to top') + I('up', 'arrowUp', 'Move up', { disabled: d.pos === 1, sc: 'Alt+↑' }) + I('downq', 'arrowDown', 'Move down', { sc: 'Alt+↓' });
    if (d.status === 'failed') h += d.reason === 'noresume' ? I('restart', 'restart', 'Restart download…') : I('retry', 'retry', 'Retry');
    if (d.status === 'completed') h += I('openfile', 'open', 'Open file', { sc: 'Enter' }) + I('openfolder', 'folderOpen', 'Show in folder');
    h += S + I('details', 'info', 'Details', { sc: 'Ctrl+I' }) + I('copylink', 'link', 'Copy link') + (d.status !== 'completed' && d.status !== 'cancelled' ? I('openfolder', 'folder', 'Open destination folder') : I('restart0', 'retry', 'Download again'));
    h += S;
    if (d.status === 'downloading' || d.status === 'paused' || d.status === 'retrying' || d.status === 'queued' || d.status === 'failed') h += I('cancel', 'stop', 'Cancel download…', { danger: true });
    h += I('remove', 'remove', 'Remove from list…', { sc: 'Del' });
    return h;
  }

  /* ---------------- app ---------------- */
  var VIEWS = [
    { id: 'all', label: 'All downloads', icon: 'all' },
    { id: 'active', label: 'Active', icon: 'active' },
    { id: 'queued', label: 'Queued', icon: 'queue' },
    { id: 'completed', label: 'Completed', icon: 'done' },
    { id: 'failed', label: 'Failed', icon: 'failed' }
  ];
  function inView(d, v) {
    if (v === 'all') return true;
    if (v === 'active') return d.status === 'downloading' || d.status === 'retrying' || d.status === 'paused';
    return d.status === v;
  }
  function counts(items, older) {
    var c = { all: items.length + older, completed: older };
    VIEWS.forEach(function (v) { if (v.id !== 'all') c[v.id] = (c[v.id] || 0) + items.filter(function (d) { return inView(d, v.id); }).length; });
    return c;
  }

  function mountApp(root, opts) {
    opts = opts || {};
    var W = opts.width || 1280, H = opts.height || 800;
    var S = {
      items: opts.empty ? [] : sample(),
      older: opts.empty ? 0 : OLDER,
      view: opts.view || 'all',
      density: opts.density || 'comfortable',
      sel: new Set(opts.sel || []),
      focus: opts.focus || null,
      open: opts.open || null,
      reveal: false, spark: !!opts.spark,
      menu: opts.menu || null,
      dialog: opts.dialog || null,
      query: opts.query || '',
      paused: false,
      hover: opts.hover || null,
      anchor: null,
      settings: { folder: 'D:\\Downloads', ask: false, max: 4, retry: true, attempts: 5, theme: 'system', density: opts.density || 'comfortable', history: true },
      toast: null
    };
    if (opts.mutate) opts.mutate(S.items);
    var docked = W >= 1200, rail = W < 1100, listW = W;
    var elWin;

    function visible() {
      var q = S.query.trim().toLowerCase();
      var list = S.items.filter(function (d) { return inView(d, S.view) && (!q || (d.name + ' ' + d.host).toLowerCase().indexOf(q) >= 0); });
      if (S.view === 'queued') list.sort(function (a, b) { return a.pos - b.pos; });
      return list;
    }
    function byId(id) { for (var i = 0; i < S.items.length; i++) if (S.items[i].id === id) return S.items[i]; }
    function anyActive() { return S.items.some(function (d) { return d.status === 'downloading' || d.status === 'retrying'; }); }

    function sidebar(c) {
      var h = '<nav class="fl-sidebar' + (rail ? ' is-rail' : '') + '" aria-label="Download lists">';
      VIEWS.forEach(function (v) {
        var cur = S.view === v.id;
        h += '<button class="fl-nav" data-view="' + v.id + '"' + (cur ? ' aria-current="page"' : '') + ' title="' + v.label + ' (' + c[v.id] + ')">' + icon(v.icon) + '<span class="fl-nav-label">' + v.label + '</span><span class="fl-count' + (v.id === 'failed' && c.failed ? ' is-alert' : '') + '" aria-label="' + c[v.id] + ' items">' + c[v.id] + '</span></button>';
      });
      h += '<div class="fl-spacer"></div><div class="fl-sidebar-sep"></div>';
      h += '<button class="fl-nav" data-view="settings"' + (S.view === 'settings' ? ' aria-current="page"' : '') + ' title="Settings">' + icon('sliders') + '<span class="fl-nav-label">Settings</span></button>';
      return h + '</nav>';
    }
    function toolbar() {
      var act = anyActive(), hasPaused = S.items.some(function (d) { return d.status === 'paused'; });
      var label = S.paused || (!act && hasPaused) ? 'Resume all' : 'Pause all';
      var dis = !act && !hasPaused && !S.paused;
      return '<div class="fl-toolbar" role="toolbar" aria-label="Downloads">' +
        '<button class="fl-btn fl-btn-primary" data-a="add" title="Add download (Ctrl+N)">' + icon('plus') + 'Add download</button>' +
        '<div class="fl-input fl-search" style="' + (listW < 900 ? 'flex-basis:200px;width:200px' : '') + '">' + icon('search') + '<input type="search" placeholder="' + (listW < 900 ? 'Search' : 'Search downloads') + '" aria-label="Search downloads" value="' + esc(S.query) + '" data-q>' + (S.query ? '<button class="fl-ibtn fl-ibtn-sm" style="width:22px;height:22px;margin-right:-6px" data-a="clearq" aria-label="Clear search">' + icon('x', 14) + '</button>' : '<span class="fl-kbd">Ctrl+F</span>') + '</div>' +
        '<div class="fl-grow"></div>' +
        '<div class="fl-seg" role="radiogroup" aria-label="List density"><button role="radio" aria-checked="' + (S.density === 'comfortable') + '" data-density="comfortable" title="Comfortable rows">' + icon('comfortable', 14) + (listW < 900 ? '<span class="fl-sr">Comfortable</span>' : 'Comfortable') + '</button><button role="radio" aria-checked="' + (S.density === 'compact') + '" data-density="compact" title="Compact rows">' + icon('compact', 14) + (listW < 900 ? '<span class="fl-sr">Compact</span>' : 'Compact') + '</button></div>' +
        '<div class="fl-vsep"></div>' +
        '<button class="fl-btn" data-a="pauseall"' + (dis ? ' disabled' : '') + ' title="' + (label === 'Pause all' ? 'Pause every active download that can resume, and hold the queue' : 'Resume all paused downloads and the queue') + '">' + icon(label === 'Pause all' ? 'pause' : 'play') + label + '</button>' +
        '</div>';
    }
    function listHead(list) {
      var v = VIEWS.filter(function (x) { return x.id === S.view; })[0];
      if (S.sel.size) {
        var sel = S.items.filter(function (d) { return S.sel.has(d.id); });
        var n = function (f) { return sel.filter(f).length; };
        var np = n(function (d) { return (d.status === 'downloading' && d.resumable !== false) || d.status === 'retrying'; }),
          nr = n(function (d) { return d.status === 'paused' || d.status === 'queued'; }),
          nt = n(function (d) { return d.status === 'failed'; }),
          nq = n(function (d) { return d.status === 'queued'; });
        var B = function (a, ic, t, c, extra) { return '<button class="fl-btn" data-a="' + a + '"' + (c ? '' : ' disabled') + '>' + icon(ic) + t + ' <span class="fl-n">' + c + '</span>' + (extra || '') + '</button>'; };
        var all = sel.length === list.length;
        return '<div class="fl-selbar" role="toolbar" aria-label="Actions for ' + sel.length + ' selected downloads">' +
          '<button class="fl-check" role="checkbox" aria-checked="' + (all ? 'true' : 'mixed') + '" data-a="selall" aria-label="' + (all ? 'Clear selection' : 'Select all in this list') + '">' + (all ? icon('check', 12) : icon('minus', 12)) + '</button>' +
          '<span class="fl-selcount" aria-live="polite">' + sel.length + ' selected</span>' +
          B('selpause', 'pause', 'Pause', np) + B('selresume', 'play', 'Resume', nr) + B('selretry', 'retry', 'Retry', nt) + (nq ? B('seltop', 'toTop', 'Move to top', nq) : '') +
          '<div class="fl-vsep"></div>' + B('selremove', 'remove', 'Remove from list…', sel.length) +
          '<div class="fl-grow" style="flex:1"></div><button class="fl-btn fl-btn-subtle" data-a="clearsel" title="Clear selection (Esc)">' + icon('x') + (listW < 900 ? '<span class="fl-sr">Clear selection</span>' : 'Clear selection') + '</button></div>';
      }
      var sub = S.view === 'queued' ? 'Starts top to bottom · ' + S.settings.max + ' at a time' : S.view === 'failed' ? 'Need your attention' : (list.length + (S.view === 'all' || S.view === 'completed' ? S.older : 0)) + ' items';
      return '<div class="fl-listhead"><h1>' + (S.query ? 'Results for “' + esc(S.query) + '”' : v.label) + '</h1><span class="fl-muted fl-num">' + sub + '</span></div>';
    }
    function emptyHTML() {
      var art = '<svg class="fl-empty-art" width="96" height="96" viewBox="0 0 96 96" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 14v10M22 32v10M74 14v10M74 32v10" stroke-dasharray="0" opacity=".6"/><path class="fl-art-file" d="M38 12h16l10 10v30a3 3 0 0 1-3 3H38a3 3 0 0 1-3-3V15a3 3 0 0 1 3-3z"/><path class="fl-art-file" d="M54 12v10h10"/><path d="M18 60v14a6 6 0 0 0 6 6h48a6 6 0 0 0 6-6V60"/><path d="M18 60h16l4 6h20l4-6h16" opacity=".6"/></svg>';
      if (S.query) return '<div class="fl-empty">' + icon('search', 32, 'fl-subtle') + '<h2>No downloads match “' + esc(S.query) + '”</h2><p>Search looks at filenames and website names in every list.</p><div class="fl-row-btns"><button class="fl-btn" data-a="clearq">Clear search</button></div></div>';
      if (S.view === 'failed') return '<div class="fl-empty">' + icon('checkCircle', 32, 'fl-subtle') + '<h2>Nothing has failed</h2><p>Downloads that stop with an error appear here, with what went wrong and how to fix it.</p></div>';
      if (S.view === 'queued') return '<div class="fl-empty">' + icon('queue', 32, 'fl-subtle') + '<h2>The queue is empty</h2><p>Choose <strong>Add to queue</strong> when adding a download to have it start after the current ones.</p></div>';
      if (S.view !== 'all') return '<div class="fl-empty">' + icon('all', 32, 'fl-subtle') + '<h2>Nothing here right now</h2></div>';
      return '<div class="fl-empty">' + art + '<h2>Your downloads will line up here</h2><p>Copy a download link from your browser or an email, then press <span class="fl-kbd">Ctrl</span> <span class="fl-kbd">V</span> anywhere in Fetchlane — or choose Add download.</p>' +
        '<div class="fl-row-btns"><button class="fl-btn fl-btn-primary" data-a="add">' + icon('plus') + 'Add download</button><button class="fl-btn" data-a="pastenew">' + icon('paste') + 'Paste link</button></div>' +
        '<div class="fl-steps"><div><b>1</b><span>Copy a link that starts with http:// or https://</span></div><div><b>2</b><span>Paste it — Fetchlane checks the file name and size</span></div><div><b>3</b><span>Download now or add it to the queue</span></div></div></div>';
    }
    function tableHTML(list) {
      if (!list.length) return emptyHTML();
      var o = { wide: listW >= 1000, queueView: S.view === 'queued', compact: S.density === 'compact' };
      o.hasTextAction = o.wide && list.some(function (d) { return d.status === 'failed'; });
      var h = '<div class="fl-table' + (o.compact ? ' fl-compact' : '') + '" role="grid" aria-label="Downloads" aria-multiselectable="true" style="--fl-cols:' + colsFor(o) + '">' + theadHTML(o);
      var groups = [];
      if (S.view === 'all' && !S.query) {
        groups = [['In progress', list.filter(function (d) { return d.status !== 'completed' && d.status !== 'cancelled' && d.status !== 'failed'; })],
          ['Failed', list.filter(function (d) { return d.status === 'failed'; })],
          ['Today', list.filter(function (d) { return (d.status === 'completed' || d.status === 'cancelled') && d.day === 'today'; })],
          ['Yesterday', list.filter(function (d) { return (d.status === 'completed' || d.status === 'cancelled') && d.day === 'yesterday'; })]];
        var ip = groups[0][1]; ip.sort(function (a, b) { var r = { downloading: 0, retrying: 1, paused: 2, queued: 3 }; return r[a.status] - r[b.status] || (a.pos || 0) - (b.pos || 0); });
      } else groups = [[null, list]];
      var first = S.focus && list.some(function (d) { return d.id === S.focus; }) ? S.focus : list[0].id;
      groups.forEach(function (g) {
        if (!g[1].length) return;
        if (g[0]) h += '<div class="fl-group" role="presentation">' + g[0] + ' <span class="fl-subtle fl-num">' + g[1].length + '</span></div>';
        g[1].forEach(function (d) {
          h += rowHTML(d, { inline: !(S.open && docked), wide: o.wide, queueView: o.queueView, compact: o.compact, selected: S.sel.has(d.id), anySel: S.sel.size > 0, tab: d.id === first, open: S.open === d.id, hover: S.hover === d.id, focus: opts.showFocus && S.focus === d.id });
        });
      });
      if ((S.view === 'all' || S.view === 'completed') && !S.query && S.older) h += '<div class="fl-group" role="presentation">Earlier this week <span class="fl-subtle fl-num">' + S.older + '</span><button class="fl-btn fl-btn-subtle fl-btn-sm" style="margin-left:auto" data-a="older">' + icon('chevDown', 14) + 'Show</button></div>';
      return h + '</div>';
    }
    function statusbar() {
      var dl = S.items.filter(function (d) { return d.status === 'downloading'; });
      var sp = dl.reduce(function (a, d) { return a + d.speed; }, 0), q = S.items.filter(function (d) { return d.status === 'queued'; }).length;
      var rt = S.items.filter(function (d) { return d.status === 'retrying'; }).length;
      return '<div class="fl-statusbar" role="status" aria-live="off">' +
        (S.paused ? '<span class="fl-sb">' + icon('pause', 12) + '<b>All paused</b> · queue on hold</span>' :
          '<span class="fl-sb">' + icon('down', 12) + '<b>' + dl.length + '</b> downloading' + (rt ? ' · <b>' + rt + '</b> retrying' : '') + '</span><span class="fl-sb"><b data-m="total-speed">' + (fmtSpeed(sp) || '0 KB/s') + '</b> total</span>') +
        '<span class="fl-sb">' + icon('clock', 12) + '<b>' + q + '</b> queued</span><span class="fl-grow"></span>' +
        '<span class="fl-sb">' + icon('drive', 12) + 'D: 6.10 GB free</span><button class="fl-link fl-num" data-view="settings" title="Change in Settings">' + S.settings.max + ' at a time</button></div>';
    }
    function settingsHTML() {
      var s = S.settings;
      var tog = function (k, on, lbl) { return '<button class="fl-toggle" role="switch" aria-checked="' + on + '" data-set="' + k + '" aria-label="' + lbl + '"></button><span style="width:28px;font-size:13px">' + (on ? 'On' : 'Off') + '</span>'; };
      var radio = function (k, v, t) { return '<button role="radio" aria-checked="' + (s[k] === v) + '" data-setv="' + k + ':' + v + '">' + t + '</button>'; };
      return '<div class="fl-settings"><div class="fl-listhead" style="padding:0;height:56px"><h1 style="font-size:20px;line-height:28px">Settings</h1><span class="fl-muted">Changes apply right away</span></div><div class="fl-settings-inner">' +
        '<section class="fl-sgroup"><h2>Downloads</h2><div class="fl-scard">' +
        '<div class="fl-srow"><span class="fl-sicon">' + icon('folder', 20) + '</span><div class="fl-stext"><div>Default download folder</div><div>New downloads are saved here unless you pick another folder.</div></div><div class="fl-sctl"><div class="fl-path" style="width:220px;background:var(--surface-100)"><span class="fl-mono">' + esc(s.folder) + '</span></div><button class="fl-btn" data-a="browse">Browse…</button></div></div>' +
        '<div class="fl-srow is-sub"><div class="fl-stext"><div>Ask where to save each download</div><div>Shows the folder field first in Add download.</div></div><div class="fl-sctl">' + tog('ask', s.ask, 'Ask where to save each download') + '</div></div>' +
        '<div class="fl-srow"><span class="fl-sicon">' + icon('active', 20) + '</span><div class="fl-stext"><div>Maximum simultaneous downloads</div><div>Others wait in the queue in order. A download that is retrying keeps its slot.</div></div><div class="fl-sctl"><div class="fl-num-box"><button data-a="maxdown" aria-label="Fewer"' + (s.max <= 1 ? ' disabled' : '') + '>' + icon('minus', 14) + '</button><input value="' + s.max + '" aria-label="Maximum simultaneous downloads, 1 to 10" inputmode="numeric"><button data-a="maxup" aria-label="More"' + (s.max >= 10 ? ' disabled' : '') + '>' + icon('plus', 14) + '</button></div></div></div>' +
        '</div></section>' +
        '<section class="fl-sgroup"><h2>Retries</h2><div class="fl-scard">' +
        '<div class="fl-srow"><span class="fl-sicon">' + icon('retry', 20) + '</span><div class="fl-stext"><div>Retry automatically when a connection drops</div><div>Fetchlane waits a little longer before each attempt and keeps the partial file.</div></div><div class="fl-sctl">' + tog('retry', s.retry, 'Retry automatically') + '</div></div>' +
        '<div class="fl-srow is-sub' + (s.retry ? '' : ' is-disabled') + '"><div class="fl-stext"><div>Attempts before giving up</div><div>Waits 5 s, 15 s, 45 s, then 2 min between attempts. After the last one, the download moves to Failed.</div></div><div class="fl-sctl"><div class="fl-num-box"' + (s.retry ? '' : ' aria-disabled="true" style="opacity:.5"') + '><button aria-label="Fewer" data-a="attdown"' + (s.retry && s.attempts > 1 ? '' : ' disabled') + '>' + icon('minus', 14) + '</button><input value="' + s.attempts + '" aria-label="Attempts" ' + (s.retry ? '' : 'disabled') + '><button aria-label="More" data-a="attup"' + (s.retry && s.attempts < 10 ? '' : ' disabled') + '>' + icon('plus', 14) + '</button></div></div></div>' +
        '<div class="fl-srow is-sub"><div class="fl-stext"><div>Disk full, file not found and access denied are never retried automatically</div><div>They need a decision from you and go straight to Failed.</div></div></div>' +
        '</div></section>' +
        '<section class="fl-sgroup"><h2>Appearance</h2><div class="fl-scard">' +
        '<div class="fl-srow"><span class="fl-sicon">' + icon('eye', 20) + '</span><div class="fl-stext"><div>Theme</div><div>System follows your Windows setting.</div></div><div class="fl-sctl"><div class="fl-seg" role="radiogroup" aria-label="Theme">' + radio('theme', 'system', 'System') + radio('theme', 'light', 'Light') + radio('theme', 'dark', 'Dark') + '</div></div></div>' +
        '<div class="fl-srow"><span class="fl-sicon">' + icon('comfortable', 20) + '</span><div class="fl-stext"><div>List density</div><div>Compact fits about 50% more rows and moves website names into tooltips.</div></div><div class="fl-sctl"><div class="fl-seg" role="radiogroup" aria-label="List density">' + radio('density', 'comfortable', 'Comfortable') + radio('density', 'compact', 'Compact') + '</div></div></div>' +
        '</div></section>' +
        '<section class="fl-sgroup"><h2>History</h2><div class="fl-scard">' +
        '<div class="fl-srow"><span class="fl-sicon">' + icon('clock', 20) + '</span><div class="fl-stext"><div>Keep download history</div><div>Completed and failed entries stay in the list after you restart Fetchlane.</div></div><div class="fl-sctl">' + tog('history', s.history, 'Keep download history') + '</div></div>' +
        '<div class="fl-srow is-sub"><div class="fl-stext"><div>Clear completed entries</div><div>Removes ' + (S.older + S.items.filter(function (d) { return d.status === 'completed'; }).length) + ' entries from the list. Downloaded files stay on disk.</div></div><div class="fl-sctl"><button class="fl-btn" data-a="clearhist">Clear from list…</button></div></div>' +
        '</div></section>' +
        '<p class="fl-note" style="margin:0">Fetchlane 1.0 · Open source · HTTP and HTTPS downloads</p>' +
        '</div></div>';
    }
    function dialogHTML() {
      var g = S.dialog; if (!g) return '';
      var h = '<div class="fl-scrim" data-a="scrim">';
      if (g.type === 'add') h += addDialog(g);
      if (g.type === 'restart') { var d = byId(g.id); h += confirmDialog('Restart download from the beginning?', '<p><strong>' + esc(d.host) + '</strong> can’t continue a partial download.</p><p>Restarting <strong>deletes the ' + fmtSize(d.done) + ' already downloaded</strong> and downloads all ' + fmtSize(d.total) + ' of ' + esc(d.name) + ' again.</p>', 'Delete partial and restart', 'dorestart'); }
      if (g.type === 'cancel') { var c = byId(g.id); h += confirmDialog('Cancel this download?', '<p>Cancelling stops <strong>' + esc(c.name) + '</strong> and <strong>deletes the ' + (c.done ? fmtSize(c.done) + ' partial file' : 'reserved file') + '</strong>. The entry stays in your list as Cancelled.</p><p>To keep the progress instead, choose Pause.</p>', 'Cancel download', 'docancel', 'Keep downloading'); }
      if (g.type === 'remove') {
        var ids = g.ids, items = ids.map(byId), n = ids.length, inprog = items.filter(function (d) { return d.status !== 'completed' && d.status !== 'cancelled' && d.status !== 'failed'; }).length;
        var hasFiles = items.some(function (d) { return d.status === 'completed'; });
        h += '<div class="fl-dialog is-narrow" role="alertdialog" aria-modal="true" aria-labelledby="dlg-t"><div class="fl-dlg-body"><h2 id="dlg-t">Remove ' + (n === 1 ? 'this entry' : n + ' entries') + ' from the list?</h2>' +
          '<p>' + (n === 1 ? esc(items[0].name) : items.slice(0, 2).map(function (d) { return esc(d.name); }).join(', ') + (n > 2 ? ' and ' + (n - 2) + ' more' : '')) + '</p>' +
          '<div class="fl-explain">' + icon('info', 16, 'fl-muted') + '<div><p>Only the list entry is removed. <strong>Files on disk are kept</strong> unless you tick the box below.' + (inprog ? ' ' + inprog + ' download' + (inprog > 1 ? 's' : '') + ' in progress will be stopped and ' + (inprog > 1 ? 'their' : 'its') + ' partial file' + (inprog > 1 ? 's' : '') + ' deleted.' : '') + '</p></div></div>' +
          (hasFiles ? '<label class="fl-checkline" data-a="togdel"><button class="fl-check" role="checkbox" aria-checked="' + !!g.del + '" tabindex="0">' + icon('check', 12) + '</button><span>Also delete the downloaded file' + (n > 1 ? 's' : '') + ' from disk<br><span class="fl-subtle" style="font-size:12px">Sends ' + (n > 1 ? 'them' : 'it') + ' to the Recycle Bin.</span></span></label>' : '') +
          '</div><div class="fl-dlg-foot"><button class="fl-btn" data-a="closedlg">Keep</button><button class="fl-btn ' + (g.del ? 'fl-btn-danger-fill' : 'fl-btn-primary') + '" data-a="doremove">' + (g.del ? 'Remove and delete files' : 'Remove from list') + '</button></div></div>';
      }
      return h + '</div>';
    }
    function confirmDialog(title, body, okLabel, okAction, keepLabel) {
      return '<div class="fl-dialog is-narrow" role="alertdialog" aria-modal="true" aria-labelledby="dlg-t" aria-describedby="dlg-d"><div class="fl-dlg-body"><h2 id="dlg-t">' + title + '</h2><div id="dlg-d" style="display:flex;flex-direction:column;gap:8px;color:var(--ink-muted)">' + body.replace(/<p>/g, '<p style="margin:0">') + '</div></div><div class="fl-dlg-foot"><button class="fl-btn" data-a="closedlg" data-autofocus>' + (keepLabel || 'Keep partial file') + '</button><button class="fl-btn fl-btn-danger-fill" data-a="' + okAction + '">' + okLabel + '</button></div></div>';
    }
    function addDialog(g) {
      var st = g.step || 'idle', url = g.url || '';
      var hint = '', field = 'fl-input is-mono' + (st === 'invalid' || st === 'unsupported' || st === 'http404' ? ' is-error' : '') + (g.focusUrl ? ' is-focus' : '');
      if (st === 'idle') hint = '<div class="fl-hint">Paste a link that starts with http:// or https://</div>';
      if (st === 'checking') hint = '<div class="fl-hint is-busy" role="status">' + icon('spinner', 12, 'fl-spin') + 'Checking link with ' + esc(hostOf(url)) + '…</div>';
      if (st === 'valid') hint = '<div class="fl-hint is-ok" role="status">' + icon('check', 12) + '<span>Found ' + esc(g.file) + ' · ' + fmtSize(g.size) + ' · can resume</span></div>';
      if (st === 'invalid') hint = '<div class="fl-hint is-error" role="alert">' + icon('alert', 12) + '<span>That doesn’t look like a web link. Check it starts with http:// or https://</span></div>';
      if (st === 'unsupported') hint = '<div class="fl-hint is-error" role="alert">' + icon('alert', 12) + '<span>Fetchlane downloads HTTP and HTTPS links. Magnet and torrent links aren’t supported.</span></div>';
      if (st === 'http404') hint = '<div class="fl-hint is-error" role="alert">' + icon('alert', 12) + '<span>The server says this file doesn’t exist (404). Check the link, or ask whoever shared it for a new one.</span></div>';
      var ready = st === 'valid', busy = st === 'checking';
      var slotsFull = S.items.filter(function (d) { return d.status === 'downloading' || d.status === 'retrying'; }).length >= S.settings.max;
      var h = '<div class="fl-dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-t"><div class="fl-dlg-body"><h2 id="dlg-t">Add download</h2>';
      h += '<div class="fl-field"><label class="fl-label" for="dl-url">Link</label><div class="fl-input-row"><div class="' + field + '">' + icon('link') + '<input id="dl-url" data-url placeholder="https://example.com/file.zip" value="' + esc(url) + '" spellcheck="false" autocomplete="off"' + (st === 'invalid' ? ' aria-invalid="true"' : '') + '>' + (busy ? icon('spinner', 14, 'fl-spin') : '') + '</div><button class="fl-btn" data-a="paste" title="Paste link from clipboard">' + icon('paste') + 'Paste</button></div>' + hint + '</div>';
      var dis = ready ? '' : ' is-disabled';
      h += '<div class="fl-field"><label class="fl-label" for="dl-name">File name</label><div class="fl-input' + dis + '">' + (ready ? fileIcon(g.file, 16) : icon('open', 16)) + '<input id="dl-name" data-name value="' + esc(ready ? g.file : '') + '" placeholder="' + (busy ? 'Getting file name…' : 'Filled in from the link') + '"' + (ready ? '' : ' disabled') + '></div>' + (ready && g.exists ? '<div class="fl-hint is-warn">' + icon('warn', 12) + '<span>A file with this name is already in the folder. Fetchlane will save it as <strong>' + esc(g.file.replace(/(\.[a-z0-9]+)$/i, ' (1)$1')) + '</strong>.</span></div>' : '') + '</div>';
      h += '<div class="fl-field"><label class="fl-label" for="dl-dest">Save to</label><div class="fl-input-row"><div class="fl-input is-mono">' + icon('folder') + '<input id="dl-dest" value="' + esc(g.folder || S.settings.folder) + '"><span class="fl-suffix fl-num">212 GB free</span></div><button class="fl-btn" data-a="browse">Browse…</button></div></div>';
      if (ready) h += '<div class="fl-explain">' + icon(slotsFull ? 'clock' : 'info', 16, 'fl-muted') + '<div><p>' + (slotsFull ? 'All ' + S.settings.max + ' download slots are busy. <strong>Download</strong> puts this first in line; <strong>Add to queue</strong> puts it last (#' + (S.items.filter(function (x) { return x.status === 'queued'; }).length + 1) + ').' : '<strong>Download</strong> starts now; <strong>Add to queue</strong> waits behind the other queued downloads.') + '</p></div></div>';
      h += '</div><div class="fl-dlg-foot"><div class="fl-grow"></div>' +
        '<button class="fl-btn" data-a="closedlg">Cancel</button>' +
        '<button class="fl-btn" data-a="addqueue"' + (ready ? '' : ' disabled') + ' title="Adds to the end of the queue">' + icon('queue') + 'Add to queue</button>' +
        '<button class="fl-btn fl-btn-primary' + (busy ? ' is-loading' : '') + '" data-a="dodownload"' + (ready ? '' : ' disabled') + '>' + (busy ? icon('spinner', 16, 'fl-spin') : icon('down')) + 'Download</button></div></div>';
      return h;
    }
    function hostOf(u) { var m = /^[a-z]+:\/\/([^\/?#]+)/i.exec(u || ''); return m ? m[1] : 'server'; }
    function menuHTML() {
      if (!S.menu) return '';
      var d = byId(S.menu.id); if (!d) return '';
      return '<div class="fl-menu" role="menu" aria-label="Actions for ' + esc(d.name) + '" style="left:' + S.menu.x + 'px;top:' + S.menu.y + 'px">' + menuItems(d) + '</div>';
    }

    function render() {
      rail = W < 1100 || (!!S.open && docked && W < 1440 && S.view !== 'settings');
      listW = W - (rail ? 56 : 200) - (S.open && docked ? 340 : 0);
      var c = counts(S.items, S.older), list = visible();
      var openD = S.open && byId(S.open);
      var main = S.view === 'settings' ? '<div class="fl-content">' + settingsHTML() + '</div>' :
        '<div class="fl-content"><div class="fl-listwrap">' + toolbar() + (S.items.length || S.older ? listHead(list) : '') + tableHTML(list) + '</div>' + (openD ? detailsHTML(openD, { overlay: !docked, reveal: S.reveal, spark: S.spark }) : '') + '</div>' + (S.items.length ? statusbar() : '');
      var activeEl = document.activeElement, keep = activeEl && root.contains(activeEl) ? (activeEl.getAttribute('data-row') ? '[data-row="' + activeEl.getAttribute('data-row') + '"]' : activeEl.hasAttribute('data-q') ? '[data-q]' : activeEl.hasAttribute('data-url') ? '[data-url]' : null) : null;
      root.innerHTML = '<div class="fl fl-window" style="width:' + W + 'px;height:' + H + 'px" data-win>' +
        '<header class="fl-titlebar"><div class="fl-brand">' + mark(16) + '<span>Fetchlane</span></div><div class="fl-caption"><button aria-label="Minimize" tabindex="-1">' + icon('minimize') + '</button><button aria-label="Maximize" tabindex="-1">' + icon('maximize') + '</button><button class="close" aria-label="Close" tabindex="-1">' + icon('close') + '</button></div></header>' +
        '<div class="fl-body">' + sidebar(c) + '<main class="fl-main">' + main + '</main></div>' + menuHTML() + dialogHTML() + (S.toast ? '<div class="fl-tip" role="status" style="left:50%;transform:translateX(-50%);bottom:44px">' + S.toast + '</div>' : '') + '</div>';
      elWin = root.firstChild;
      if (keep) { var k = root.querySelector(keep); if (k) { k.focus(); if (k.hasAttribute('data-q') || k.hasAttribute('data-url')) { var v = k.value; k.value = ''; k.value = v; } } }
      if (S.dialog && opts.live !== false && !keep) { var af = root.querySelector('.fl-dialog [data-autofocus], .fl-dialog input:not([disabled])'); if (af && opts.interactive) af.focus(); }
      if (S.menu && opts.interactive) { var mi = root.querySelector('.fl-mi:not([disabled])'); if (mi) mi.focus(); }
    }
    function toast(t) { S.toast = t; render(); clearTimeout(toast.t); toast.t = setTimeout(function () { S.toast = null; render(); }, 2200); }

    /* --- actions --- */
    function act(a, id, el) {
      var d = id && byId(id);
      if (a !== 'menu') S.menu = null;
      switch (a) {
        case 'add': S.dialog = { type: 'add', step: 'idle' }; break;
        case 'pastenew': S.dialog = { type: 'add', step: 'idle' }; render(); return act('paste');
        case 'paste': S.dialog.url = 'https://download.kdenlive.org/stable/25.08.2/kdenlive-25.08.2.exe'; check(); return;
        case 'closedlg': S.dialog = null; break;
        case 'scrim': if (el === root.querySelector('.fl-scrim')) S.dialog = null; else return; break;
        case 'dodownload': case 'addqueue':
          var g = S.dialog, q = S.items.filter(function (x) { return x.status === 'queued'; });
          var nd = { id: 'n' + Date.now(), name: root.querySelector('[data-name]').value || g.file, host: hostOf(g.url), url: g.url, total: g.size, done: 0, folder: S.settings.folder, started: 'Today, 14:12', elapsed: 0, resumable: true };
          var full = S.items.filter(function (x) { return x.status === 'downloading' || x.status === 'retrying'; }).length >= S.settings.max;
          if (a === 'dodownload' && !full) { nd.status = 'downloading'; nd.speed = 4.2 * MB; }
          else if (a === 'dodownload') { q.forEach(function (x) { x.pos++; }); nd.status = 'queued'; nd.pos = 1; }
          else { nd.status = 'queued'; nd.pos = q.length + 1; }
          S.items.unshift(nd); S.dialog = null; S.sel.clear(); S.focus = nd.id;
          toast(nd.status === 'queued' ? 'Added to queue as #' + nd.pos : 'Download started'); return;
        case 'pause': d.status = 'paused'; d.speed = null; break;
        case 'resume': d.status = 'downloading'; d.speed = 5.2 * MB; break;
        case 'start': d.status = 'downloading'; d.speed = 4.8 * MB; renumber(); break;
        case 'retrynow': case 'retry': d.status = 'downloading'; d.speed = 2.6 * MB; d.reason = null; break;
        case 'restart': S.dialog = { type: 'restart', id: id }; break;
        case 'dorestart': d = byId(S.dialog.id); d.status = 'downloading'; d.done = 0; d.speed = 7.1 * MB; d.reason = null; d.resumable = false; S.dialog = null; toast('Restarted from the beginning'); return;
        case 'restart0': d.status = 'queued'; d.done = 0; d.pos = S.items.filter(function (x) { return x.status === 'queued'; }).length; d.day = null; renumber(); toast('Added to the end of the queue'); return;
        case 'cancel': S.dialog = { type: 'cancel', id: id }; break;
        case 'docancel': d = byId(S.dialog.id); d.status = 'cancelled'; d.done = 0; d.day = 'today'; d.at = '14:12'; renumber(); S.dialog = null; break;
        case 'remove': S.dialog = { type: 'remove', ids: [id] }; break;
        case 'selremove': S.dialog = { type: 'remove', ids: Array.from(S.sel) }; break;
        case 'togdel': S.dialog.del = !S.dialog.del; break;
        case 'doremove': var ids = S.dialog.ids, del = S.dialog.del; S.items = S.items.filter(function (x) { return ids.indexOf(x.id) < 0; }); ids.forEach(function (i) { S.sel.delete(i); }); if (ids.indexOf(S.open) >= 0) S.open = null; renumber(); S.dialog = null; toast(ids.length + (ids.length > 1 ? ' entries' : ' entry') + ' removed' + (del ? ' · files moved to Recycle Bin' : ' · files kept on disk')); return;
        case 'openfile': toast('Opening ' + d.name + '…'); return;
        case 'openfolder': toast('Showing in File Explorer'); return;
        case 'copylink': toast('Full link copied'); return;
        case 'changefolder': case 'browse': toast('Opens the Windows folder picker'); return;
        case 'details': S.open = id; break;
        case 'closepanel': S.open = null; break;
        case 'reveal': S.reveal = !S.reveal; break;
        case 'spark': S.spark = !S.spark; break;
        case 'menu':
          var r = el.getBoundingClientRect(), wr = elWin.getBoundingClientRect(), sc = wr.width / W;
          var x = (r.right - wr.left) / sc - 228, y = (r.bottom - wr.top) / sc + 4;
          if (y > H - 340) y = (r.top - wr.top) / sc - 330;
          S.menu = S.menu && S.menu.id === id ? null : { id: id, x: Math.max(8, x), y: Math.max(36, y) }; break;
        case 'top': case 'up': case 'downq': move(d, a); break;
        case 'pauseall':
          if (anyActive() && !S.paused) { S.items.forEach(function (x) { if ((x.status === 'downloading' && x.resumable !== false) || x.status === 'retrying') { x.status = 'paused'; x.speed = null; x._was = 1; } }); S.paused = true; }
          else { S.items.forEach(function (x) { if (x.status === 'paused') { x.status = 'downloading'; x.speed = 5.6 * MB; } }); S.paused = false; }
          break;
        case 'selpause': S.items.forEach(function (x) { if (S.sel.has(x.id) && ((x.status === 'downloading' && x.resumable !== false) || x.status === 'retrying')) { x.status = 'paused'; x.speed = null; } }); break;
        case 'selresume': S.items.forEach(function (x) { if (S.sel.has(x.id) && (x.status === 'paused' || x.status === 'queued')) { x.status = 'downloading'; x.speed = 4.4 * MB; } }); renumber(); break;
        case 'selretry': S.items.forEach(function (x) { if (S.sel.has(x.id) && x.status === 'failed' && x.reason !== 'noresume') { x.status = 'downloading'; x.speed = 2.2 * MB; } }); break;
        case 'seltop': S.items.filter(function (x) { return S.sel.has(x.id) && x.status === 'queued'; }).reverse().forEach(function (x) { move(x, 'top'); }); break;
        case 'clearsel': S.sel.clear(); break;
        case 'selall': var l = visible(); if (S.sel.size === l.length) S.sel.clear(); else l.forEach(function (x) { S.sel.add(x.id); }); break;
        case 'check': S.sel.has(id) ? S.sel.delete(id) : S.sel.add(id); S.anchor = id; S.focus = id; break;
        case 'clearq': S.query = ''; break;
        case 'older': toast('Loads 16 older entries from history'); return;
        case 'maxup': S.settings.max = Math.min(10, S.settings.max + 1); break;
        case 'maxdown': S.settings.max = Math.max(1, S.settings.max - 1); break;
        case 'attup': S.settings.attempts = Math.min(10, S.settings.attempts + 1); break;
        case 'attdown': S.settings.attempts = Math.max(1, S.settings.attempts - 1); break;
        case 'clearhist': toast('Asks to confirm, then clears entries — files stay on disk'); return;
        default: return;
      }
      render();
    }
    function renumber() { var q = S.items.filter(function (x) { return x.status === 'queued'; }).sort(function (a, b) { return a.pos - b.pos; }); q.forEach(function (x, i) { x.pos = i + 1; }); }
    function move(d, how) {
      var q = S.items.filter(function (x) { return x.status === 'queued'; }).sort(function (a, b) { return a.pos - b.pos; });
      var i = q.indexOf(d); q.splice(i, 1);
      q.splice(how === 'top' ? 0 : how === 'up' ? Math.max(0, i - 1) : Math.min(q.length, i + 1), 0, d);
      q.forEach(function (x, k) { x.pos = k + 1; });
    }
    var checkT;
    function check() {
      var u = (S.dialog.url || '').trim();
      clearTimeout(checkT);
      if (!u) { S.dialog.step = 'idle'; render(); return; }
      if (/^(magnet:|.*\.torrent$)/i.test(u)) { S.dialog.step = 'unsupported'; render(); return; }
      if (!/^https?:\/\/[^\s\/]+\.[^\s\/]+/i.test(u)) { S.dialog.step = /^https?:\/\/\S*$/i.test(u) && u.length < 12 ? 'idle' : 'invalid'; render(); return; }
      S.dialog.step = 'checking'; render();
      checkT = setTimeout(function () {
        if (!S.dialog) return;
        if (/missing|404/.test(u)) { S.dialog.step = 'http404'; render(); return; }
        var f = decodeURIComponent((u.split('?')[0].split('/').pop() || 'download'));
        S.dialog.file = /\./.test(f) ? f : f + '.bin'; S.dialog.size = 118 * MB; S.dialog.step = 'valid'; render();
      }, 1100);
    }

    /* --- events --- */
    root.addEventListener('click', function (e) {
      var t = e.target.closest('[data-a],[data-view],[data-density],[data-set],[data-setv],[data-row]');
      if (!t || !root.contains(t)) { if (S.menu) { S.menu = null; render(); } return; }
      if (t.hasAttribute('data-view')) { S.view = t.getAttribute('data-view'); S.sel.clear(); S.menu = null; S.query = ''; render(); return; }
      if (t.hasAttribute('data-density')) { S.density = S.settings.density = t.getAttribute('data-density'); render(); return; }
      if (t.hasAttribute('data-set')) { var k = t.getAttribute('data-set'); S.settings[k] = !S.settings[k]; render(); return; }
      if (t.hasAttribute('data-setv')) { var kv = t.getAttribute('data-setv').split(':'); S.settings[kv[0]] = kv[1]; if (kv[0] === 'density') S.density = kv[1]; if (kv[0] === 'theme' && kv[1] !== 'system') document.documentElement.setAttribute('data-theme', kv[1]); render(); return; }
      if (t.hasAttribute('data-a')) { e.stopPropagation(); act(t.getAttribute('data-a'), t.getAttribute('data-id'), t); return; }
      var id = t.getAttribute('data-row');
      if (e.shiftKey && S.anchor) selectRange(S.anchor, id);
      else if (e.ctrlKey || e.metaKey) { S.sel.has(id) ? S.sel.delete(id) : S.sel.add(id); S.anchor = id; }
      else { S.sel = new Set([id]); S.anchor = id; if (S.open) S.open = id; }
      S.focus = id; S.menu = null; render();
    });
    root.addEventListener('dblclick', function (e) { var r = e.target.closest('[data-row]'); if (r && !e.target.closest('[data-a]')) { var d = byId(r.getAttribute('data-row')); if (d.status === 'completed') act('openfile', d.id); else { S.open = d.id; render(); } } });
    root.addEventListener('input', function (e) {
      if (e.target.hasAttribute('data-q')) { S.query = e.target.value; S.sel.clear(); render(); }
      if (e.target.hasAttribute('data-url')) { S.dialog.url = e.target.value; clearTimeout(checkT); checkT = setTimeout(check, 350); }
    });
    function selectRange(a, b) {
      var l = visible().map(function (d) { return d.id; }), i = l.indexOf(a), j = l.indexOf(b);
      if (i < 0 || j < 0) return; S.sel = new Set(l.slice(Math.min(i, j), Math.max(i, j) + 1));
    }
    function orderedIds() { return Array.prototype.map.call(root.querySelectorAll('[data-row]'), function (r) { return r.getAttribute('data-row'); }); }
    root.addEventListener('keydown', function (e) {
      if (S.menu) {
        var items = Array.prototype.slice.call(root.querySelectorAll('.fl-mi:not([disabled])')), i = items.indexOf(document.activeElement);
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus(); return; }
        if (e.key === 'Escape') { var mid = S.menu.id; S.menu = null; render(); var rr = root.querySelector('[data-row="' + mid + '"]'); if (rr) rr.focus(); return; }
        return;
      }
      if (S.dialog) { if (e.key === 'Escape') { S.dialog = null; render(); } if (e.key === 'Enter' && S.dialog && S.dialog.type === 'add' && S.dialog.step === 'valid') act('dodownload'); return; }
      var tag = e.target.tagName;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') { e.preventDefault(); act('add'); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); var q = root.querySelector('[data-q]'); if (q) q.focus(); return; }
      if (tag === 'INPUT') { if (e.key === 'Escape') { S.query = ''; render(); } if (e.key === 'ArrowDown') { var fr = root.querySelector('.fl-row'); if (fr) fr.focus(); } return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') { act('pastenew'); return; }
      var row = e.target.closest && e.target.closest('[data-row]');
      if (!row) { if (e.key === 'Escape' && S.open) { S.open = null; render(); } return; }
      var ids = orderedIds(), id = row.getAttribute('data-row'), idx = ids.indexOf(id), d = byId(id);
      var go = function (n) { n = Math.max(0, Math.min(ids.length - 1, n)); var nid = ids[n]; if (e.shiftKey) { selectRange(S.anchor || id, nid); } else if (!e.ctrlKey) { S.sel = S.sel.size > 1 || S.sel.has(id) ? new Set([nid]) : S.sel; S.anchor = nid; } S.focus = nid; if (S.open) S.open = nid; render(); var r = root.querySelector('[data-row="' + nid + '"]'); r.focus(); r.scrollIntoView({ block: 'nearest' }); };
      if (e.altKey && d.status === 'queued' && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); move(d, e.key === 'ArrowUp' ? 'up' : 'downq'); render(); root.querySelector('[data-row="' + id + '"]').focus(); return; }
      switch (e.key) {
        case 'ArrowDown': e.preventDefault(); go(idx + 1); break;
        case 'ArrowUp': e.preventDefault(); go(idx - 1); break;
        case 'Home': e.preventDefault(); go(0); break;
        case 'End': e.preventDefault(); go(ids.length - 1); break;
        case ' ': e.preventDefault(); S.sel.has(id) ? S.sel.delete(id) : S.sel.add(id); S.anchor = id; render(); break;
        case 'a': if (e.ctrlKey || e.metaKey) { e.preventDefault(); act('selall'); } break;
        case 'Enter': if (d.status === 'completed') act('openfile', id); else { S.open = id; render(); } break;
        case 'i': if (e.ctrlKey) { e.preventDefault(); S.open = id; render(); } break;
        case 'Delete': act(S.sel.size > 1 && S.sel.has(id) ? 'selremove' : 'remove', id); break;
        case 'ContextMenu': case 'F10': if (e.key === 'F10' && !e.shiftKey) break; e.preventDefault(); act('menu', id, row.querySelector('[data-a="menu"]')); break;
        case 'Escape': if (S.sel.size) { S.sel.clear(); render(); } else if (S.open) { S.open = null; render(); } break;
      }
    });
    root.addEventListener('contextmenu', function (e) { var r = e.target.closest('[data-row]'); if (r) { e.preventDefault(); var id = r.getAttribute('data-row'); if (!S.sel.has(id)) S.sel = new Set([id]); act('menu', id, r.querySelector('[data-a="menu"]')); } });

    /* --- live ticking: only text + bar widths update, never a full render --- */
    var tickN = 0;
    var timer = opts.live === false ? null : setInterval(function () {
      tickN++;
      var set = function (k, v) { var el = root.querySelectorAll('[data-m="' + k + '"]'); for (var i = 0; i < el.length; i++) el[i].textContent = v; };
      var total = 0, structural = false;
      S.items.forEach(function (d) {
        if (d.status === 'downloading') {
          d.speed = Math.max(0.6 * MB, d.speed * (0.94 + ((tickN * 7 + d.id.length * 13) % 12) / 100));
          d.done += d.speed; d.elapsed = (d.elapsed || 0) + 1; total += d.speed;
          if (d.total != null && d.done >= d.total) { d.done = d.total; d.status = 'completed'; d.day = 'today'; d.at = '14:12'; structural = true; return; }
          set('speed-' + d.id, fmtSpeed(d.speed)); set('speedd-' + d.id, fmtSpeed(d.speed)); set('el-' + d.id, fmtDur(d.elapsed, true));
          if (d.total != null) {
            var p = pct(d); set('pct-' + d.id, p + '%'); set('pctbig-' + d.id, p + '%');
            set('eta-' + d.id, fmtDur((d.total - d.done) / d.speed)); set('etad-' + d.id, fmtDur((d.total - d.done) / d.speed, true));
            set('of-' + d.id, fmtSize(d.done) + ' of ' + fmtSize(d.total));
            var b = root.querySelector('[data-m="bar-' + d.id + '"]'); if (b) b.style.width = (d.done / d.total * 100).toFixed(2) + '%';
            var sz = root.querySelector('[data-m="size-' + d.id + '"]'); if (sz) sz.innerHTML = fmtPair(d.done, d.total);
          } else { var s2 = root.querySelector('[data-m="size-' + d.id + '"]'); if (s2) s2.innerHTML = fmtPair(d.done, null); set('pctbig-' + d.id, fmtSize(d.done)); }
        }
        if (d.status === 'retrying') {
          d.retryIn = d.retryIn <= 1 ? 15 : d.retryIn - 1; if (d.retryIn === 15) d.attempt = Math.min(d.maxAttempts, d.attempt + 1);
          set('retry-' + d.id, d.retryIn); set('retry2-' + d.id, d.retryIn);
        }
      });
      set('total-speed', fmtSpeed(total) || '0 KB/s');
      if (structural && !S.dialog && !S.menu) render();
    }, 1000);

    render();
    return { state: S, render: render, act: act, stop: function () { clearInterval(timer); } };
  }

  /* fit a fixed-size window into its preview frame */
  function fit(root, w) {
    function f() { var s = Math.min(1, (document.documentElement.clientWidth - 0) / w); root.style.transform = 'scale(' + s + ')'; root.style.transformOrigin = '0 0'; }
    f(); window.addEventListener('resize', f);
  }

  NS.icons = P; NS.icon = icon; NS.mark = mark; NS.fileIcon = fileIcon;
  NS.fmt = { size: fmtSize, pair: fmtPair, speed: fmtSpeed, duration: fmtDur };
  NS.sample = sample; NS.statusHTML = statusHTML; NS.barHTML = barHTML; NS.rowHTML = rowHTML; NS.theadHTML = theadHTML; NS.colsFor = colsFor;
  NS.detailsHTML = detailsHTML; NS.menuItems = menuItems; NS.mountApp = mountApp; NS.fit = fit;
  NS.units = { KB: KB, MB: MB, GB: GB };
})();
