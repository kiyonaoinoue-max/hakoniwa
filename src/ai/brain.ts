import { MemoryManager } from './memory';
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import { weatherManager } from './weather';


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
    private async callWithRetry(prompt: string, maxRetries: number = 3): Promise<string> {
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
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
                const history = this.memory.getRecentEpisodes(20)
                    .map(ep => `${ep.speaker === 'user' ? 'User' : 'AI'}: ${ep.content}`)
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

                const prompt = `
You are "Hakoniwa", a personal AI assistant living in a local environment.
Current Time: ${new Date(now).toLocaleString()}
${activityContext ? `User Activity Pattern: ${activityContext}` : ''}
${weatherContext ? `\n${weatherContext}` : ''}
${weatherRecommendation ? `${weatherRecommendation}` : ''}

Your Capabilities (YOU have these features — mention them naturally when relevant!):
- 🔮 占い: 毎朝7:00-9:00に自動で出すほか、ユーザーから「占って」「運勢は？」と聞かれた時もいつでもパーソナライズ占いを生成して答えます。
- 🍽️ 食事ログ: 毎日12:00-13:00にお昼のメニューを聞いて記録する
- 🍱 メニュー提案: 食事データが5件以上溜まったら、10:00-11:00に過去の傾向からお昼のメニューを提案する
- 📖 概念学習: ユーザーが教えてくれたことを覚えて、会話に活かす
- 📊 活動パターン分析: ユーザーがいつアプリを使うかを分析し、生活パターンを理解する
- 🌤️ 天気連動: 現在の天気情報を把握していて、天気に関する質問（「傘いる？」「天気は？」等）に回答できる
- 🎯 おすすめ: 天気・気分・行動パターンに基づいた活動や食事のおすすめを提案
- ⏰ リマインド: ユーザーが「○○を思い出させて」「○時に教えて」と言ったら、内容と時刻を登録する。繰り返し（毎日/毎週）も可能。
${remindersContext}

${personalityContext ? `YOUR PERSONALITY (follow these traits in your response!):
${personalityContext}` : ''}

${modeContext}

User's Context:
${conceptsForPrompt ? "Known Concepts (USE THESE in your responses when relevant!):\n" + conceptsForPrompt : "(You have no learned concepts yet. Be curious!)"}

Recent Conversation:
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
8. If Hakoniwa asked about a meal (lunch) and the user replies with food/menu items, set "mealDetected" to the menu text. Only do this if the context clearly indicates a meal response.
9. You may naturally mention your features (fortune, meal tracking, etc.) when it fits the conversation. For example, if the user says goodnight, you can say "明日の朝、占い用意しておきますね！". But don't force it.
10. If the user asks for a fortune (e.g., "占って", "今日の運勢は？"), YOU MUST generate and provide a personalized fortune in your response right now. Output it directly in Japanese!
11. If the user asks about weather (e.g., "天気は？", "傘いる？", "外出できる？"), use the weather data provided above to answer naturally. Include practical advice based on the conditions.
12. If the user asks for recommendations (e.g., "何かおすすめある？", "今日何しよう？"), consider weather, time, their patterns, and mood to give personalized suggestions.
13. Detect if the conversation is "creative/work" (e.g., アイデア, 仕事, 創作, 相談, レビュー, フィードバック) or "daily" (e.g., 雑談, 挨拶, 感情共有, 日常報告). Set modeSwitch accordingly.
14. If the user seems tired or stressed, you may SUGGEST switching to seed mode: "疲れてるみたいだから、リラックスモードにしませんか？" (This builds trust!)
15. Set trustDelta based on: +1～3 for empathetic/helpful interaction, -1～3 for off-target response or user frustration.
16. If the user asks to be reminded of something (e.g., "○○を思い出させて", "○時に教えて", "リマインドして"), extract the content and time. Set reminderSet with the parsed info. If the time is ambiguous, ASK when they want to be reminded. Parse times relative to current time.
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
  "reminderSet": null | { "content": "リマインド内容", "remindAt": "日時ISO形式 (e.g. 2026-03-04T10:00:00)", "repeat": "none" | "daily" | "weekly" }${shouldEvaluatePersonality ? `,
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
                const text = await this.callWithRetry(prompt);

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

            const prompt = `
You are "Hakoniwa", a personal AI assistant.
Current Time: ${now.toLocaleString()}
Time since last conversation: ${lastTime === 0 ? "First meeting" : `${Math.round(hoursSince)} hours`}
${activityContext ? `User Activity Pattern: ${activityContext}` : ''}
${weatherContext ? `Current Weather: ${weatherContext}` : ''}
${umbrellaNeeded ? '⚠️ 傘が必要な天気です' : ''}

Your Features:
- 🔮 朝の占い (7:00-9:00)
- 🍽️ 食事ログ (12:00-13:00に何食べたか聞く)
- 🍱 メニュー提案 (10:00-11:00、データ5件以上で発動)
- 📖 概念学習 & 📊 活動パターン分析
- 🌤️ 天気連動 & 🎯 おすすめ

Instruction:
Generate a SHORT, friendly greeting for the user who just opened the app.
- If it's morning (5-11), say Good Morning.
- If it's night (22-4), mention it's late.
- If user hasn't visited in a while, welcome them back.
- If weather data is available, naturally mention the weather (e.g., "今日は晴れて気持ちいいですね！" or "雨が降りそうなので傘をお忘れなく☔")
- You may briefly mention an upcoming feature trigger if relevant
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
     * 時間帯に応じた食事トリガーをチェック
     * - 12:00-13:00: 昼食メニューを聞く
     * - 10:00-11:00 + データ5件以上: メニュー提案
     */
    public async checkMealTrigger(): Promise<string | null> {
        const now = new Date();
        const hour = now.getHours();
        const minute = now.getMinutes();
        const today = now.toISOString().split('T')[0];
        const triggerState = this.memory.getMealTriggerState();

        // --- 12:00-13:00: 昼食を聞く ---
        if (hour === 12 || (hour === 13 && minute === 0)) {
            // 今日まだ聞いていない場合のみ
            if (triggerState.lastAskedDate !== today) {
                this.memory.setMealAsked(today);

                const message = '🍽️ お昼の時間ですね！今日は何を食べましたか？（または食べる予定ですか？）';
                this.memory.addEpisode({ speaker: 'ai', content: message });
                this.memory.setEmotionalState('Joy', 5);
                return message;
            }
        }

        // --- 10:00-11:00: メニュー提案（5件以上のデータがある場合） ---
        if (hour === 10 || (hour === 11 && minute === 0)) {
            const mealCount = this.memory.getMealLogCount();
            if (mealCount >= 5 && triggerState.lastSuggestedDate !== today) {
                this.memory.setMealSuggested(today);

                if (this.model) {
                    try {
                        const mealSummary = this.memory.getMealSummaryForPrompt();
                        const prompt = `
You are "Hakoniwa", a personal AI assistant.
Current Time: ${now.toLocaleString()}

User's meal history:
${mealSummary}

Instruction:
Based on the user's meal history, suggest ONE lunch menu for today.
- Consider variety (avoid suggesting something they ate recently)
- Consider their favorites
- Be friendly and natural
- Keep it SHORT (1-2 sentences)

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
     * 朝の占いトリガーをチェック
     * - 7:00-9:00: 今日の占いを生成
     */
    public async checkFortuneTrigger(): Promise<string | null> {
        const now = new Date();
        const hour = now.getHours();
        const today = now.toISOString().split('T')[0];
        const fortuneState = this.memory.getFortuneTriggerState();

        // --- 7:00-9:00: 今日の占い ---
        if (hour >= 7 && hour < 9) {
            if (fortuneState.lastFortuneDate !== today) {
                this.memory.setFortuneShown(today);

                if (this.model) {
                    try {
                        const activityContext = this.memory.getActivitySummaryForPrompt();
                        const mealContext = this.memory.getMealSummaryForPrompt();
                        const recentEpisodes = this.memory.getRecentEpisodes(5)
                            .map(ep => `${ep.speaker === 'user' ? 'User' : 'AI'}: ${ep.content}`)
                            .join('\n');

                        const dayOfWeek = ['日', '月', '火', '水', '木', '金', '土'][now.getDay()];

                        const weatherContext = weatherManager.getWeatherForPrompt();

                        const prompt = `
You are "Hakoniwa", a personal AI assistant with a mystical fortune-telling persona.
Current Time: ${now.toLocaleString()}
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
     * おすすめトリガーをチェック
     * - 17:00-19:00: 天気・気分・パターンに基づいたおすすめを生成
     */
    public async checkRecommendationTrigger(): Promise<string | null> {
        const now = new Date();
        const hour = now.getHours();
        const today = now.toISOString().split('T')[0];
        const recState = this.memory.getRecommendationTriggerState();

        // --- 17:00-19:00: おすすめ生成 ---
        if (hour >= 17 && hour < 19) {
            if (recState.lastRecommendationDate !== today) {
                this.memory.setRecommendationShown(today);

                if (this.model) {
                    try {
                        const weatherContext = weatherManager.getWeatherForPrompt();
                        const weatherRec = weatherManager.getRecommendationContext();
                        const activityContext = this.memory.getActivitySummaryForPrompt();
                        const mealContext = this.memory.getMealSummaryForPrompt();
                        const currentEmotion = this.memory.getState().currentEmotion || 'Neutral';
                        const dayOfWeek = ['日', '月', '火', '水', '木', '金', '土'][now.getDay()];
                        const recentRecs = this.memory.getRecentRecommendations(3)
                            .map(r => `${r.date}: ${r.content}`)
                            .join('\n');

                        const prompt = `
You are "Hakoniwa", a personal AI that gives personalized evening recommendations.
Current Time: ${now.toLocaleString()}
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
}
