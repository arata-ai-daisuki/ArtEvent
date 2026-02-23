/**
 * ArtEventManager - Side Panel JavaScript
 * イベント表示、カレンダー、ガントチャート、ステータス管理
 */

// ─── 状態管理 ───
let allEvents = [];
let currentFilter = 'active'; // active, done, all
let calendarInstance = null;

// バックグラウンドとの接続維持（バッジクリア用）
const port = chrome.runtime.connect({ name: 'ArtEventManager-sidepanel' });

// ─── 初期化 ───
document.addEventListener('DOMContentLoaded', async () => {
  setupTabs();
  setupFilters();
  setupRefresh();
  setupReset();
  setupUrlCollection(); // URL収集機能のセットアップ
  setupModal(); // モーダル初期化
  updateTodayDate();
  await loadEvents();
  initCalendar();
  initMermaid();

  // イベントデリゲーション初期化
  setupEventDelegation('todayList');
  setupEventDelegation('allList');
});

// ─── URL手動収集 ───
function setupUrlCollection() {
  const input = document.getElementById('collectUrlInput');
  const btn = document.getElementById('collectBtn');
  const statusDiv = document.getElementById('collectStatus');

  const handleCollect = async () => {
    const url = input.value.trim();
    if (!url) return;

    // UIをLoading状態に
    btn.disabled = true;
    btn.innerHTML = `<svg class="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg><span>処理中...</span>`;
    statusDiv.textContent = 'ページの読み込みと解析中...';
    statusDiv.className = 'mt-1 text-[10px] text-accent-blue min-h-[15px]';

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'COLLECT_URL',
        data: { url }
      });

      if (response && response.success) {
        statusDiv.textContent = `✅ イベントを追加しました: ${response.eventName}`;
        statusDiv.className = 'mt-1 text-[10px] text-green-400 min-h-[15px]';
        input.value = ''; // 入力をクリア
        await loadEvents(); // リスト更新
      } else {
        throw new Error(response.error || '不明なエラー');
      }
    } catch (error) {
      console.error('[ArtEventManager] 収集エラー:', error);
      statusDiv.textContent = `❌ エラー: ${error.message}`;
      statusDiv.className = 'mt-1 text-[10px] text-red-400 min-h-[15px]';
    } finally {
      // UIを元に戻す
      btn.disabled = false;
      btn.innerHTML = '<span>収集</span>';

      // 3秒後にステータスを消す
      setTimeout(() => {
        if (statusDiv.textContent.includes('✅')) {
          statusDiv.textContent = '';
        }
      }, 5000);
    }
  };

  btn.addEventListener('click', handleCollect);
  input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleCollect();
  });
}

// バックグラウンドからのイベント更新を受信
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'EVENT_UPDATED') {
    allEvents = message.data;
    renderAll();
  }
});

// ─── データ読み込み ───
async function loadEvents() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_EVENTS' });
    if (response && response.success) {
      allEvents = response.events;
      renderAll();
    }
  } catch (error) {
    console.error('[antigravity] イベント読み込みエラー:', error);
  }
}

// ─── 全体レンダリング ───
function renderAll() {
  renderTodayEvents();
  renderAllEvents();
  renderGanttChart();
  updateCalendar();
  updateEventCount();
}

// ─── イベント件数更新 ───
function updateEventCount() {
  const activeCount = allEvents.filter(e => !e.isDone).length;
  document.getElementById('eventCount').textContent = `${activeCount} 件`;
}

// ─── 今日の日付表示 ───
function updateTodayDate() {
  const today = new Date();
  const options = { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' };
  document.getElementById('todayDate').textContent = today.toLocaleDateString('ja-JP', options);
}

// ─── ステータス判定 ───
function getEventStatus(event) {
  if (event.isDone) return 'done';
  if (!event.deadline) return 'safe';

  const now = new Date();
  const deadline = new Date(event.deadline);
  const diffMs = deadline - now;
  const diffHours = diffMs / (1000 * 60 * 60);

  if (diffHours <= 0) return 'done'; // 期限切れ
  if (diffHours <= 24) return 'urgent';
  if (diffHours <= 72) return 'warn';
  return 'safe';
}

function getStatusLabel(status) {
  switch (status) {
    case 'safe': return '余裕あり';
    case 'warn': return '期限間近';
    case 'urgent': return '24h以内';
    case 'done': return '済';
    default: return '';
  }
}

// ─── 日付フォーマット ───
function formatDate(dateStr) {
  if (!dateStr) return '期限未定';
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function formatDateFull(dateStr) {
  if (!dateStr) return '期限未定';
  const d = new Date(dateStr);
  return d.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' });
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const now = new Date();
  const deadline = new Date(dateStr);
  const diff = Math.ceil((deadline - now) / (1000 * 60 * 60 * 24));
  return diff;
}

// ─── イベントカードHTML生成 ───
function createEventCard(event) {
  const status = getEventStatus(event);
  const statusLabel = getStatusLabel(status);
  const days = daysUntil(event.deadline);
  let daysText = '';
  if (days !== null && !event.isDone) {
    if (days > 0) daysText = `あと${days}日`;
    else if (days === 0) daysText = '今日まで';
    else daysText = '期限切れ';
  }

  const tagsHtml = event.hashtags && event.hashtags.length > 0
    ? event.hashtags.map(tag => `<span class="hashtag">${escapeHtml(tag)}</span>`).join('')
    : '';

  return `
    <div class="event-card status-${status}" data-id="${event.id}">
      <div class="flex items-start gap-3">
        <button class="check-btn ${event.isDone ? 'checked' : ''}" 
                data-id="${event.id}"
                data-is-done="${event.isDone}"
                title="${event.isDone ? '未着手に戻す' : '完了にする'}">
        </button>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 mb-1">
            <span class="text-sm font-medium ${event.isDone ? 'line-through text-gray-500' : 'text-white'} truncate">
              ${escapeHtml(event.eventName)}
            </span>
          </div>
          <div class="flex items-center gap-2 flex-wrap">
            <span class="status-badge ${status}">${statusLabel}</span>
            ${event.deadline ? `<span class="text-xs text-gray-400">〆 ${formatDate(event.deadline)}</span>` : ''}
            ${daysText ? `<span class="text-xs text-gray-500">${daysText}</span>` : ''}
          </div>
          ${tagsHtml ? `<div class="mt-1.5">${tagsHtml}</div>` : ''}
        </div>
      </div>
    </div>
  `;
}

// ─── イベントデリゲーション設定 ───
function setupEventDelegation(containerId) {
  const container = document.getElementById(containerId);
  container.addEventListener('click', (e) => {
    // チェックボタンのクリック判定
    const checkBtn = e.target.closest('.check-btn');
    if (checkBtn) {
      e.stopPropagation(); // カードのクリックイベントを阻止
      const id = checkBtn.dataset.id;
      const isDone = checkBtn.dataset.isDone === 'true';
      toggleStatus(id, !isDone);
      return;
    }

    // カード自体のクリック判定
    const card = e.target.closest('.event-card');
    if (card) {
      const id = card.dataset.id;
      openEventDetail(id);
    }
  });
}

// ─── 今日のイベント表示 ───
function renderTodayEvents() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const todayEvents = allEvents.filter(event => {
    // 参加済みでも今日のイベントには表示する（消えないようにする）

    const startDate = new Date(event.timestamp);
    startDate.setHours(0, 0, 0, 0);

    if (event.deadline) {
      const endDate = new Date(event.deadline);
      endDate.setHours(23, 59, 59, 999);
      return today >= startDate && today <= endDate;
    }

    // 締切未定のイベントは常に表示
    return true;
  });

  const container = document.getElementById('todayList');

  if (todayEvents.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p class="text-gray-500 text-sm text-center py-8">
          🎉 今日のイベントはありません
        </p>
      </div>
    `;
    return;
  }

  // ステータス順にソート: urgent > warn > safe
  const priorityOrder = { urgent: 0, warn: 1, safe: 2, done: 3 };
  todayEvents.sort((a, b) => {
    const sa = priorityOrder[getEventStatus(a)] ?? 2;
    const sb = priorityOrder[getEventStatus(b)] ?? 2;
    return sa - sb;
  });

  container.innerHTML = todayEvents.map(createEventCard).join('');
}

// ─── 全イベント表示 ───
function renderAllEvents() {
  let filteredEvents = [...allEvents];

  switch (currentFilter) {
    case 'active':
      filteredEvents = filteredEvents.filter(e => !e.isDone);
      break;
    case 'done':
      filteredEvents = filteredEvents.filter(e => e.isDone);
      break;
    // 'all' はそのまま
  }

  // 期限順にソート
  filteredEvents.sort((a, b) => {
    if (!a.deadline && !b.deadline) return 0;
    if (!a.deadline) return 1;
    if (!b.deadline) return -1;
    return new Date(a.deadline) - new Date(b.deadline);
  });

  const container = document.getElementById('allList');

  if (filteredEvents.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p class="text-gray-500 text-sm text-center py-8">
          イベントが見つかりません
        </p>
      </div>
    `;
    return;
  }

  container.innerHTML = filteredEvents.map(createEventCard).join('');
}

// ─── カレンダー初期化 ───
function initCalendar() {
  const calendarEl = document.getElementById('calendar');
  calendarInstance = new FullCalendar.Calendar(calendarEl, {
    initialView: 'dayGridMonth',
    locale: 'ja',
    height: 'auto',
    headerToolbar: {
      left: 'prev',
      center: 'title',
      right: 'next'
    },
    events: getCalendarEvents(),
    eventClick: function (info) {
      const eventId = info.event.extendedProps.eventId;
      openEventDetail(eventId);
    },
    dayCellDidMount: function (arg) {
      // 今日のセルをハイライト
      const today = new Date();
      if (arg.date.toDateString() === today.toDateString()) {
        arg.el.style.background = 'rgba(99, 102, 241, 0.08)';
      }
    }
  });
  calendarInstance.render();
}

function getCalendarEvents() {
  return allEvents
    .filter(e => e.deadline)
    .map(event => {
      const status = getEventStatus(event);
      const colors = {
        safe: '#3b82f6',
        warn: '#f59e0b',
        urgent: '#ef4444',
        done: '#6b7280'
      };

      return {
        title: event.eventName,
        start: event.timestamp,
        end: event.deadline,
        color: colors[status] || '#3b82f6',
        extendedProps: { eventId: event.id }
      };
    });
}

function updateCalendar() {
  if (!calendarInstance) return;
  calendarInstance.removeAllEvents();
  calendarInstance.addEventSource(getCalendarEvents());
}

// ─── Mermaid初期化 ───
function initMermaid() {
  mermaid.initialize({
    startOnLoad: false,
    theme: 'dark',
    themeVariables: {
      darkMode: true,
      background: '#1a1a24',
      primaryColor: '#6366f1',
      primaryTextColor: '#e5e7eb',
      primaryBorderColor: '#6366f1',
      lineColor: '#4b5563',
      sectionBkgColor: '#22223a',
      altSectionBkgColor: '#1a1a24',
      gridColor: 'rgba(255, 255, 255, 0.06)',
      todayLineColor: '#ef4444'
    }
  });
}

// ─── ガントチャート描画（カスタムHTML版） ───
function renderGanttChart() {
  const container = document.getElementById('ganttChart');
  const eventsWithDeadline = allEvents.filter(e => e.deadline);

  if (eventsWithDeadline.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p class="text-gray-500 text-sm text-center py-4">
          期限付きイベントがありません
        </p>
      </div>
    `;
    return;
  }

  // 日付範囲の算出
  const now = new Date();
  const allDates = eventsWithDeadline.flatMap(e => [
    new Date(e.timestamp),
    new Date(e.deadline)
  ]);
  allDates.push(now);

  const minDate = new Date(Math.min(...allDates));
  const maxDate = new Date(Math.max(...allDates));

  // 前後に余裕を持たせる
  minDate.setDate(minDate.getDate() - 1);
  maxDate.setDate(maxDate.getDate() + 3);

  const totalDays = Math.ceil((maxDate - minDate) / (1000 * 60 * 60 * 24));

  // ソート: 期限順
  eventsWithDeadline.sort((a, b) => new Date(a.deadline) - new Date(b.deadline));

  // バーを生成
  const barsHtml = eventsWithDeadline.map(event => {
    const start = new Date(event.timestamp);
    const end = new Date(event.deadline);
    const status = getEventStatus(event);

    const startOffset = Math.max(0, (start - minDate) / (1000 * 60 * 60 * 24));
    const duration = Math.max(1, (end - start) / (1000 * 60 * 60 * 24));

    const leftPercent = (startOffset / totalDays) * 100;
    const widthPercent = (duration / totalDays) * 100;

    return `
      <div class="gantt-bar-container" onclick="openEventDetail('${event.id}')" style="cursor:pointer">
        <div class="gantt-label" title="${escapeHtml(event.eventName)}">${escapeHtml(event.eventName)}</div>
        <div class="gantt-bar-track">
          <div class="gantt-bar ${status}" style="left:${leftPercent}%;width:${widthPercent}%"></div>
        </div>
      </div>
    `;
  }).join('');

  // 今日の線の位置
  const todayOffset = (now - minDate) / (1000 * 60 * 60 * 24);
  const todayPercent = (todayOffset / totalDays) * 100;

  // 日付ラベル
  const labelCount = 5;
  const labelsHtml = Array.from({ length: labelCount }, (_, i) => {
    const d = new Date(minDate.getTime() + (totalDays / (labelCount - 1)) * i * 24 * 60 * 60 * 1000);
    return `<span class="gantt-date-label">${d.getMonth() + 1}/${d.getDate()}</span>`;
  }).join('');

  container.innerHTML = `
    <div style="position:relative">
      <div style="position:absolute;left:${todayPercent}%;top:0;bottom:0;width:2px;background:rgba(239,68,68,0.5);z-index:10;pointer-events:none">
        <span style="position:absolute;top:-16px;left:-10px;font-size:0.6rem;color:#ef4444">今日</span>
      </div>
      ${barsHtml}
    </div>
    <div class="gantt-date-labels">${labelsHtml}</div>
  `;
}

// ─── イベント詳細モーダル ───
function openEventDetail(eventId) {
  console.log('[ArtEventManager] Opening detail for:', eventId);
  const event = allEvents.find(e => e.id === eventId);
  if (!event) {
    console.error('[ArtEventManager] Event not found for ID:', eventId);
    return;
  }
  console.log('[ArtEventManager] Event data:', event);

  const status = getEventStatus(event);
  const statusLabel = getStatusLabel(status);
  const days = daysUntil(event.deadline);

  document.getElementById('modalTitle').textContent = event.eventName;

  let bodyHtml = '';

  // ステータスと期限
  bodyHtml += `
    <div class="flex items-center gap-3 flex-wrap">
      <span class="status-badge ${status}">${statusLabel}</span>
      <span class="text-sm text-gray-400">〆 ${formatDateFull(event.deadline)}</span>
      ${days !== null && !event.isDone ? `<span class="text-sm text-gray-500">（あと${days}日）</span>` : ''}
    </div>
  `;

  // ステータス切替ボタン
  bodyHtml += `
    <div>
      <button class="toggle-status-btn px-4 py-2 rounded-lg text-sm font-medium transition-colors
                     ${event.isDone
      ? 'bg-gray-700 hover:bg-gray-600 text-gray-300'
      : 'bg-accent-blue hover:bg-accent-blue/80 text-white'}"
              data-id="${event.id}"
              data-is-done="${event.isDone}">
        ${event.isDone ? '⬜ 未着手に戻す' : '✅ 参加済みにする'}
      </button>
    </div>
  `;

  // ハッシュタグ
  if (event.hashtags && event.hashtags.length > 0) {
    bodyHtml += `
      <div>
        <h4 class="text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wider">タグ</h4>
        <div class="flex flex-wrap">
          ${event.hashtags.map(tag => `<span class="hashtag">${escapeHtml(tag)}</span>`).join('')}
        </div>
      </div>
    `;
  }

  // ルール
  if (event.rules && event.rules.length > 0) {
    bodyHtml += `
      <div>
        <h4 class="text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wider">📋 詳細・ルール</h4>
        <div class="bg-surface rounded-lg p-3">
          ${event.rules.map(rule => `<div class="rule-item">${escapeHtml(rule)}</div>`).join('')}
        </div>
      </div>
    `;
  }

  // メモ
  bodyHtml += `
    <div>
      <h4 class="text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wider">📝 メモ</h4>
      <textarea class="memo-textarea" 
                id="memoInput" 
                placeholder="自由にメモを入力...">${escapeHtml(event.memo || '')}</textarea>
    </div>
  `;

  // 画像表示
  if (event.images && event.images.length > 0) {
    bodyHtml += `
      <div>
        <h4 class="text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wider">📷 添付画像</h4>
        <div class="grid grid-cols-2 gap-2">
          ${event.images.map(imgUrl => `
            <a href="${imgUrl}" target="_blank" class="block overflow-hidden rounded-lg border border-white/10 hover:border-accent-blue/50 transition-colors">
              <img src="${imgUrl}" alt="Event Image" class="w-full h-auto object-cover" loading="lazy">
            </a>
          `).join('')}
        </div>
      </div>
    `;
  }

  // 元ポストへのリンク
  if (event.postUrl) {
    bodyHtml += `
      <div class="pt-2 border-t border-white/5">
        <a href="${escapeHtml(event.postUrl)}" target="_blank" rel="noopener noreferrer"
           class="text-xs text-accent-blue hover:underline flex items-center gap-1">
          <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
          </svg>
          元ポストを開く
        </a>
      </div>
    `;
  }

  // 削除ボタン
  bodyHtml += `
    <div class="pt-2">
      <button class="delete-event-btn text-xs text-red-400 hover:text-red-300 transition-colors"
              data-id="${event.id}">
        🗑 このイベントを削除
      </button>
    </div>
    `;

  document.getElementById('modalBody').innerHTML = bodyHtml;
  document.getElementById('eventModal').classList.remove('hidden');

  // メモ保存イベントリスナー設定
  const memoInput = document.getElementById('memoInput');
  if (memoInput) {
    memoInput.addEventListener('blur', (e) => {
      saveMemo(event.id, e.target.value);
    });
  }
}

function closeModal() {
  document.getElementById('eventModal').classList.add('hidden');
}

// ─── アクション ───
async function toggleStatus(id, isDone) {
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'UPDATE_EVENT_STATUS',
      data: { id, isDone }
    });
    if (response && response.success) {
      const event = allEvents.find(e => e.id === id);
      if (event) event.isDone = isDone;
      renderAll();
    }
  } catch (error) {
    console.error('[antigravity] ステータス更新エラー:', error);
  }
}

async function saveMemo(id, memo) {
  try {
    await chrome.runtime.sendMessage({
      type: 'UPDATE_EVENT_MEMO',
      data: { id, memo }
    });
    const event = allEvents.find(e => e.id === id);
    if (event) event.memo = memo;
  } catch (error) {
    console.error('[antigravity] メモ保存エラー:', error);
  }
}

async function deleteEvent(id) {
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'DELETE_EVENT',
      data: { id }
    });
    if (response && response.success) {
      allEvents = allEvents.filter(e => e.id !== id);
      renderAll();
    }
  } catch (error) {
    console.error('[antigravity] 削除エラー:', error);
  }
}

// ─── タブ操作 ───
function setupTabs() {
  const tabBtns = document.querySelectorAll('.tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      // アクティブタブ切替
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // コンテンツ切替
      const tabName = btn.dataset.tab;
      document.querySelectorAll('.tab-content').forEach(section => {
        section.classList.add('hidden');
        section.classList.remove('active');
      });
      const section = document.getElementById(`${tabName}Section`);
      section.classList.remove('hidden');
      section.classList.add('active');

      // カレンダー表示時にリサイズ
      if (tabName === 'calendar' && calendarInstance) {
        setTimeout(() => calendarInstance.updateSize(), 100);
      }
    });
  });
}

// ─── フィルター操作 ───
function setupFilters() {
  const filterBtns = document.querySelectorAll('.filter-btn');
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      renderAllEvents();
    });
  });
}

// ─── 更新ボタン ───
function setupRefresh() {
  document.getElementById('refreshBtn').addEventListener('click', () => {
    loadEvents();
  });
}

// ─── リセットボタン ───
function setupReset() {
  document.getElementById('resetBtn').addEventListener('click', async () => {
    if (!confirm('⚠️ 全イベントデータを削除しますか？\nこの操作は取り消せません。')) {
      return;
    }
    try {
      await chrome.storage.local.set({ events: [] });
      allEvents = [];
      renderAll();
      console.log('[ArtEventManager] 全データをリセットしました');
    } catch (error) {
      console.error('[ArtEventManager] リセットエラー:', error);
    }
  });
}

// ─── ユーティリティ ───
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ─── モーダル操作 ───
function setupModal() {
  const backdrop = document.getElementById('modalBackdrop');
  const closeBtn = document.getElementById('closeModalBtn');

  if (backdrop) {
    backdrop.addEventListener('click', closeModal);
  }
  if (closeBtn) {
    closeBtn.addEventListener('click', closeModal);
  }

  // ESCキーで閉じる
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const modal = document.getElementById('eventModal');
      if (modal && !modal.classList.contains('hidden')) {
        closeModal();
      }
    }
  });

  // グローバル公開は不要になったため削除
  // window.closeModal = closeModal;
  // window.deleteEvent = deleteEvent;
  // window.toggleStatus = toggleStatus;
  // window.saveMemo = saveMemo;

  // モーダル内のイベントデリゲーション
  const modalBody = document.getElementById('modalBody');
  modalBody.addEventListener('click', (e) => {
    // ステータス切替ボタン
    const toggleBtn = e.target.closest('.toggle-status-btn');
    if (toggleBtn) {
      const id = toggleBtn.dataset.id;
      const isDone = toggleBtn.dataset.isDone === 'true';
      toggleStatus(id, !isDone);
      closeModal();
      return;
    }

    // 削除ボタン
    const deleteBtn = e.target.closest('.delete-event-btn');
    if (deleteBtn) {
      if (confirm('このイベントを削除しますか？')) {
        const id = deleteBtn.dataset.id;
        deleteEvent(id);
        closeModal();
      }
      return;
    }
  });
}

function closeModal() {
  const modal = document.getElementById('eventModal');
  if (modal) {
    modal.classList.add('hidden');
    // メモリリーク防止のため中身をクリアしないほうがいいかも？今回はそのまま非表示にするだけ
  }
}
