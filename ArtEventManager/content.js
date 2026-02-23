/**
 * ArtEventManager - Content Script
 * X（旧Twitter）タイムラインのDOM変化を監視し、AIアートイベントを検知する
 */

// ─── パーサーモジュールをインライン化（Content Scriptはモジュール非対応のため） ───

const EventParser = (() => {
    // 強いキーワード（これ1つでイベントとみなす）
    const STRONG_KEYWORDS = [
        'コンテスト', 'contest', '企画', '展示', '募集',
        '選手権', '杯', 'マッチ', 'バトル', 'アンソロジー'
    ];

    // 弱いキーワード（構造的要素との組み合わせが必要）
    const WEAK_KEYWORDS = [
        'AIアート', 'AIイラスト', 'AI art', 'AI illustration',
        'AI生成', '生成AI', 'プロンプト',
        'イベント', 'フェス', 'チャレンジ', 'お題', 'コラボ'
    ];

    // 構造的キーワード（イベントらしさを補強）
    const STRUCTURE_KEYWORDS = [
        '開催期間', '参加方法', 'テーマ：', 'テーマ:', 'テーマ ',
        'ルール', '注意事項', '応募方法', '参加条件',
        'イベントタグ', '指定タグ', '期間：', '期間:',
        '〆切', '締切', '締め切り', 'deadline'
    ];

    // 除外キーワード（誤検知防止）
    const EXCLUDE_KEYWORDS = [
        'ニュース', '記事', 'まとめ', '速報', 'ブログ', '動画紹介',
        // '質問', 'アンケート', // アンケート機能を使ったイベントもあるので一旦除外しない
        '定期', '宣伝', 'commission', 'skeb', '納品', '作業報告',
        'ご無沙汰', 'おはよう', 'こんにちは', 'こんばんは', 'おやすみ' // 挨拶系を除外
    ];

    // 期限抽出用の正規表現パターン
    const DEADLINE_PATTERNS = [
        { regex: /(\d{4})年(\d{1,2})月(\d{1,2})日/, yearGroup: 1, monthGroup: 2, dayGroup: 3 },
        { regex: /(\d{4})\/(\d{1,2})\/(\d{1,2})/, yearGroup: 1, monthGroup: 2, dayGroup: 3 },
        { regex: /(?:〆|締切|締め切り|デッドライン|deadline)[:\s：]*(\d{1,2})[\/月](\d{1,2})日?/i, monthGroup: 1, dayGroup: 2 },
        // [~～\-] の後ろに日付が来るパターン。末尾条件にカッコ（曜日）を追加 + 波線バリエーション
        { regex: /[~～\-\u301C\uFF5E](\d{1,2})[\/月](\d{1,2})(?:[日\s\n）)（(]|$)/, monthGroup: 1, dayGroup: 2 },
        // 開催期間 + 終了日 (区切り文字を任意または無しに緩和)
        { regex: /(?:開催期間|期間)[:\s：]*.*?[~～\-\u301C\uFF5E](\d{1,2})[\/月](\d{1,2})(?:[日\s\n）)（(]|$)/i, monthGroup: 1, dayGroup: 2 },
        // 期間の開始日や単独日程 (区切り文字を任意または無しに緩和)
        // 改行で区切り文字が消失するケース（開催期間2/15...）に対応するため [:\s：]* とする
        { regex: /(?:開催期間|期間)[:\s：]*.*?(\d{1,2})[\/月](\d{1,2})(?:[日\s\n）)（(]|$)/i, monthGroup: 1, dayGroup: 2 },
        { regex: /(\d{1,2})月(\d{1,2})日/, monthGroup: 1, dayGroup: 2 },
        // 追加パターン: カッコ内の日付 (2/15)
        { regex: /[（(](\d{1,2})[\/月](\d{1,2})[)）]/, monthGroup: 1, dayGroup: 2 },
        // 追加パターン: ～まで (2/15まで)
        { regex: /(\d{1,2})[\/月](\d{1,2})(?:日)?(?:まで| まで)/, monthGroup: 1, dayGroup: 2 }
    ];

    // ルール関連キーワード
    const RULE_KEYWORDS = ['枚', '加筆', 'モデル', 'NG', '禁止', 'ルール', '条件', '参加', '応募', 'サイズ', 'タグ', '引用', 'ID', 'リポスト', 'RP'];

    /**
     * テキストがイベントかどうか判定
     */
    /**
     * テキストがイベントかどうか判定
     */
    function containsEventKeywords(text) {
        const lowerText = text.toLowerCase();

        // 1. 除外キーワードチェック
        const excludeMatch = EXCLUDE_KEYWORDS.find(k => lowerText.includes(k.toLowerCase()));
        if (excludeMatch) {
            // console.debug('[ArtEventManager] 除外キーワード検知:', excludeMatch, text.substring(0, 20));
            return false;
        }

        // 2. 強いキーワードがあればOK
        const strongMatch = STRONG_KEYWORDS.find(k => lowerText.includes(k.toLowerCase()));
        if (strongMatch) {
            return true;
        }

        // 3. 弱いキーワード + 構造的キーワード の組み合わせ
        const weakMatch = WEAK_KEYWORDS.find(k => lowerText.includes(k.toLowerCase()));
        const structureMatch = STRUCTURE_KEYWORDS.find(k => lowerText.includes(k.toLowerCase()));

        if (weakMatch && structureMatch) {
            return true;
        }

        // 4. ハッシュタグで判断（#〇〇イベント、#〇〇企画）
        const eventTagMatch = text.match(/#(?!AI)[^\s#]+(?:イベント|企画|コンテスト|杯|祭|フェス)/i);
        if (eventTagMatch) {
            return true;
        }

        // デバッグ用：なぜ検知されなかったか
        /*
        if (weakMatch) {
             console.debug('[ArtEventManager] 弱いキーワードのみ:', weakMatch, '構造不足:', text.substring(0, 20));
        } else if (structureMatch) {
             console.debug('[ArtEventManager] 構造のみ:', structureMatch, 'キーワード不足:', text.substring(0, 20));
        }
        */

        return false;
    }

    /**
     * イベント名を抽出
     */
    function extractEventName(text) {
        const lines = text.split('\n').map(l => l.trim()).filter(l => l);

        // 1. 1行目に「イベント」「開催」「企画」などのキーワードが含まれていれば、それをタイトルとする
        const firstLine = lines[0] || '';
        // 'イベント'もタイトル判定に含める（1行目ならタイトルである可能性が高い）
        const titleKeywords = STRONG_KEYWORDS.concat(['開催', 'イベント']);
        const hasTitleKeyword = titleKeywords.some(k => firstLine.includes(k));

        if (hasTitleKeyword && firstLine.length < 50) {
            return firstLine;
        }

        // 2. ハッシュタグがあればそれをイベント名にする（ユーザー要望により優先度上げ）
        // 括弧内のルール説明（「タグは～まで」等）をタイトルと誤認するのを防ぐため
        const hashtags = extractHashtags(text);
        if (hashtags && hashtags.length > 0) {
            return hashtags[0];
        }

        // 3. 【】『』「」で囲まれた文字列を抽出
        // ただし、「タグ」「まで」「推奨」などのキーワードが含まれる場合はルール説明とみなして除外
        const bracketMatch = text.match(/[【『「](.+?)[】』」]/);
        if (bracketMatch) {
            const innerText = bracketMatch[1];
            const ignoreKeywords = ['タグ', '推奨', 'まで', '必須', 'NG', '禁止', 'ルール', '注意事項', 'お守り'];
            const isIgnored = ignoreKeywords.some(k => innerText.includes(k));

            if (!isIgnored && innerText.length > 2 && innerText.length < 40) {
                return innerText;
            }
        }

        // 4. 行頭にあるイベント系キーワードを含む他の行を探す
        const eventLine = lines.find(line =>
            STRONG_KEYWORDS.concat(WEAK_KEYWORDS).some(k => line.includes(k)) &&
            line.length < 50
        );
        if (eventLine) return eventLine;

        // 5. フォールバック：1行目
        return firstLine.length > 50 ? firstLine.substring(0, 50) + '...' : firstLine;
    }

    /**
     * 期限（Deadline）を抽出
     */
    function extractDeadline(text) {
        const currentYear = new Date().getFullYear();

        for (const pattern of DEADLINE_PATTERNS) {
            // 正規表現のlastIndexをリセット（gフラグがついている場合）
            pattern.regex.lastIndex = 0;
            const match = pattern.regex.exec(text);

            if (match) {
                let year = currentYear;
                let month, day;

                if (pattern.yearGroup) {
                    year = parseInt(match[pattern.yearGroup]);
                    month = parseInt(match[pattern.monthGroup]);
                    day = parseInt(match[pattern.dayGroup]);
                } else {
                    month = parseInt(match[pattern.monthGroup]);
                    day = parseInt(match[pattern.dayGroup]);

                    // 過去の日付なら来年に設定（例: 12月に "1/15締切" とあったら来年）
                    // 時間指定がない場合は、その日の終わり（23:59:59）を期限とする
                    const tentativeDate = new Date(year, month - 1, day, 23, 59, 59);
                    const now = new Date();
                    // 半年以上過去なら来年とみなす（イベント告知の寿命を考慮）
                    if (tentativeDate < now && (now - tentativeDate) > 180 * 24 * 60 * 60 * 1000) {
                        year += 1;
                    }
                }

                // 基本的な妥当性チェック
                if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
                    return new Date(year, month - 1, day, 23, 59, 59).toISOString();
                }
            }
        }

        return null;
    }

    /**
     * ハッシュタグを抽出
     */
    function extractHashtags(text) {
        // 記号（」や。）を除外するようにRegex修正
        // [^\s#＃]+ だと記号も含まれてしまうため、記号を除外する
        // Xのハッシュタグ仕様: 英数字、アンダースコア、日本語（漢字・ひらがな・カタカナ・ー）等。記号は使えない。
        const hashtagRegex = /[#＃]([a-zA-Z0-9_\u3040-\u309F\u30A0-\u30FF\u3005-\u3007\u4E00-\u9FCF\uFF10-\uFF19]+)/g;
        const hashtags = [];
        let match;
        while ((match = hashtagRegex.exec(text)) !== null) {
            hashtags.push('#' + match[1]);
        }
        return [...new Set(hashtags)]; // 重複除去
    }

    /**
     * 参加ルール（イベント詳細）を抽出
     * ユーザー要望により、ポスト全文をそのまま返す（文脈保持のため）
     */
    function extractRules(text) {
        // 空行を除外して配列化
        return text.split(/\n|\r/).map(line => line.trim()).filter(line => line.length > 0);
    }

    /**
     * 画像URLを抽出
     */
    function extractImages(articleElement) {
        if (!articleElement) return [];
        const images = [];
        // 静止画
        const imgElements = articleElement.querySelectorAll('div[data-testid="tweetPhoto"] img');
        imgElements.forEach(img => {
            if (img.src) images.push(img.src);
        });

        // 動画（ポスター画像）も一応取っておく？要望は「添付画像」なので静止画優先だが、動画サムネも有用
        // const videoElements = articleElement.querySelectorAll('div[data-testid="videoPlayer"] video');
        // videoElements.forEach(video => {
        //     if (video.poster) images.push(video.poster);
        // });

        return images;
    }

    /**
     * ポストテキストを解析してイベントデータを返す
     */
    function parse(text, postUrl, articleElement = null) {
        if (!containsEventKeywords(text)) {
            return null;
        }

        const eventName = extractEventName(text);
        const deadline = extractDeadline(text);
        const hashtags = extractHashtags(text);
        const rules = extractRules(text);
        // postUrlだけ渡されるケース（自動検知）では画像取得にDom要素が必要。
        // 自動検知(MutationObserver)は廃止されたが、もし使うならここを拡張する
        const images = articleElement ? extractImages(articleElement) : [];

        return {
            postUrl,
            eventName: eventName || 'イベント（タイトル不明）',
            deadline,
            hashtags,
            rules,
            images,
            rawText: text
        };
    }

    return {
        parse,
        containsEventKeywords,
        extractEventName,
        extractDeadline,
        extractHashtags,
        extractRules,
        extractImages
    };
})();


// ─── DOM監視ロジック ───

/**
 * 処理済みのポストを追跡するSet
 */
const processedPosts = new Set();

/**
 * ポスト要素からテキストとURLを抽出
 * リポスト・リプライ（コメント）は除外する
 */
function extractPostData(articleElement) {
    // リポスト判定：socialContextがあればスキップ
    const socialContext = articleElement.querySelector('[data-testid="socialContext"]');
    if (socialContext) {
        return null;
    }

    // ─── リプライ（コメント）判定 ───

    // 方法1: 「返信先: @xxx」テキストの有無（X.comのリプライ表示）
    const replyContext = articleElement.querySelector('div[id^="id__"] > a[href^="/"]');
    const articleText = articleElement.textContent || '';
    if (articleText.includes('返信先:') || articleText.includes('Replying to')) {
        console.log('[ArtEventManager] リプライをスキップ（返信先テキスト検知）');
        return null;
    }

    // 方法2: リプライ接続線（上方向に伸びる線）が存在するか
    // リプライツイートには親ツイートとの接続線が表示される
    const replyLine = articleElement.querySelector('[data-testid="Tweet-User-Avatar"]')
        ?.parentElement?.parentElement
        ?.querySelector('div[style*="border-left"]');
    // セル間の接続線（::before で描画される縦線）を探す
    const cellInner = articleElement.closest('[data-testid="cellInnerDiv"]');
    if (cellInner) {
        const prevSibling = cellInner.previousElementSibling;
        // 直前に接続線のある空のcellInnerDivがあればリプライ
        if (prevSibling && prevSibling.querySelector('[data-testid="cellInnerDiv"]') === null) {
            const connector = prevSibling.querySelector('div[style*="width: 2px"], div[style*="border"]');
            if (connector) {
                console.log('[ArtEventManager] リプライをスキップ（接続線検知）');
                return null;
            }
        }
    }

    // 方法3: 個別ツイートページでのリプライ判定
    // URLが /status/ のページにいる場合、最初のツイート以外はリプライ
    const currentUrl = window.location.href;
    if (currentUrl.match(/\/status\/\d+/)) {
        // 個別ツイートページの場合、メインツイートは特別な構造を持つ
        // data-testid="tweet" の中でfocal tweet（主ツイート）以外をスキップ
        const allTweets = document.querySelectorAll('article[data-testid="tweet"]');
        const tweetIndex = Array.from(allTweets).indexOf(articleElement);

        // 主ツイートの判定: ツイートの詳細表示（大きなフォント・日時表示）を含むか
        const hasTweetDetail = articleElement.querySelector('a[href*="/analytics"]') ||
            articleElement.querySelector('[data-testid="app-text-transition-container"]');

        if (!hasTweetDetail && tweetIndex > 0) {
            console.log('[ArtEventManager] リプライをスキップ（個別ページのコメント）');
            return null;
        }
    }

    // ポストのテキストを取得
    const tweetTextElement = articleElement.querySelector('[data-testid="tweetText"]');
    if (!tweetTextElement) {
        return null;
    }

    const text = tweetTextElement.textContent || '';

    // ポストURLを取得
    let postUrl = '';
    const timeLink = articleElement.querySelector('time')?.closest('a');
    if (timeLink) {
        postUrl = timeLink.href;
    } else {
        // timeタグがない場合（プロモーションや一部の特殊なツイート）
        // 記事内の /status/ を含むリンクを探す
        const statusLink = articleElement.querySelector('a[href*="/status/"]');
        if (statusLink) {
            postUrl = statusLink.href;
        }
    }

    // URLが取得できなければスキップ
    if (!postUrl) return null;

    return { text, postUrl };
}

// ─── メッセージリスナー ───
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'EXTRACT_EVENT') {
        (async () => {
            const eventData = await extractEventWithRetry();
            sendResponse({ success: !!eventData, data: eventData });
        })();
        return true; // 非同期レスポンスのためにtrueを返す
    }
    return true;
});

/**
 * イベント抽出（リトライ機能付き）
 */
async function extractEventWithRetry(maxRetries = 10, interval = 500) {
    for (let i = 0; i < maxRetries; i++) {
        const data = extractEventFromCurrentPage();
        if (data && data.eventName !== 'イベント（タイトル不明）') {
            // タイトルが取れているなら確定
            return data;
        }
        if (data) {
            // タイトル不明でも一応データは取れているが、もう少し待ってみる（詳細がロードされるかも）
            // 最後の試行ならこれを返す
            if (i === maxRetries - 1) return data;
        }

        // 要素が見つからない、または不完全な場合は待機
        await new Promise(resolve => setTimeout(resolve, interval));
    }
    return null;
}

/**
 * 現在のページからイベント情報を抽出
 */
function extractEventFromCurrentPage() {
    // 記事要素を取得
    // data-testid="tweet" はタイムラインでも詳細ページでも使われる
    // 詳細ページの場合、会話スレッドの中でメインのツイートを特定する必要があるが
    // URL収集時は「開いているページのメインツイート」を対象としたい。

    // 詳細ページでは tabindex="-1" がついているツイートがメインの場合が多いが、構造が変わることもある。
    // URL収集なので、window.location.href と一致するステータスリンクを持つツイートを探すのが確実？
    // しかし、statusページではstatus IDがURLに含まれる。

    const currentUrl = window.location.href;
    const match = currentUrl.match(/\/status\/(\d+)/);
    let targetArticle = null;

    if (match) {
        const statusId = match[1];
        // ページ内の全ツイートから、このIDへのリンクを含むものを探す、または
        // 詳細ページの場合、メインツイートは特別なクラスや構造を持つことが多い。
        // 現在のXの仕様では、メインツイートは `article` タグで、その中のリンクに statusId が含まれる。

        const articles = document.querySelectorAll('article[data-testid="tweet"]');
        for (const article of articles) {
            // timeタグの親リンク、またはanalyticsリンクなどをチェック
            const links = article.querySelectorAll('a[href*="/status/"]');
            for (const link of links) {
                if (link.href.includes(statusId) && !link.href.includes('/retweets') && !link.href.includes('/likes')) {
                    targetArticle = article;
                    break;
                }
            }
            if (targetArticle) break;
        }
    }

    // 見つからない場合は最初のツイート（フォールバック）
    if (!targetArticle) {
        targetArticle = document.querySelector('article[data-testid="tweet"]');
    }

    if (!targetArticle) return null;

    const text = targetArticle.querySelector('[data-testid="tweetText"]')?.textContent || '';
    const postUrl = window.location.href; // URLはユーザー入力を正とする（リダイレクト等考慮）

    // パース実行
    const eventName = EventParser.extractEventName(text);
    // extractEventNameがnullを返す場合もあるので抽出
    const deadline = EventParser.extractDeadline(text);
    const hashtags = EventParser.extractHashtags(text);
    const rules = EventParser.extractRules(text);

    // イベント名判定不能でも、手動収集なら「イベント」として扱ってほしい場合が多いので
    // 何かしらテキストがあればOKとする

    // 画像URLを抽出
    const images = EventParser.extractImages(targetArticle);

    return {
        postUrl,
        eventName: eventName || '手動収集イベント',
        deadline,
        hashtags,
        rules,
        images, // 画像追加
        rawText: text
    };
}

// EventParser の公開用修正
// 即時関数を修正して、内部関数を公開するように変更する必要があるが、
// 既存のコードは const EventParser = (() => { ... return { parse, containsEventKeywords }; })();
// となっている。extract関数群も公開するように修正が必要。
// そのため、上の EventParser 定義側も修正する必要がある。
// まずはここでリスナー定義のみ行い、後続のステップでEventParserを修正する。
