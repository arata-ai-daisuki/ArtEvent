/**
 * ArtEventManager - Storage Module
 * Chrome Storage を使ったイベントデータのCRUD操作
 */

const StorageModule = (() => {

    /**
     * 全イベントを取得
     */
    async function getAllEvents() {
        const result = await chrome.storage.local.get('events');
        return result.events || [];
    }

    /**
     * イベントを保存（重複チェック付き）
     */
    async function saveEvent(eventData) {
        const events = await getAllEvents();

        // 重複チェック
        if (events.some(e => e.postUrl === eventData.postUrl)) {
            return { success: false, reason: 'duplicate' };
        }

        const newEvent = {
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            ...eventData,
            isDone: false,
            memo: ''
        };

        events.push(newEvent);
        await chrome.storage.local.set({ events });
        return { success: true, event: newEvent };
    }

    /**
     * イベントのステータスを更新
     */
    async function updateStatus(id, isDone) {
        const events = await getAllEvents();
        const index = events.findIndex(e => e.id === id);
        if (index === -1) return false;
        events[index].isDone = isDone;
        await chrome.storage.local.set({ events });
        return true;
    }

    /**
     * イベントのメモを更新
     */
    async function updateMemo(id, memo) {
        const events = await getAllEvents();
        const index = events.findIndex(e => e.id === id);
        if (index === -1) return false;
        events[index].memo = memo;
        await chrome.storage.local.set({ events });
        return true;
    }

    /**
     * イベントを削除
     */
    async function deleteEvent(id) {
        let events = await getAllEvents();
        events = events.filter(e => e.id !== id);
        await chrome.storage.local.set({ events });
        return true;
    }

    /**
     * 全イベントをクリア
     */
    async function clearAll() {
        await chrome.storage.local.set({ events: [] });
        return true;
    }

    return { getAllEvents, saveEvent, updateStatus, updateMemo, deleteEvent, clearAll };
})();
