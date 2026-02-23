/**
 * ArtEventManager - Parser Module
 * 正規表現によるイベントデータ解析
 * ※ このファイルはサイドパネル側でも使用するためのスタンドアロン版
 *    Content Script側にはインライン化されています
 */

const ParserModule = (() => {
    // キーワードリスト（大幅拡充）
    const EVENT_KEYWORDS = [
        // コアキーワード
        'AIアート', 'AIイラスト', 'AI art', 'AI illustration',
        'AI生成', '生成AI', 'プロンプト',

        // イベントタイプ
        'コンテスト', 'contest', '企画', '展示', '募集',
        'イベント', 'フェス', 'チャレンジ', 'お題', 'コラボ',
        '選手権', '杯', 'マッチ', 'バトル',

        // 構造的キーワード（これらがあればイベントの可能性が高い）
        '開催期間', '参加方法', 'テーマ：', 'テーマ:',
        'ルール', '注意事項', '応募方法', '参加条件',
        'イベントタグ', '指定タグ'
    ];

    // 除外キーワード（誤検知防止）
    const EXCLUDE_KEYWORDS = [
        'ニュース', '記事', 'まとめ', '速報', 'ブログ', '動画紹介',
        '質問', 'アンケート', '定期', '宣伝', 'commission', 'skeb'
    ];

    // 期限抽出用の正規表現パターン（強化版）
    const DEADLINE_PATTERNS = [
        // 2024年1月15日, 2024年01月15日
        { regex: /(\d{4})年(\d{1,2})月(\d{1,2})日/, yearGroup: 1, monthGroup: 2, dayGroup: 3 },
        // 2024/1/15, 2024/01/15
        { regex: /(\d{4})\/(\d{1,2})\/(\d{1,2})/, yearGroup: 1, monthGroup: 2, dayGroup: 3 },
        // 〆: 1/15, 〆：1月15日, 締切: ...
        { regex: /(?:〆|締切|締め切り|デッドライン|deadline)[:\s：]*(\d{1,2})[\/月](\d{1,2})日?/i, monthGroup: 1, dayGroup: 2 },
        // ～1/15, ~1/15, -1/15 (範囲の終わり)
        { regex: /[~～\-](\d{1,2})[\/月](\d{1,2})(?:日|\s|\n|$)/, monthGroup: 1, dayGroup: 2 },
        // 開催期間: ... ～ 2/16
        { regex: /(?:開催期間|期間)[:\s：].*?[~～\-](\d{1,2})[\/月](\d{1,2})(?:日|\s|\n|$)/i, monthGroup: 1, dayGroup: 2 },
        // 期間: 2月14日 ... まで (範囲記号なし)
        { regex: /(?:開催期間|期間)[:\s：].*?(\d{1,2})[\/月](\d{1,2})(?:日|\s|\n|$)/i, monthGroup: 1, dayGroup: 2 },
        // 1月15日, 01月15日 (最後にマッチさせる)
        { regex: /(\d{1,2})月(\d{1,2})日/, monthGroup: 1, dayGroup: 2 }
    ];

    // ルール関連キーワード
    const RULE_KEYWORDS = ['枚', '加筆', 'モデル', 'NG', '禁止', 'ルール', '条件', '参加', '応募', 'サイズ', 'タグ', '引用', 'ID', 'リポスト', 'RP'];

    /**
     * テキストにイベント関連キーワードが含まれるか判定
     */
    function containsEventKeywords(text) {
        // 除外キーワードが含まれていたらスキップ
        if (EXCLUDE_KEYWORDS.some(k => text.toLowerCase().includes(k.toLowerCase()))) {
            return false;
        }

        // イベントキーワードが含まれているか
        return EVENT_KEYWORDS.some(keyword =>
            text.toLowerCase().includes(keyword.toLowerCase())
        );
    }

    function extractEventName(text) {
        const bracketMatch = text.match(/【(.+?)】/);
        if (bracketMatch) return bracketMatch[1].trim();
        const quoteMatch = text.match(/「(.+?)」/);
        if (quoteMatch) return quoteMatch[1].trim();
        const firstLine = text.split(/[\n\r]/)[0].trim();
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
                    const tentativeDate = new Date(year, month - 1, day);
                    const now = new Date();
                    // 半年以上過去なら来年とみなす（イベント告知の寿命を考慮）
                    if (tentativeDate < now && (now - tentativeDate) > 180 * 24 * 60 * 60 * 1000) {
                        year += 1;
                    }
                }

                // 基本的な妥当性チェック
                if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
                    return new Date(year, month - 1, day).toISOString();
                }
            }
        }

        return null;
    }

    function extractHashtags(text) {
        const hashtagRegex = /[#＃]([^\s#＃]+)/g;
        const hashtags = [];
        let match;
        while ((match = hashtagRegex.exec(text)) !== null) {
            hashtags.push('#' + match[1]);
        }
        return [...new Set(hashtags)];
    }

    function extractRules(text) {
        const sentences = text.split(/[。\n\r]/);
        return sentences
            .map(s => s.trim())
            .filter(s => s.length > 3 && RULE_KEYWORDS.some(k => s.includes(k)));
    }

    function parse(text, postUrl) {
        if (!containsEventKeywords(text)) return null;
        return {
            postUrl,
            eventName: extractEventName(text),
            deadline: extractDeadline(text),
            hashtags: extractHashtags(text),
            rules: extractRules(text),
            rawText: text
        };
    }

    return { parse, containsEventKeywords, extractEventName, extractDeadline, extractHashtags, extractRules };
})();
