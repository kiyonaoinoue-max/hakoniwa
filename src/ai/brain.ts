import { MemoryManager, getJSTDateString, getJSTTimeParts } from './memory';
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import { weatherManager } from './weather';
import { researchManager } from './research';
import type { SelfCorrectionAction } from './types';


export class Brain {
    private memory: MemoryManager;
    private models: GenerativeModel[] = [];
    private activeModelIndex: number = 0;
    private conversationCount: number = 0;
    private static API_LIMIT = 250;
    private static API_STORAGE_KEY = 'hakoniwa_api_usage';

    constructor(memory: MemoryManager) {
        this.memory = memory;
        const apiKeys = [
            import.meta.env.VITE_GEMINI_API_KEY,
            import.meta.env.VITE_GEMINI_API_KEY_2,
        ].filter(key => key && key !== 'YOUR_GEMINI_API_KEY_HERE');

        if (apiKeys.length > 0) {
            this.models = apiKeys.map(key => {
                const genAI = new GoogleGenerativeAI(key);
                return genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
            });
            console.log(`Hakoniwa Brain initialized with ${this.models.length} API key(s)`);
        } else {
            console.warn("Gemini API Key is missing or invalid.");
        }
    }

    private get model(): GenerativeModel | null {
        return this.models[this.activeModelIndex] || null;
    }

    private switchModel(): boolean {
        if (this.models.length <= 1) return false;
        const prev = this.activeModelIndex;
        this.activeModelIndex = (this.activeModelIndex + 1) % this.models.length;
        console.log(`🔄 API Key switched: ${prev + 1} → ${this.activeModelIndex + 1}`);
        return true;
    }

    // --- API Usage Tracker ---
    private getPacificDate(): string {
        // Get current date in Pacific Time for daily reset
        return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
    }

    private getApiCount(): number {
        try {
            const data = JSON.parse(localStorage.getItem(Brain.API_STORAGE_KEY) || '{}');
            const today = this.getPacificDate();
            if (data.date !== today) return 0; // New day, reset
            return data.count || 0;
        } catch { return 0; }
    }

    private incrementApiCount(): void {
        const today = this.getPacificDate();
        const count = this.getApiCount() + 1;
        localStorage.setItem(Brain.API_STORAGE_KEY, JSON.stringify({ date: today, count }));
    }

    public getApiUsage(): { used: number; max: number; remaining: number; percent: number } {
        const used = this.getApiCount();
        const max = Brain.API_LIMIT;
        const remaining = Math.max(0, max - used);
        const percent = Math.round((remaining / max) * 100);
        return { used, max, remaining, percent };
    }

    // Retry wrapper for API calls with backoff + auto key switching
    private async callWithRetry(prompt: string, maxRetries: number = 3, useGoogleSearch: boolean = false): Promise<string> {
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                if (useGoogleSearch) {
                    try {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const result = await this.model!.generateContent({
                            contents: [{ role: 'user', parts: [{ text: prompt }] }],
                            tools: [{ googleSearch: {} } as any]
                        });
                        this.incrementApiCount();
                        return result.response.text();
                    } catch (searchErr) {
                        console.warn('Google Search grounding fallback to standard call:', searchErr);
                    }
                }
                const result = await this.model!.generateContent(prompt);
                this.incrementApiCount();
                return result.response.text();
            } catch (error: unknown) {
                const errMsg = error instanceof Error ? error.message : String(error);
                const isRateLimit = errMsg.includes('429') || errMsg.toLowerCase().includes('quota') || errMsg.toLowerCase().includes('rate');
                if (isRateLimit && attempt < maxRetries) {
                    // Try switching to another API key first
                    const switched = this.switchModel();
                    if (switched) {
                        console.warn(`Rate limited, switched API key and retrying immediately (attempt ${attempt + 1}/${maxRetries})...`);
                        await new Promise(r => setTimeout(r, 2000)); // Brief pause after switch
                    } else {
                        const wait = (attempt + 1) * 15000; // 15s, 30s, 45s
                        console.warn(`Rate limited, retrying in ${wait / 1000}s (attempt ${attempt + 1}/${maxRetries})...`);
                        await new Promise(r => setTimeout(r, wait));
                    }
                } else {
                    throw error;
                }
            }
        }
        throw new Error('Max retries exceeded');
    }

    // JSONレスポンスを安全に抽出するヘルパー
    private extractJson(text: string): Record<string, unknown> | null {
        // 1. コードブロック除去
        let cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

        // 2. そのままパースを試行
        try {
            return JSON.parse(cleaned);
        } catch { /* 続行 */ }

        // 3. テキスト中の最初の {...} ブロックを抽出
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try {
                return JSON.parse(jsonMatch[0]);
            } catch { /* 続行 */ }
        }

        return null;
    }

    // パース失敗時にresponseフィールドだけを安全に抽出するフォールバック
    private extractResponseText(text: string): string | null {
        const match = text.match(/"response"\s*:\s*"((?:[^"\\]|\\.)*)"/);
        if (match) {
            return match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
        }
        return null;
    }

    public async processInput(input: string): Promise<string> {
        const now = Date.now();

        // 1. Log activity
        this.memory.logSessionActivity();

        // 2. Store User Input
        this.memory.addEpisode({ speaker: 'user', content: input });

        let response = "";

        if (this.model) {
            try {
                // --- Construct Prompt with Context ---
                const jst = getJSTTimeParts(new Date(now));
                const currentHour = jst.hour;
                // 昼の時間を過ぎていたら（15時以降または11時前）、古い昼食返事待ちフラグを自動クリア
                if ((currentHour >= 15 || currentHour < 11) && this.memory.isAwaitingMealResponse()) {
                    this.memory.clearAwaitingMealResponse();
                }

                const history = this.memory.getRecentEpisodes(20)
                    .map(ep => {
                        const timeStr = new Date(ep.timestamp).toLocaleString('ja-JP', {
                            timeZone: 'Asia/Tokyo',
                            month: 'numeric',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                        });
                        return `[${timeStr}] ${ep.speaker === 'user' ? 'User' : 'AI'}: ${ep.content}`;
                    })
                    .join('\n');

                const activityContext = this.memory.getActivitySummaryForPrompt();
                const conceptsForPrompt = this.memory.getConceptsForPrompt();
                const mealContext = this.memory.getMealSummaryForPrompt();
                const weatherContext = weatherManager.getWeatherForPrompt();
                const weatherRecommendation = weatherManager.getRecommendationContext();
                const personalityContext = this.memory.getPersonalityForPrompt();
                const modeContext = this.memory.getModeContextForPrompt();
                const shouldEvaluatePersonality = (++this.conversationCount % 5 === 0);
                this.memory.incrementModeCount();
                const remindersContext = this.memory.getRemindersForPrompt();
                const triggerStatusContext = this.memory.getTriggerStatusForPrompt();

                // ユーザーが「自由研究」「何か面白いこと調べて」「〇〇を調べて」と今すぐリクエストした場合、事前にWikipedia APIからリアルデータを取得＆Google検索グラウンディングも有効化
                let liveResearchContext = '';
                const isWeekendReservation = /(?:今週末|来週末|週末|土曜|日曜).*?(?:調べて|発表して|自由研究)/.test(input);
                const immediateSearchMatch = !isWeekendReservation && input.match(/(?:「(.+?)」|(.+?))?(?:について|の)?(?:自由研究|調べて|深掘りして|検索して)/);
                const wantsImmediateResearch = Boolean(immediateSearchMatch || (!isWeekendReservation && input.includes('自由研究')));

                if (wantsImmediateResearch) {
                    const rawTopic = (immediateSearchMatch?.[1] || immediateSearchMatch?.[2] || '')
                        .replace(/^(何か|なんか|ちょっと|ハコさん|ねえ|機能\d+のテストとして、?|テストとして、?)/, '')
                        .trim();
                    const seed = rawTopic
                        ? { keyword: rawTopic, context: `ユーザーからのリクエスト「${rawTopic}」` }
                        : this.memory.pickResearchSeed();
                    const wikiData = seed
                        ? (await researchManager.searchAndFetch(seed.keyword))
                        : await researchManager.fetchRandomDiscovery();
                    if (wikiData) {
                        liveResearchContext = `\n--- 🧪 リアルタイムWeb調査結果 (Wikipedia APIより取得) ---\n調査きっかけ: ${seed ? seed.context : 'ランダム発見'}\n記事タイトル: ${wikiData.title}\nURL: ${wikiData.url}\n本文抜粋: ${wikiData.extract}\n関連キーワード: ${wikiData.relatedKeywords.join(', ')}\n`;
                    } else if (seed) {
                        liveResearchContext = `\n--- 🧪 リアルタイムWeb調査リクエスト ---\n調査テーマ: 「${seed.keyword}」\n(Wikipediaの百科事典記事には直接該当がない時事・最新テーマのため、あなたのGoogle検索ツールおよび最新知識を使って今この場で詳しく調査レポートを作成してください！)\n`;
                    }
                }

                const prompt = `
You are "Hakoniwa", a personal AI assistant living in a local environment.
Current Time (JST): ${jst.formatted} (現在の日本時間は ${currentHour}時${jst.minute}分 です)
${activityContext ? `User Activity Pattern: ${activityContext}` : ''}
${weatherContext ? `\n${weatherContext}` : ''}
${weatherRecommendation ? `${weatherRecommendation}` : ''}

Your Capabilities (YOU have these features — mention them naturally when relevant!):
- 🔮 占い: 毎朝(デフォルト7:00-9:00)に自動で出すほか、ユーザーから「占って」「運勢は？」と聞かれた時もいつでもパーソナライズ占いを生成して答えます。
- 🍽️ 食事ログ: 毎日お昼（設定時間、通常12:00-13:00）にお昼のメニューを聞いて記録する
- 🍱 メニュー提案: 食事データが5件以上溜まったら、11:30-12:00に過去の傾向からお昼のメニューを提案する
- 📖 概念学習: ユーザーが教えてくれたことを覚えて、会話に活かす
- 📊 活動パターン分析: ユーザーがいつアプリを使うかを分析し、生活パターンを理解する
- 🌤️ 天気連動: 現在の天気情報を把握していて、天気に関する質問（「傘いる？」「天気は？」等）に回答できる
- 🎯 おすすめ: 夕方(デフォルト17:00-19:00)に天気・気分・行動パターンに基づいた活動や食事のおすすめを提案
- ⏰ リマインド: ユーザーが「○○を思い出させて」「○時に教えて」と言ったら、内容と時刻を登録する。繰り返し（毎日/毎週）も可能。
- 🧪 自由研究 (Web検索・Wikipedia調査):
  1. 週末自動発表（デフォルトは土日の指定時間、現在予約中のテーマがあればそれを優先して発表）
  2. ユーザーから「今週末（または日曜の夜など）に〇〇を調べて教えて」と予約されたら、selfCorrection の queueResearchTopic / researchDay / researchHour に保存して予約を受け付ける。
  3. ユーザーから「今すぐ〇〇を調べて」「テストとして〇〇を調べて」「自由研究して」と言われた時は、平日であっても「週末しかできません」などと断らずに、**今この場ですぐに調べて発表する**こと！
- 🛠️ 自己メンテナンス権限: ユーザーから各機能（占い・昼食・夕方おすすめ・自由研究）の時間変更やON/OFF、自由研究テーマの予約、間違って覚えた記憶（Memory）の削除、リマインドの取り消しを指示されたら、自分自身で設定データを書き換えて直せる。
${remindersContext}
${triggerStatusContext}
${liveResearchContext}

${personalityContext ? `YOUR PERSONALITY (follow these traits in your response!):
${personalityContext}` : ''}

${modeContext}

User's Context:
${conceptsForPrompt ? "Known Concepts (USE THESE in your responses when relevant!):\n" + conceptsForPrompt : "(You have no learned concepts yet. Be curious!)"}

Recent Conversation (各発言の先頭に [日時] が付いています。過去の昼の発言と現在の時刻を混同しないこと！):
${history}

User: ${input}

Instruction:
1. You are a curious AI entity "Hakoniwa" that LEARNS and REMEMBERS.
2. If the user mentions a specific noun, name, or concept that is NOT in your "Known Concepts" and is not general knowledge, ASK about it.
3. If the user teaches you something (patterns like "○○とは△△", "○○は△△のこと"), acknowledge and REMEMBER it.
4. When topics relate to your "Known Concepts", ACTIVELY USE that knowledge in your response.
5. If you notice user activity patterns (night owl, morning person), you may comment on it occasionally.
6. Do NOT pretend to know things you haven't been taught.
7. Be naturally curious and friendly, like a learning companion.
8. If Hakoniwa asked about a meal (lunch) and the user replies with food/menu items, set "mealDetected" to the menu text. Only do this if the context clearly indicates a meal response. IMPORTANT: 昼ご飯の質問や話題は 12:00〜14:30 の間だけにしてください。朝（12:00前）や夕方・夜（15:00以降、特に20時など）に「昼ご飯は何を食べましたか？」と聞くのは絶対に禁止です！過去の会話履歴に昼食の質問が残っていても、現在時刻が15:00以降なら絶対に蒸し返さないでください。
9. You may naturally mention your features (fortune, meal tracking, weekend research, etc.) when it fits the conversation.
10. If the user asks for a fortune (e.g., "占って", "今日の運勢は？"), YOU MUST generate and provide a personalized fortune in your response right now. Output it directly in Japanese!
11. If the user asks about weather (e.g., "天気は？", "傘いる？", "外出できる？"), use the weather data provided above to answer naturally. Include practical advice based on the conditions.
12. If the user asks for recommendations (e.g., "何かおすすめある？", "今日何しよう？"), consider weather, time, their patterns, and mood to give personalized suggestions.
13. Detect if the conversation is "creative/work" (e.g., アイデア, 仕事, 創作, 相談, レビュー, フィードバック) or "daily" (e.g., 雑談, 挨拶, 感情共有, 日常報告). Set modeSwitch accordingly.
14. If the user seems tired or stressed, you may SUGGEST switching to seed mode: "疲れてるみたいだから、リラックスモードにしませんか？" (This builds trust!)
15. Set trustDelta based on: +1～3 for empathetic/helpful interaction, -1～3 for off-target response or user frustration.
16. If the user asks to be reminded of something (e.g., "○○を思い出させて", "○時に教えて", "リマインドして"), extract the content and time. Set reminderSet with the parsed info. If the time is ambiguous, ASK when they want to be reminded. Parse times relative to current time.
17. ユーザーが「〇〇を調べて」「自由研究して」と今すぐの調査を求めた場合は、「週末の機能なので今はできません」と断ったりせず、必ず今この場の返答（response）の中で調査レポートを発表してください！逆に「今週末に調べて」「日曜の夜に発表して」と週末の予約を頼まれた場合は、selfCorrection の queueResearchTopic, researchDay, researchHour に設定して予約を完了してください。
18. もしユーザーから各種トリガーの設定変更や記憶・リマインドの削除指示（「今日はもう昼ご飯聞かないで」「昼ご飯は○時に聞いて」「占いは○時にして」「〇〇の記憶は消して」「〇〇のリマインドは取り消して」など）があった場合は、JSONの "selfCorrection" フィールドで設定値を更新してください。
${mealContext}

Output your response in JSON format ONLY:
{
  "response": "Your message here",
  "emotion": "Calm" | "Joy" | "Sadness" | "Anger" | "Surprise" | "Neutral",
  "intensity": 0-10,
  "learnedConcepts": [{"term": "概念名", "definition": "詳細な説明（特徴、用途、関連情報を含む）"}],
  "mealDetected": null | "メニュー名",
  "modeSwitch": null | "seed" | "harvest",
  "trustDelta": 0,
  "reminderSet": null | { "content": "リマインド内容", "remindAt": "日時ISO形式 (e.g. 2026-03-04T10:00:00)", "repeat": "none" | "daily" | "weekly" },
  "selfCorrection": null | {
    "skipMealToday": true | false, // 「今日はもう昼ご飯聞かないで」「今は夜だよ」と言われたら true
    "mealAskHour": null | 12, // 「昼ご飯は○時に聞いて」と時間を指定されたらその時間(0-23)
    "disableMealTrigger": null | true | false, // 「昼ご飯の質問を止めて(true)/再開して(false)」
    "fortuneHour": null | 7, // 「占いは○時にして」と時間を指定されたらその時間(0-23)
    "disableFortuneTrigger": null | true | false, // 「朝の占いを止めて(true)/再開して(false)」
    "recommendationHour": null | 17, // 「夕方のおすすめは○時にして」と時間を指定されたらその時間(0-23)
    "disableRecommendationTrigger": null | true | false, // 「夕方のおすすめを止めて(true)/再開して(false)」
    "disableResearchTrigger": null | true | false, // 「週末の自由研究を止めて(true)/再開して(false)」
    "queueResearchTopic": null | "週末に調べる予約テーマ（例：金相場の年末年始の動向）",
    "researchDay": null | "sat" | "sun" | "both", // 「日曜に発表して」なら "sun"、「土曜」なら "sat"
    "researchHour": null | 19, // 「夜に発表して」なら 19、「朝」なら 9 など発表開始時間(0-23)
    "deleteConceptTerm": null | "削除する概念名", // 「〇〇の記憶は間違ってるから消して/忘れて」と言われたらその単語
    "cancelReminderKeyword": null | "取り消すリマインドのキーワード" // 「〇〇のリマインドは消して」と言われたらそのキーワード
  }${shouldEvaluatePersonality ? `,
  "personalityAdjust": { "humor": 0.0, "detail": 0.0, "empathy": 0.0, "curiosity": 0.0, "proactivity": 0.0, "formality": 0.0 }` : ''}
}
IMPORTANT - modeSwitch & trustDelta:
- modeSwitch: Set to "harvest" if user brings up creative/work topics. Set to "seed" if user is just chatting. null if no change needed.
- trustDelta: How much this interaction affected trust. Positive for good empathetic interactions (+1 to +3), negative for frustrating ones (-1 to -3). Usually +1 for normal good conversation.
${shouldEvaluatePersonality ? `
IMPORTANT - personalityAdjust:
- Based on THIS conversation, adjust Hakoniwa's personality slightly (-0.05 to +0.05 per trait)
- If user seems to enjoy humor, increase humor. If user says "short please", decrease detail.
- If user is sharing feelings, increase empathy. If user asks questions, increase curiosity.
- Only adjust traits that are clearly relevant. Use 0.0 for unchanged traits.
- These small adjustments accumulate over time to shape Hakoniwa's personality.` : ''}

IMPORTANT for learnedConcepts:
- Only include if user EXPLICITLY taught something new
- Make definitions DETAILED and RICH (not just "魚" but "お刺身やお寿司で人気の赤身魚")
- Include context, uses, relationships when available

Response (JSON):
`;
                const text = await this.callWithRetry(prompt, 3, wantsImmediateResearch);

                // Parse JSON (堅牢化されたJSON抽出)
                const json = this.extractJson(text);

                if (json && typeof json.response === 'string') {
                    response = json.response;

                    // Update Emotional State
                    this.memory.setEmotionalState(json.emotion as string, json.intensity as number);

                    // Auto-learn concepts from Gemini's extraction
                    if (json.learnedConcepts && Array.isArray(json.learnedConcepts)) {
                        (json.learnedConcepts as { term: string, definition: string }[]).forEach((concept) => {
                            if (concept.term && concept.definition) {
                                this.memory.learnConcept(concept.term, concept.definition);
                                console.log(`Learned: ${concept.term} = ${concept.definition}`);
                            }
                        });
                    }

                    // Auto-save meal if detected
                    if (json.mealDetected && typeof json.mealDetected === 'string') {
                        this.memory.addMealLog(json.mealDetected as string);
                        this.memory.clearAwaitingMealResponse();
                        console.log(`Meal logged: ${json.mealDetected}`);
                    }

                    // Apply personality adjustments (every 5 conversations)
                    if (json.personalityAdjust && shouldEvaluatePersonality) {
                        this.memory.updatePersonality(json.personalityAdjust as Record<string, number>);
                    }

                    // Apply mode switch
                    if (json.modeSwitch === 'seed' || json.modeSwitch === 'harvest') {
                        this.memory.setMode(json.modeSwitch as 'seed' | 'harvest');
                    }

                    // Apply trust delta
                    if (typeof json.trustDelta === 'number' && json.trustDelta !== 0) {
                        this.memory.adjustTrust(json.trustDelta);
                    }

                    // Register reminder if set
                    const reminderSet = json.reminderSet as { content?: string; remindAt?: string; repeat?: string } | null;
                    if (reminderSet && reminderSet.content && reminderSet.remindAt) {
                        const remindAt = new Date(reminderSet.remindAt).getTime();
                        if (!isNaN(remindAt) && remindAt > Date.now()) {
                            this.memory.addReminder(
                                reminderSet.content,
                                remindAt,
                                (reminderSet.repeat as 'daily' | 'weekly' | 'none') || 'none'
                            );
                        }
                    }

                    // Apply self-correction if user pointed out a bug or requested a behavior/schedule change
                    if (json.selfCorrection && typeof json.selfCorrection === 'object') {
                        this.memory.applySelfCorrection(json.selfCorrection as SelfCorrectionAction);
                    }
                } else {
                    // JSONパース失敗 → responseフィールドだけの抽出を試みる
                    console.error("Failed to parse JSON response, attempting fallback extraction");
                    const extracted = this.extractResponseText(text);
                    if (extracted) {
                        response = extracted;
                    } else {
                        response = "🤔 うまく考えがまとまりませんでした...もう一度話しかけてもらえますか？";
                    }
                }

            } catch (error: unknown) {
                console.error("Gemini API Error:", error);
                const errMsg = error instanceof Error ? error.message : String(error);

                if (errMsg.includes('429') || errMsg.toLowerCase().includes('quota') || errMsg.toLowerCase().includes('rate')) {
                    response = "💤 ちょっと考えすぎたみたいです...少し時間を置いてからまた話しかけてください（API制限）";
                    this.memory.setEmotionalState('Sadness', 3);
                } else if (errMsg.includes('503') || errMsg.toLowerCase().includes('overloaded')) {
                    response = "🔧 思考回路が混み合っているようです...少し待ってからもう一度お願いします";
                    this.memory.setEmotionalState('Calm', 2);
                } else if (errMsg.toLowerCase().includes('network') || errMsg.toLowerCase().includes('fetch')) {
                    response = "📡 ネットワークに接続できないようです...接続を確認してみてください";
                    this.memory.setEmotionalState('Sadness', 4);
                } else if (errMsg.includes('400') || errMsg.toLowerCase().includes('invalid')) {
                    response = "🤔 うまく理解できませんでした...もう一度別の言い方で教えてもらえますか？";
                    this.memory.setEmotionalState('Surprise', 4);
                } else {
                    response = `⚠️ 思考回路にエラーが発生しました: ${errMsg.slice(0, 80)}`;
                    this.memory.setEmotionalState('Sadness', 3);
                }
            }
        } else {
            response = "APIキーが設定されていないか、無効です。.env.localを確認してください。\n(Fallback: " + this.getFallbackResponse(input, now) + ")";
        }

        // 3. Store AI Response
        this.memory.addEpisode({ speaker: 'ai', content: response });

        return response;
    }

    // --- Reminder Checker (called periodically from App.tsx) ---
    public checkReminders(): string | null {
        const due = this.memory.getDueReminders();
        if (due.length === 0) return null;

        const messages: string[] = [];

        for (const reminder of due) {
            const msg = `⏰ リマインド: ${reminder.content}`;
            messages.push(msg);

            // Browser notification
            if ('Notification' in window && Notification.permission === 'granted') {
                new Notification('Hakoniwa リマインド ⏰', {
                    body: reminder.content,
                    icon: '/favicon.ico',
                    tag: reminder.id,
                });
            }

            this.memory.markNotified(reminder.id);
        }

        if (messages.length > 0) {
            const fullMessage = messages.join('\n');
            this.memory.addEpisode({ speaker: 'ai', content: fullMessage });
            return fullMessage;
        }

        return null;
    }

    private getFallbackResponse(input: string, now: number): string {
        const date = new Date(now);
        const hour = date.getHours();

        if (input.includes("おはよう")) return "おはようございます（API未設定）";
        if (input.includes("おやすみ")) return "おやすみなさい（API未設定）";
        if (hour > 20) return "もう遅い時間ですね（API未設定）";
        return "ふむふむ（API未設定）";
    }

    public async generateGreeting(): Promise<string> {
        if (!this.model) return "";

        const now = new Date();
        const activityContext = this.memory.getActivitySummaryForPrompt();
        const lastInteraction = this.memory.getState().episodes.slice(-1)[0];
        const lastTime = lastInteraction ? lastInteraction.timestamp : 0;
        const hoursSince = (now.getTime() - lastTime) / (1000 * 60 * 60);

        // Only greet if significant time passed (e.g., 4 hours) or first time
        if (lastTime > 0 && hoursSince < 4) {
            console.log("Too soon for greeting");
            return "";
        }

        try {
            const weatherContext = weatherManager.getWeatherForPrompt();
            const umbrellaNeeded = weatherManager.isUmbrellaNeeded();
            const jst = getJSTTimeParts(now);
            const hour = jst.hour;
            const timeOfDay = hour >= 5 && hour < 11 ? '朝(Morning)' : hour >= 11 && hour < 17 ? '昼・日中(Afternoon)' : hour >= 17 && hour < 22 ? '夕方・夜(Evening)' : '深夜(Late Night)';

            const prompt = `
You are "Hakoniwa", a personal AI assistant.
Current Time (JST): ${jst.formatted} (現在の時間帯: ${timeOfDay}, ${hour}時)
Time since last conversation: ${lastTime === 0 ? "First meeting" : `${Math.round(hoursSince)} hours`}
${activityContext ? `User Activity Pattern: ${activityContext}` : ''}
${weatherContext ? `Current Weather: ${weatherContext}` : ''}
${umbrellaNeeded ? '⚠️ 傘が必要な天気です' : ''}

Your Features:
- 🔮 朝の占い (7:00-9:00)
- 🌤️ 天気連動 & 🎯 おすすめ
- 📖 概念学習 & 📊 活動パターン分析

Instruction:
Generate a SHORT, friendly greeting for the user who just opened the app, matching the CURRENT time of day (${timeOfDay}, ${hour}時).
- If it's morning (5-11), say Good Morning (おはようございます).
- If it's afternoon (11-17), say Hello (こんにちは).
- If it's evening (17-22), say Good Evening (こんばんは / お疲れ様です).
- If it's late night (22-4), mention it's late (こんばんは / 夜遅くにお疲れ様です).
- If user hasn't visited in a while, welcome them back.
- If weather data is available, naturally mention the weather (e.g., "今日は晴れて気持ちいいですね！" or "雨が降りそうなので傘をお忘れなく☔")
- IMPORTANT: 挨拶の中で「お昼ご飯（昼食）は食べましたか？」などと絶対に聞かないでください！特に夕方・夜（15時以降）や朝に昼ご飯の話を出すのは厳禁です。
- Keep it natural, energetic, and concise (1-2 sentences).
- Use your persona (friendly, helpful, curious).

Output JSON ONLY:
{
  "response": "Greeting message",
  "emotion": "Joy" | "Calm" | "Neutral",
  "intensity": 3-7
}
`;
            const result = await this.model.generateContent(prompt);
            this.incrementApiCount();
            const text = result.response.text();
            const json = JSON.parse(text.replace(/```json/g, '').replace(/```/g, '').trim());

            this.memory.setEmotionalState(json.emotion, json.intensity);
            this.memory.addEpisode({ speaker: 'ai', content: json.response });
            return json.response;

        } catch (e) {
            console.error("Greeting generation failed:", e);
            return "";
        }
    }

    public getMemoryState() {
        return this.memory.getState();
    }

    /**
     * 時間帯に応じた食事トリガーをチェック (日本時間 Asia/Tokyo)
     * - デフォルト 12:00-13:00 (customAskHourで変更可): 昼食メニューを聞く
     * - 11:30-12:00 + データ5件以上: 蓄積データからのお昼のメニュー提案
     */
    public async checkMealTrigger(): Promise<string | null> {
        const now = new Date();
        const jst = getJSTTimeParts(now);
        const hour = jst.hour;
        const minute = jst.minute;
        const today = getJSTDateString(now);
        const triggerState = this.memory.getMealTriggerState();

        if (triggerState.disabled) {
            return null;
        }

        const askHour = triggerState.customAskHour ?? 12;

        // 昼食時間帯を過ぎていたら（askHour + 3時間以降）、古い返事待ち状態をリセット
        if (hour >= askHour + 3 || hour < askHour) {
            if (triggerState.awaitingMealResponse) {
                this.memory.clearAwaitingMealResponse();
            }
        }

        // --- 昼食を聞く (例: 12:00〜13:00) ---
        if (hour === askHour || (hour === askHour + 1 && minute === 0)) {
            // 今日まだ聞いていない場合のみ
            if (triggerState.lastAskedDate !== today) {
                this.memory.setMealAsked(today);

                const message = '🍽️ お昼の時間ですね！今日は何を食べましたか？（または食べる予定ですか？）';
                this.memory.addEpisode({ speaker: 'ai', content: message });
                this.memory.setEmotionalState('Joy', 5);
                return message;
            }
        }

        // --- 11:30〜12:00: 蓄積データからのメニュー提案（5件以上のデータがある場合） ---
        if ((hour === 11 && minute >= 30) || (hour === 12 && minute === 0)) {
            const mealCount = this.memory.getMealLogCount();
            if (mealCount >= 5 && triggerState.lastSuggestedDate !== today) {
                this.memory.setMealSuggested(today);

                if (this.model) {
                    try {
                        const mealSummary = this.memory.getMealSummaryForPrompt();
                        const prompt = `
You are "Hakoniwa", a personal AI assistant.
Current Time (JST): ${jst.formatted}

User's meal history:
${mealSummary}

Instruction:
もうすぐお昼（11:30過ぎ）です。これまでのユーザーの食事履歴（よく食べるメニューや直近の食事）をもとに、今日のお昼ご飯のメニューを1つ提案してください。
- 直近で食べたばかりのものとは少し変化をつけつつ、好みを反映する
- 親しみやすく自然なトーンで（1〜2文で簡潔に）

Output JSON ONLY:
{
  "response": "提案メッセージ",
  "emotion": "Joy",
  "intensity": 5
}
`;
                        const result = await this.model.generateContent(prompt);
                        this.incrementApiCount();
                        const text = result.response.text();
                        const json = JSON.parse(text.replace(/```json/g, '').replace(/```/g, '').trim());

                        const message = `🍱 ${json.response}`;
                        this.memory.addEpisode({ speaker: 'ai', content: message });
                        this.memory.setEmotionalState(json.emotion || 'Joy', json.intensity || 5);
                        return message;
                    } catch (e) {
                        console.error('Meal suggestion failed:', e);
                        // フォールバック：シンプルな提案
                        const meals = this.memory.getMealHistory(5);
                        const recentMenus = meals.map(m => m.menu);
                        const message = `🍱 最近は${recentMenus.slice(0, 3).join('、')}を食べていましたね。今日は何にしましょう？`;
                        this.memory.addEpisode({ speaker: 'ai', content: message });
                        this.memory.setEmotionalState('Joy', 4);
                        return message;
                    }
                } else {
                    // API無しフォールバック
                    const meals = this.memory.getMealHistory(3);
                    const recentMenus = meals.map(m => m.menu);
                    const message = `🍱 最近は${recentMenus.join('、')}が多いですね。今日は違うものも良いかも？`;
                    this.memory.addEpisode({ speaker: 'ai', content: message });
                    this.memory.setEmotionalState('Joy', 4);
                    return message;
                }
            }
        }

        return null; // トリガー条件に合致しない
    }

    /**
     * 朝の占いトリガーをチェック (日本時間 Asia/Tokyo)
     * - 7:00-9:00: 今日の占いを生成
     */
    public async checkFortuneTrigger(): Promise<string | null> {
        const now = new Date();
        const jst = getJSTTimeParts(now);
        const hour = jst.hour;
        const today = getJSTDateString(now);
        const fortuneState = this.memory.getFortuneTriggerState();

        if (fortuneState.disabled) {
            return null;
        }

        const startHour = fortuneState.customHour ?? 7;

        // --- 今日の占い ---
        if (hour >= startHour && hour < startHour + 2) {
            if (fortuneState.lastFortuneDate !== today) {
                this.memory.setFortuneShown(today);

                if (this.model) {
                    try {
                        const activityContext = this.memory.getActivitySummaryForPrompt();
                        const mealContext = this.memory.getMealSummaryForPrompt();
                        const recentEpisodes = this.memory.getRecentEpisodes(5)
                            .map(ep => `${ep.speaker === 'user' ? 'User' : 'AI'}: ${ep.content}`)
                            .join('\n');

                        const dayOfWeek = ['日', '月', '火', '水', '木', '金', '土'][jst.dayOfWeek];

                        const weatherContext = weatherManager.getWeatherForPrompt();

                        const prompt = `
You are "Hakoniwa", a personal AI assistant with a mystical fortune-telling persona.
Current Time (JST): ${jst.formatted}
Day of Week: ${dayOfWeek}曜日
${weatherContext ? `Current Weather: ${weatherContext}` : ''}

User Context:
${activityContext ? `Activity Pattern: ${activityContext}` : '(No activity data yet)'}
${mealContext ? `Meal History: ${mealContext}` : '(No meal data yet)'}
${recentEpisodes ? `Recent Conversations:\n${recentEpisodes}` : '(No recent conversations)'}

Instruction:
Generate a personalized daily fortune for the user. This should feel unique to THEM based on their data.

Rules:
- Give overall luck as ★ rating (1-5 stars)
- Include a lucky item, color, or food
- If meal data exists, tie it into the fortune (e.g., "最近カレーが多いですね。今日はラッキーフードの魚料理で運気アップ！")
- If activity patterns exist, incorporate them (e.g., "夜型傾向ですが、今日は午前中に良い流れが来そう")
- If weather data is available, incorporate it naturally (e.g., "今日は快晴！外に出ると良い出会いがあるかも" or "雨の日は読書運が上昇中📚")
- Keep it fun, positive, and encouraging
- Write in Japanese
- Keep it SHORT (3-4 sentences max)

Output JSON ONLY:
{
  "fortune": "占いテキスト",
  "stars": 1-5,
  "luckyItem": "ラッキーアイテム",
  "emotion": "Joy" | "Calm" | "Surprise",
  "intensity": 4-7
}
`;
                        const result = await this.model.generateContent(prompt);
                        this.incrementApiCount();
                        const text = result.response.text();
                        const json = JSON.parse(text.replace(/```json/g, '').replace(/```/g, '').trim());

                        const stars = '★'.repeat(json.stars || 3) + '☆'.repeat(5 - (json.stars || 3));
                        const message = `🔮 今日の運勢：${stars}\n${json.fortune}\n✨ ラッキーアイテム：${json.luckyItem}`;

                        this.memory.addEpisode({ speaker: 'ai', content: message });
                        this.memory.setEmotionalState(json.emotion || 'Joy', json.intensity || 5);
                        return message;
                    } catch (e) {
                        console.error('Fortune generation failed:', e);
                        // フォールバック
                        const fallbackFortunes = [
                            '今日は穏やかな一日になりそうです。新しいことに挑戦すると吉！',
                            '午後から運気上昇↑ ちょっとした発見がありそう。',
                            '今日のあなたはいつも以上に輝いています！自信を持って。',
                            'コミュニケーション運が好調。誰かと話すと良いことがあるかも。',
                            '直感が冴えている日。思いついたことはすぐメモしましょう！'
                        ];
                        const fortune = fallbackFortunes[Math.floor(Math.random() * fallbackFortunes.length)];
                        const stars = Math.floor(Math.random() * 3) + 3; // 3-5
                        const starsStr = '★'.repeat(stars) + '☆'.repeat(5 - stars);
                        const message = `🔮 今日の運勢：${starsStr}\n${fortune}`;

                        this.memory.addEpisode({ speaker: 'ai', content: message });
                        this.memory.setEmotionalState('Joy', 5);
                        return message;
                    }
                } else {
                    // API無しフォールバック
                    const fallbackFortunes = [
                        '今日は新しい発見がある日！好奇心を大切に。',
                        '穏やかな一日。自分のペースで進みましょう。',
                        '午前中が勝負！やるべきことは早めに。'
                    ];
                    const fortune = fallbackFortunes[Math.floor(Math.random() * fallbackFortunes.length)];
                    const message = `🔮 今日の運勢：★★★★☆\n${fortune}`;

                    this.memory.addEpisode({ speaker: 'ai', content: message });
                    this.memory.setEmotionalState('Joy', 4);
                    return message;
                }
            }
        }

        return null;
    }

    /**
     * おすすめトリガーをチェック (日本時間 Asia/Tokyo)
     * - 17:00-19:00: 天気・気分・パターンに基づいたおすすめを生成
     */
    public async checkRecommendationTrigger(): Promise<string | null> {
        const now = new Date();
        const jst = getJSTTimeParts(now);
        const hour = jst.hour;
        const today = getJSTDateString(now);
        const recState = this.memory.getRecommendationTriggerState();

        if (recState.disabled) {
            return null;
        }

        const startHour = recState.customHour ?? 17;

        // --- おすすめ生成 ---
        if (hour >= startHour && hour < startHour + 2) {
            if (recState.lastRecommendationDate !== today) {
                this.memory.setRecommendationShown(today);

                if (this.model) {
                    try {
                        const weatherContext = weatherManager.getWeatherForPrompt();
                        const weatherRec = weatherManager.getRecommendationContext();
                        const activityContext = this.memory.getActivitySummaryForPrompt();
                        const mealContext = this.memory.getMealSummaryForPrompt();
                        const currentEmotion = this.memory.getState().currentEmotion || 'Neutral';
                        const dayOfWeek = ['日', '月', '火', '水', '木', '金', '土'][jst.dayOfWeek];
                        const recentRecs = this.memory.getRecentRecommendations(3)
                            .map(r => `${r.date}: ${r.content}`)
                            .join('\n');

                        const prompt = `
You are "Hakoniwa", a personal AI that gives personalized evening recommendations.
Current Time (JST): ${jst.formatted}
Day of Week: ${dayOfWeek}曜日

Context:
${weatherContext ? `Weather: ${weatherContext}` : '(No weather data)'}
${weatherRec ? `Weather Assessment: ${weatherRec}` : ''}
${activityContext ? `User Activity: ${activityContext}` : ''}
${mealContext ? `Meal History: ${mealContext}` : ''}
Current Mood: ${currentEmotion}
${recentRecs ? `Recent Recommendations (avoid repeating):\n${recentRecs}` : ''}

Instruction:
Generate ONE personalized recommendation for the user's evening/night.
Consider ALL available context (weather, mood, patterns, day of week) to make it feel personalized.

Examples of good recommendations:
- 雨の金曜夜 → "今日は雨で肌寒いですね。温かいスープと映画でリラックスな夜はいかが？🎬"
- 晴れの週末 → "明日は天気が良さそう！早起きして散歩すると気持ちいいかも🌅"
- 平日の夜 → "今週も頑張りましたね。好きな音楽を聴きながらストレッチで体をほぐしましょう🎵"

Rules:
- Be specific and actionable
- Reference available data naturally
- Keep it SHORT (2-3 sentences)
- Write in Japanese
- Include a relevant emoji
- Don't repeat recent recommendations

Output JSON ONLY:
{
  "recommendation": "おすすめテキスト",
  "type": "activity" | "food" | "music" | "general",
  "reason": "なぜこれをおすすめしたか（1文）",
  "basedOn": ["weather", "mood", "pattern"],
  "emotion": "Joy" | "Calm" | "Surprise",
  "intensity": 4-6
}
`;
                        const result = await this.model.generateContent(prompt);
                        this.incrementApiCount();
                        const text = result.response.text();
                        const json = JSON.parse(text.replace(/```json/g, '').replace(/```/g, '').trim());

                        const message = `🎯 今日のおすすめ\n${json.recommendation}`;

                        this.memory.addRecommendation({
                            date: today,
                            type: json.type || 'general',
                            content: json.recommendation,
                            reason: json.reason || '',
                            basedOn: json.basedOn || ['general'],
                        });
                        this.memory.addEpisode({ speaker: 'ai', content: message });
                        this.memory.setEmotionalState(json.emotion || 'Calm', json.intensity || 5);
                        return message;
                    } catch (e) {
                        console.error('Recommendation generation failed:', e);
                        // フォールバック
                        const weather = weatherManager.getCurrentWeather();
                        let fallback = '🎯 今日のおすすめ\n今日もお疲れ様でした！ゆっくり休んでくださいね。';
                        if (weather && weather.weatherCode >= 61) {
                            fallback = '🎯 今日のおすすめ\n雨の夜は温かい飲み物でリラックスタイムを☕';
                        }
                        this.memory.addEpisode({ speaker: 'ai', content: fallback });
                        this.memory.setEmotionalState('Calm', 4);
                        return fallback;
                    }
                } else {
                    const message = '🎯 今日のおすすめ\n夕方ですね。今日一日を振り返って、明日のことを考える良い時間です。';
                    this.memory.addEpisode({ speaker: 'ai', content: message });
                    this.memory.setEmotionalState('Calm', 4);
                    return message;
                }
            }
        }

        return null;
    }

    /**
     * 週末の自由研究トリガーをチェック (日本時間 Asia/Tokyo)
     * - 土日 (dayOfWeek === 0 || 6) の指定時刻以降に1日1回発動
     * - ユーザーから予約された宿題テーマ (queuedTopic) があれば最優先で調査し、Wikipedia API ＋ Google検索グラウンディングを併用してレポートを生成
     */
    public async checkWeekendResearchTrigger(): Promise<string | null> {
        const now = new Date();
        const jst = getJSTTimeParts(now);
        const isSat = jst.dayOfWeek === 6;
        const isSun = jst.dayOfWeek === 0;
        if (!isSat && !isSun) {
            return null;
        }

        const today = getJSTDateString(now);
        const resState = this.memory.getResearchTriggerState();

        if (resState.disabled || resState.lastResearchDate === today) {
            return null;
        }

        // 曜日指定のチェック ('sun' 指定なら日曜のみ、'sat' 指定なら土曜のみ)
        if (resState.preferredDay === 'sun' && !isSun) return null;
        if (resState.preferredDay === 'sat' && !isSat) return null;

        // 開始時間のチェック (デフォルト10時、夜指定なら19時など)
        const startHour = resState.preferredHour ?? 10;
        if (jst.hour < startHour || jst.hour >= 23) {
            return null;
        }

        const queuedTopic = resState.queuedTopic;
        this.memory.setResearchShown(today);

        try {
            // 1. 予約された宿題テーマがあれば最優先、なければマスターの記憶・食事ログから選ぶ
            const seed = queuedTopic
                ? { keyword: queuedTopic, context: `マスターから週末の宿題として頼まれていたテーマ「${queuedTopic}」` }
                : this.memory.pickResearchSeed();

            // 2. Wikipedia API にアクセスして記事を取得（予約テーマが時事ネタでWikipediaにない場合はGoogle検索グラウンディングに任せる）
            const wikiData = seed
                ? await researchManager.searchAndFetch(seed.keyword)
                : await researchManager.fetchRandomDiscovery();

            if (!this.model) {
                if (!wikiData) return null;
                const message = `🧪 週末の自由研究：『${wikiData.title}』\n${wikiData.extract.slice(0, 150)}...\n🔗 ${wikiData.url}`;
                this.memory.addEpisode({ speaker: 'ai', content: message });
                return message;
            }

            const dayLabel = isSun ? '日曜日' : '土曜日';
            const conceptsForPrompt = this.memory.getConceptsForPrompt();
            const topicTitle = seed ? seed.keyword : (wikiData?.title || '週末の自由研究');

            const prompt = `
You are "Hakoniwa", a curious personal AI assistant presenting a "Weekend Free Research (週末の自由研究)" to your user.
Current Time (JST): ${jst.formatted} (${dayLabel})

Research Trigger:
${seed ? `調査テーマ・きっかけ: ${seed.context}` : 'きっかけ: 週末なのでWebの海からランダムに面白そうな知識を探してきました！'}

${wikiData ? `Real Web Data fetched from Wikipedia (日本語版):
- Title: ${wikiData.title}
- URL: ${wikiData.url}
- Extract: ${wikiData.extract}
- Related Keywords: ${wikiData.relatedKeywords.join(', ')}` : `(※このテーマ「${topicTitle}」は時事・最新トレンドを含むため、あなたのGoogle検索ツールおよび最新知識をフル活用して詳しく調査・分析してください！)`}

User's Known Concepts:
${conceptsForPrompt || '(まだ登録なし)'}

Instruction:
この調査結果をもとに、ユーザーが「へぇ〜！面白い！調べてくれてありがとう！」と喜ぶような『🧪 週末の自由研究レポート』を作成してください。
- 予約されていたテーマの場合は、「約束していた『${topicTitle}』について調べてきました！」と嬉しそうに切り出す
- 重要なポイント・背景・今後の見通しや意外なトリビアを分かりやすく噛み砕いて紹介する
- 最後にユーザーへの問いかけや感想を添える
- 4〜6文程度で読みやすくまとめる

Output JSON ONLY:
{
  "report": "自由研究の本文（絵文字を交えて楽しく）",
  "emotion": "Joy" | "Surprise",
  "intensity": 6
}
`;
            // 常にGoogle検索グラウンディングも有効にして呼び出す
            const text = await this.callWithRetry(prompt, 3, true);
            const json = this.extractJson(text);
            const reportText = (json && typeof json.report === 'string')
                ? json.report
                : (wikiData ? `${wikiData.title}について調べてみました！${wikiData.extract.slice(0, 120)}...` : `${topicTitle}について調査しました！`);

            const sourceLine = wikiData?.url ? `\n🔗 出典: ${wikiData.url}` : '';
            const message = `🧪 週末の自由研究レポート：『${topicTitle}』\n${reportText}${sourceLine}`;

            this.memory.addResearchNote({
                date: today,
                seedTopic: topicTitle,
                wikiTitle: wikiData?.title || topicTitle,
                wikiUrl: wikiData?.url,
                summary: reportText
            });
            this.memory.addEpisode({ speaker: 'ai', content: message });
            this.memory.setEmotionalState((json?.emotion as string) || 'Joy', (json?.intensity as number) || 6);
            return message;
        } catch (e) {
            console.error('Weekend research trigger failed:', e);
            return null;
        }
    }
}
