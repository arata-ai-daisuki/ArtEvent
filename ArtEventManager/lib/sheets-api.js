/**
 * ArtEventManager - Google Sheets API Module
 * OAuth2認証とスプレッドシートへの読み書き
 */

const SheetsAPI = (() => {
    const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

    // ─── 設定 ───
    let spreadsheetId = null;

    /**
     * スプレッドシートIDを取得（ストレージから）
     */
    async function getSpreadsheetId() {
        if (spreadsheetId) return spreadsheetId;
        const result = await chrome.storage.local.get('spreadsheetId');
        spreadsheetId = result.spreadsheetId || null;
        return spreadsheetId;
    }

    /**
     * スプレッドシートIDを設定
     */
    async function setSpreadsheetId(id) {
        spreadsheetId = id;
        await chrome.storage.local.set({ spreadsheetId: id });
    }

    /**
     * OAuth2トークンを取得
     */
    async function getAuthToken() {
        return new Promise((resolve, reject) => {
            chrome.identity.getAuthToken({ interactive: true }, (token) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    resolve(token);
                }
            });
        });
    }

    /**
     * APIリクエストを送信
     */
    async function apiRequest(method, path, body = null) {
        const token = await getAuthToken();
        const sheetId = await getSpreadsheetId();

        if (!sheetId) {
            throw new Error('スプレッドシートIDが設定されていません');
        }

        const options = {
            method,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        };

        if (body) {
            options.body = JSON.stringify(body);
        }

        const response = await fetch(`${SHEETS_API_BASE}/${sheetId}${path}`, options);

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error?.message || `API Error: ${response.status}`);
        }

        return response.json();
    }

    /**
     * スプレッドシートにヘッダー行を作成（初回セットアップ）
     */
    async function initializeSheet() {
        const headers = [
            ['取得日時', 'ポストURL', 'イベント名', '期限', '指定タグ', 'ルール要約', '進捗', 'メモ']
        ];

        await apiRequest('PUT', '/values/Sheet1!A1:H1?valueInputOption=RAW', {
            range: 'Sheet1!A1:H1',
            majorDimension: 'ROWS',
            values: headers
        });

        console.log('[ArtEventManager] スプレッドシート初期化完了');
    }

    /**
     * イベントをスプレッドシートに追記
     */
    async function appendEvent(event) {
        const row = [
            event.timestamp || new Date().toISOString(),
            event.postUrl || '',
            event.eventName || '',
            event.deadline || '',
            (event.hashtags || []).join(', '),
            (event.rules || []).join(' / '),
            event.isDone ? '済' : '未',
            event.memo || ''
        ];

        await apiRequest('POST', '/values/Sheet1!A:H:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS', {
            range: 'Sheet1!A:H',
            majorDimension: 'ROWS',
            values: [row]
        });

        console.log('[ArtEventManager] シートに追記:', event.eventName);
    }

    /**
     * スプレッドシートから全データ取得
     */
    async function getAllData() {
        const data = await apiRequest('GET', '/values/Sheet1!A:H');
        const rows = data.values || [];

        if (rows.length <= 1) return []; // ヘッダーのみ

        return rows.slice(1).map(row => ({
            timestamp: row[0] || '',
            postUrl: row[1] || '',
            eventName: row[2] || '',
            deadline: row[3] || '',
            hashtags: (row[4] || '').split(', ').filter(Boolean),
            rules: (row[5] || '').split(' / ').filter(Boolean),
            isDone: row[6] === '済',
            memo: row[7] || ''
        }));
    }

    /**
     * 特定のイベントの進捗を更新
     */
    async function updateEventProgress(postUrl, isDone) {
        const data = await apiRequest('GET', '/values/Sheet1!A:H');
        const rows = data.values || [];

        // 該当行を探す（B列 = ポストURL）
        for (let i = 1; i < rows.length; i++) {
            if (rows[i][1] === postUrl) {
                const rowNum = i + 1;
                await apiRequest('PUT', `/values/Sheet1!G${rowNum}?valueInputOption=RAW`, {
                    range: `Sheet1!G${rowNum}`,
                    values: [[isDone ? '済' : '未']]
                });
                console.log('[ArtEventManager] 進捗更新:', postUrl);
                return true;
            }
        }

        return false;
    }

    /**
     * 重複チェック（ポストURLが既存か確認）
     */
    async function isDuplicate(postUrl) {
        try {
            const data = await apiRequest('GET', '/values/Sheet1!B:B');
            const urls = (data.values || []).flat();
            return urls.includes(postUrl);
        } catch {
            return false;
        }
    }

    /**
     * 全イベントを一括同期（ローカルストレージ → シート）
     */
    async function syncAllEvents(events) {
        // ヘッダー + 全データで上書き
        const header = ['取得日時', 'ポストURL', 'イベント名', '期限', '指定タグ', 'ルール要約', '進捗', 'メモ'];
        const rows = events.map(event => [
            event.timestamp || '',
            event.postUrl || '',
            event.eventName || '',
            event.deadline || '',
            (event.hashtags || []).join(', '),
            (event.rules || []).join(' / '),
            event.isDone ? '済' : '未',
            event.memo || ''
        ]);

        await apiRequest('PUT', '/values/Sheet1!A:H?valueInputOption=RAW', {
            range: 'Sheet1!A:H',
            majorDimension: 'ROWS',
            values: [header, ...rows]
        });

        console.log('[ArtEventManager] 全データ同期完了:', events.length, '件');
    }

    return {
        getSpreadsheetId,
        setSpreadsheetId,
        getAuthToken,
        initializeSheet,
        appendEvent,
        getAllData,
        updateEventProgress,
        isDuplicate,
        syncAllEvents
    };
})();
