/* ── LeLibrary Toast System ─────────────────────────────── */
/* Standalone toast notifications for any page.              */
/* Usage: LeToast.show('Message', 'error'|'success'|'info') */
/*        LeToast.success('Saved')                          */
/*        LeToast.error('Failed')                           */
/*        LeToast.info('Heads up')                          */

(function () {
  'use strict';

  var CONTAINER_CLASS = 'letoast-container';
  var TOAST_CLASS = 'letoast';
  var DEFAULT_DURATION = 4000;
  var MAX_VISIBLE = 4;

  var container = null;

  function ensureContainer() {
    if (container) return container;
    container = document.createElement('div');
    container.className = CONTAINER_CLASS;
    document.body.appendChild(container);
    return container;
  }

  function iconForType(type) {
    if (type === 'error') return '\u2715';   // ✕
    if (type === 'success') return '\u2713'; // ✓
    return '!'; // info
  }

  /**
   * Show a toast notification.
   * @param {string} msg - The message to display.
   * @param {'error'|'success'|'info'} [type='info'] - Toast type.
   * @param {number} [duration=4000] - Auto-dismiss time in ms. 0 = no auto-dismiss.
   */
  function show(msg, type, duration) {
    type = type || 'info';
    duration = duration !== undefined ? duration : DEFAULT_DURATION;

    var c = ensureContainer();

    // Enforce max visible: remove oldest if over limit
    while (c.children.length >= MAX_VISIBLE) {
      removeToast(c.children[0]);
    }

    var el = document.createElement('div');
    el.className = TOAST_CLASS + ' ' + type;

    var icon = document.createElement('div');
    icon.className = 'letoast-icon';
    icon.textContent = iconForType(type);

    var text = document.createElement('div');
    text.className = 'letoast-text';
    text.textContent = msg;

    var close = document.createElement('button');
    close.className = 'letoast-close';
    close.textContent = '\u2715';
    close.setAttribute('aria-label', 'Dismiss');
    close.onclick = function (e) {
      e.stopPropagation();
      removeToast(el);
    };

    el.appendChild(icon);
    el.appendChild(text);
    el.appendChild(close);

    // Progress bar (only when auto-dismissing)
    var bar = null;
    if (duration > 0) {
      bar = document.createElement('div');
      bar.className = 'letoast-bar';
      bar.style.width = '100%';
      el.appendChild(bar);
    }

    // Click to dismiss
    el.onclick = function () { removeToast(el); };

    // Pause on hover
    var paused = false;
    var remaining = duration;
    var startTime = Date.now();
    var animFrame = null;

    function startBar() {
      if (!bar) return;
      startTime = Date.now();
      bar.style.transition = 'none';
      bar.style.width = '100%';
      // Force reflow
      bar.offsetWidth;
      bar.style.transition = 'width ' + remaining + 'ms linear';
      bar.style.width = '0%';
    }

    var timer = null;
    function startTimer() {
      if (timer) clearTimeout(timer);
      if (duration > 0 && !paused) {
        timer = setTimeout(function () { removeToast(el); }, remaining);
      }
    }

    function pauseBar() {
      if (paused) return;
      paused = true;
      if (timer) { clearTimeout(timer); timer = null; }
      var elapsed = Date.now() - startTime;
      remaining = Math.max(0, remaining - elapsed);
      if (bar) {
        var currentWidth = (remaining / duration) * 100;
        bar.style.transition = 'none';
        bar.style.width = currentWidth + '%';
      }
    }

    function resumeBar() {
      if (!paused) return;
      paused = false;
      if (bar) startBar();
      startTimer();
    }

    if (duration > 0) {
      el.addEventListener('mouseenter', pauseBar);
      el.addEventListener('mouseleave', resumeBar);
    }

    c.appendChild(el);

    // Trigger entrance animation
    requestAnimationFrame(function () {
      if (bar) startBar();
    });

    // Auto-dismiss
    if (duration > 0) {
      startTimer();
    }

    // Store cleanup on the element
    el._letoastCleanup = function () {
      if (timer) clearTimeout(timer);
      if (animFrame) cancelAnimationFrame(animFrame);
    };

    return el;
  }

  function removeToast(el) {
    if (!el || !el.parentNode) return;
    if (el._removing) return;
    el._removing = true;
    if (el._letoastCleanup) el._letoastCleanup();
    el.classList.add('removing');
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 250);
  }

  // Public API
  window.LeToast = {
    show: show,
    error: function (msg, duration) { return show(msg, 'error', duration); },
    success: function (msg, duration) { return show(msg, 'success', duration); },
    info: function (msg, duration) { return show(msg, 'info', duration); },
    dismiss: removeToast,
  };
})();
