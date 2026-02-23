/**
 * ArtEventManager - Background Service Worker
 * サイドパネルの制御とContent Script ↔ サイドパネル間のメッセージ中継
 */

// ─── アイコンクリックでサイドパネルを開く ───
chrome.action.onClicked.addListener(async (tab) => {
    await chrome.sidePanel.open({ tabId: tab.id });
});

// ─── サイドパネルの挙動設定 ───
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// ─── メッセージリスナー ───
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
        case 'EVENT_DETECTED':
            // Content Scriptからイベント検知を受信 → ストレージに保存
            handleEventDetected(message.data);
            break;

        case 'GET_EVENTS':
            // サイドパネルからのイベント取得リクエスト
            handleGetEvents(sendResponse);
            return true; // 非同期レスポンスを示す

        case 'UPDATE_EVENT_STATUS':
            // ステータス更新
            handleUpdateStatus(message.data, sendResponse);
            return true;

        case 'UPDATE_EVENT_MEMO':
            // メモ更新
            handleUpdateMemo(message.data, sendResponse);
            return true;

        case 'DELETE_EVENT':
            // イベント削除
            handleDeleteEvent(message.data, sendResponse);
            return true;

        case 'COLLECT_URL':
            // URLからイベント収集
            handleCollectUrl(message.data, sendResponse);
            return true;
    }
});

/**
 * 指定URLからイベントを収集
 */
async function handleCollectUrl(data, sendResponse) {
    const targetUrl = data.url;
    let tabId = null;
    let createdTab = false;

    try {
        // 1. 既存のタブを探す
        const tabs = await chrome.tabs.query({ url: targetUrl });
        if (tabs.length > 0) {
            tabId = tabs[0].id;
        } else {
            // 2. なければ裏でタブを作成
            const tab = await chrome.tabs.create({ url: targetUrl, active: false });
            tabId = tab.id;
            createdTab = true;

            // 読み込み完了を待つ
            await new Promise((resolve, reject) => {
                const listener = (tid, changeInfo) => {
                    if (tid === tabId && changeInfo.status === 'complete') {
                        chrome.tabs.onUpdated.removeListener(listener);
                        // SPAの描画待ち（少し余裕を持たせる）
                        setTimeout(resolve, 3000);
                    }
                };
                chrome.tabs.onUpdated.addListener(listener);
                // タイムアウト設定（15秒）
                setTimeout(() => {
                    chrome.tabs.onUpdated.removeListener(listener);
                    reject(new Error('タイムアウト: ページの読み込みが遅すぎます'));
                }, 15000);
            });
        }

        // 3. コンテンツスクリプトに抽出を依頼
        let response;
        try {
            response = await sendMessageWithRetry(tabId, { type: 'EXTRACT_EVENT' });
        } catch (e) {
            // 接続エラーの場合、タブが古い（拡張機能更新前）可能性があるためリロードして再試行
            console.log('[ArtEventManager] コンテンツスクリプト接続失敗。タブをリロードします:', e.message);

            await chrome.tabs.reload(tabId);

            // リロード完了待ち
            await new Promise((resolve, reject) => {
                const listener = (tid, changeInfo) => {
                    if (tid === tabId && changeInfo.status === 'complete') {
                        chrome.tabs.onUpdated.removeListener(listener);
                        setTimeout(resolve, 3000); // 描画待ち
                    }
                };
                chrome.tabs.onUpdated.addListener(listener);
                setTimeout(() => {
                    chrome.tabs.onUpdated.removeListener(listener);
                    reject(new Error('リロードタイムアウト'));
                }, 15000);
            });

            // 再試行
            response = await sendMessageWithRetry(tabId, { type: 'EXTRACT_EVENT' });
        }

        if (response && response.success && response.data) {
            await handleEventDetected(response.data);
            sendResponse({ success: true, eventName: response.data.eventName });
        } else {
            throw new Error('イベント情報を抽出できませんでした。ポストが表示されていないか、形式が対応していません。');
        }

    } catch (error) {
        console.error('[ArtEventManager] URL収集エラー:', error);
        sendResponse({ success: false, error: error.message });
    } finally {
        // 自分で作ったタブなら閉じる
        if (createdTab && tabId) {
            chrome.tabs.remove(tabId).catch(() => { });
        }
    }
}

/**
 * sendMessageのラッパー（失敗時に例外を投げる）
 */
function sendMessageWithRetry(tabId, message) {
    return new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, message, (response) => {
            if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
            } else {
                resolve(response);
            }
        });
    });
}

/**
 * 検知されたイベントをストレージに保存（重複チェック付き）
 */
/**
 * 検知されたイベントをストレージに保存（重複チェック付き）
 */
async function handleEventDetected(eventData) {
    try {
        const result = await chrome.storage.local.get('events');
        const events = result.events || [];

        // 重複チェック: ポストURLが同じなら保存しない
        const isDuplicate = events.some(e => e.postUrl === eventData.postUrl);
        if (isDuplicate) {
            console.log('[ArtEventManager] 重複イベントをスキップ:', eventData.postUrl);
            return;
        }

        // 新しいイベントを追加
        const newEvent = {
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            postUrl: eventData.postUrl,
            eventName: eventData.eventName,
            deadline: eventData.deadline,
            hashtags: eventData.hashtags,
            rules: eventData.rules,
            images: eventData.images || [],
            rawText: eventData.rawText,
            isDone: false,
            memo: ''
        };

        events.push(newEvent);
        await chrome.storage.local.set({ events });

        console.log('[ArtEventManager] イベント保存:', newEvent.eventName);

        // バッジを表示（NEW!）
        chrome.action.setBadgeText({ text: '!' });
        chrome.action.setBadgeBackgroundColor({ color: '#FF0000' });

        // サイドパネルに通知
        chrome.runtime.sendMessage({
            type: 'EVENT_UPDATED',
            data: events
        }).catch(() => {
            // サイドパネルが閉じている場合は無視
        });
    } catch (error) {
        console.error('[ArtEventManager] イベント保存エラー:', error);
    }
}

// ─── サイドパネル接続監視（バッジクリア） ───
chrome.runtime.onConnect.addListener((port) => {
    if (port.name === 'ArtEventManager-sidepanel') {
        // サイドパネルが開かれたらバッジを消す
        chrome.action.setBadgeText({ text: '' });
    }
});

/**
 * ストレージからイベント一覧を取得
 */
async function handleGetEvents(sendResponse) {
    try {
        const result = await chrome.storage.local.get('events');

        // イベント取得要求が来たということはサイドパネルが開いているのでバッジを消す
        chrome.action.setBadgeText({ text: '' });

        sendResponse({ success: true, events: result.events || [] });
    } catch (error) {
        console.error('[ArtEventManager] イベント取得エラー:', error);
        sendResponse({ success: false, error: error.message });
    }
}

/**
 * イベントのステータスを更新
 */
async function handleUpdateStatus(data, sendResponse) {
    try {
        const result = await chrome.storage.local.get('events');
        const events = result.events || [];
        const index = events.findIndex(e => e.id === data.id);

        if (index !== -1) {
            events[index].isDone = data.isDone;
            await chrome.storage.local.set({ events });
            sendResponse({ success: true });

            // サイドパネルに通知
            chrome.runtime.sendMessage({
                type: 'EVENT_UPDATED',
                data: events
            }).catch(() => { });
        } else {
            sendResponse({ success: false, error: 'イベントが見つかりません' });
        }
    } catch (error) {
        sendResponse({ success: false, error: error.message });
    }
}

/**
 * イベントのメモを更新
 */
async function handleUpdateMemo(data, sendResponse) {
    try {
        const result = await chrome.storage.local.get('events');
        const events = result.events || [];
        const index = events.findIndex(e => e.id === data.id);

        if (index !== -1) {
            events[index].memo = data.memo;
            await chrome.storage.local.set({ events });
            sendResponse({ success: true });
        } else {
            sendResponse({ success: false, error: 'イベントが見つかりません' });
        }
    } catch (error) {
        sendResponse({ success: false, error: error.message });
    }
}

/**
 * イベントを削除
 */
async function handleDeleteEvent(data, sendResponse) {
    try {
        const result = await chrome.storage.local.get('events');
        let events = result.events || [];
        events = events.filter(e => e.id !== data.id);
        await chrome.storage.local.set({ events });
        sendResponse({ success: true });

        // サイドパネルに通知
        chrome.runtime.sendMessage({
            type: 'EVENT_UPDATED',
            data: events
        }).catch(() => { });
    } catch (error) {
        sendResponse({ success: false, error: error.message });
    }
}
