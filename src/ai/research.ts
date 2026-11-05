// Wikipedia (日本語版) の公開APIを使って、ブラウザから直接リアルなWeb調査を行うモジュール
// origin=* パラメータによりCORS制限なしでブラウザから直接通信可能

export interface WikiResearchResult {
    title: string;
    extract: string;
    url: string;
    relatedKeywords: string[];
    sourceType: 'keyword_search' | 'random_discovery';
}

export class ResearchManager {
    private static WIKI_API_BASE = 'https://ja.wikipedia.org/w/api.php';

    /**
     * 指定したキーワードに関連する記事をWikipediaで検索し、その本文要約と関連リンクを取得する
     */
    public async searchAndFetch(keyword: string): Promise<WikiResearchResult | null> {
        try {
            // 1. キーワードで検索して関連ページ一覧を取得
            const searchParams = new URLSearchParams({
                action: 'query',
                list: 'search',
                srsearch: keyword,
                srlimit: '5',
                format: 'json',
                origin: '*'
            });

            const searchRes = await fetch(`${ResearchManager.WIKI_API_BASE}?${searchParams.toString()}`);
            if (!searchRes.ok) return null;
            const searchData = await searchRes.json();
            const searchResults = searchData?.query?.search;

            if (!Array.isArray(searchResults) || searchResults.length === 0) {
                return null;
            }

            // 毎回同じ記事にならないよう、上位3件からランダムに1つ選ぶ（1件しかなければそれ）
            const topCandidates = searchResults.slice(0, Math.min(3, searchResults.length));
            const chosen = topCandidates[Math.floor(Math.random() * topCandidates.length)];
            const title: string = chosen.title;

            // 2. 選んだページの本文抜粋 (extracts) とページ内リンクを取得
            const detail = await this.fetchArticleDetail(title);
            if (!detail) return null;

            return {
                ...detail,
                sourceType: 'keyword_search'
            };
        } catch (e) {
            console.warn('Wikipedia search failed:', e);
            return null;
        }
    }

    /**
     * ランダムな興味深い記事をWikipediaから1件取得する（シードがない場合や新しい発見用）
     */
    public async fetchRandomDiscovery(): Promise<WikiResearchResult | null> {
        try {
            // ランダムな記事を3件取得し、一番内容が充実しているものを選ぶ
            const randomParams = new URLSearchParams({
                action: 'query',
                list: 'random',
                rnnamespace: '0', // 標準名前空間（記事のみ）
                rnlimit: '3',
                format: 'json',
                origin: '*'
            });

            const randomRes = await fetch(`${ResearchManager.WIKI_API_BASE}?${randomParams.toString()}`);
            if (!randomRes.ok) return null;
            const randomData = await randomRes.json();
            const randomList = randomData?.query?.random;

            if (!Array.isArray(randomList) || randomList.length === 0) {
                return null;
            }

            for (const item of randomList) {
                const detail = await this.fetchArticleDetail(item.title);
                // 短すぎるスタブ記事は避ける
                if (detail && detail.extract.length >= 150) {
                    return {
                        ...detail,
                        sourceType: 'random_discovery'
                    };
                }
            }

            // どれも短ければ最初の1件を返す
            const fallback = await this.fetchArticleDetail(randomList[0].title);
            if (!fallback) return null;
            return {
                ...fallback,
                sourceType: 'random_discovery'
            };
        } catch (e) {
            console.warn('Wikipedia random discovery failed:', e);
            return null;
        }
    }

    /**
     * 記事タイトルから本文要約 (最大1200文字) と関連リンクを取得する内部ヘルパー
     */
    private async fetchArticleDetail(title: string): Promise<Omit<WikiResearchResult, 'sourceType'> | null> {
        const detailParams = new URLSearchParams({
            action: 'query',
            prop: 'extracts|links',
            titles: title,
            explaintext: '1',       // プレーンテキストで取得
            exchars: '1200',        // 最初の1200文字（十分な情報量＆トークン節約）
            plnamespace: '0',
            pllimit: '10',
            format: 'json',
            origin: '*'
        });

        const res = await fetch(`${ResearchManager.WIKI_API_BASE}?${detailParams.toString()}`);
        if (!res.ok) return null;
        const data = await res.json();
        const pages = data?.query?.pages;
        if (!pages) return null;

        const pageId = Object.keys(pages)[0];
        if (!pageId || pageId === '-1') return null;

        const page = pages[pageId];
        const extract: string = (page.extract || '').trim();
        if (!extract) return null;

        const links: string[] = Array.isArray(page.links)
            ? page.links.map((l: { title: string }) => l.title).slice(0, 8)
            : [];

        return {
            title: page.title || title,
            extract,
            url: `https://ja.wikipedia.org/wiki/${encodeURIComponent(page.title || title)}`,
            relatedKeywords: links
        };
    }
}

export const researchManager = new ResearchManager();
