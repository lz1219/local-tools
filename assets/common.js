function $(id) { return document.getElementById(id); }

function updateLineNumbers(textarea, gutter) {
    var count = textarea.value.split('\n').length || 1;
    var html = '';
    for (var i = 1; i <= count; i++) html += '<div>' + i + '</div>';
    gutter.innerHTML = html;
}

function syncScroll(textarea, gutter) {
    gutter.scrollTop = textarea.scrollTop;
}

function showToast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(function () { t.classList.remove('show'); }, 1500);
}

function formatSize(len) {
    if (len > 1048576) return (len / 1048576).toFixed(1) + 'MB';
    if (len > 1024) return (len / 1024).toFixed(1) + 'KB';
    return len + 'B';
}

function updateSize(inputId, badgeId) {
    var len = $(inputId).value.length;
    $(badgeId).textContent = len > 0 ? formatSize(len) : '';
}

// Bind a line-number gutter (and optional size badge) to a textarea.
function bindEditor(textareaId, gutterId, badgeId) {
    var ta = $(textareaId), gutter = $(gutterId);
    ta.addEventListener('input', function () {
        updateLineNumbers(ta, gutter);
        if (badgeId) updateSize(textareaId, badgeId);
    });
    ta.addEventListener('scroll', function () { syncScroll(ta, gutter); });
    updateLineNumbers(ta, gutter);
    if (badgeId) updateSize(textareaId, badgeId);
}
