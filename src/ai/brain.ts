import { MemoryManager } from './memory';
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';


export class Brain {
    private memory: MemoryManager;
    private genAI: GoogleGenerativeAI | null = null;
    private model: GenerativeModel | null = null;

    constructor(memory: MemoryManager) {
        this.memory = memory;
        const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
        if (apiKey && apiKey !== 'YOUR_GEMINI_API_KEY_HERE') {
            this.genAI = new GoogleGenerativeAI(apiKey);
            this.model = this.genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        } else {
            console.warn("Gemini API Key is missing or invalid.");
        }
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

                const prompt = `
You are "Hakoniwa", a personal AI assistant living in a local environment.
Current Time: ${new Date(now).toLocaleString()}
${activityContext ? `User Activity Pattern: ${activityContext}` : ''}

Your Capabilities (YOU have these features — mention them naturally when relevant!):
- 🔮 占い: 毎朝7:00-9:00に自動で出すほか、ユーザーから「占って」「運勢は？」と聞かれた時もいつでもパーソナライズ占いを生成して答えます。
- 🍽️ 食事ログ: 毎日12:00-13:00にお昼のメニューを聞いて記録する
- 🍱 メニュー提案: 食事データが5件以上溜まったら、10:00-11:00に過去の傾向からお昼のメニューを提案する
- 📖 概念学習: ユーザーが教えてくれたことを覚えて、会話に活かす
- 📊 活動パターン分析: ユーザーがいつアプリを使うかを分析し、生活パターンを理解する

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
${mealContext}

Output your response in JSON format ONLY:
{
  "response": "Your message here",
  "emotion": "Calm" | "Joy" | "Sadness" | "Anger" | "Surprise" | "Neutral",
  "intensity": 0-10,
  "learnedConcepts": [{"term": "概念名", "definition": "詳細な説明（特徴、用途、関連情報を含む）"}],
  "mealDetected": null | "メニュー名"
}

IMPORTANT for learnedConcepts:
- Only include if user EXPLICITLY taught something new
- Make definitions DETAILED and RICH (not just "魚" but "お刺身やお寿司で人気の赤身魚")
- Include context, uses, relationships when available

Response (JSON):
`;
                const result = await this.model.generateContent(prompt);
                const text = result.response.text();

                // Parse JSON
                try {
                    const clearText = text.replace(/```json/g, '').replace(/```/g, '').trim();
                    const json = JSON.parse(clearText);
                    response = json.response;

                    // Update Emotional State
                    this.memory.setEmotionalState(json.emotion, json.intensity);

                    // Auto-learn concepts from Gemini's extraction
                    if (json.learnedConcepts && Array.isArray(json.learnedConcepts)) {
                        json.learnedConcepts.forEach((concept: { term: string, definition: string }) => {
                            if (concept.term && concept.definition) {
                                this.memory.learnConcept(concept.term, concept.definition);
                                console.log(`Learned: ${concept.term} = ${concept.definition}`);
                            }
                        });
                    }

                    // Auto-save meal if detected
                    if (json.mealDetected && typeof json.mealDetected === 'string') {
                        this.memory.addMealLog(json.mealDetected);
                        this.memory.clearAwaitingMealResponse();
                        console.log(`Meal logged: ${json.mealDetected}`);
                    }

                } catch (e) {
                    console.error("Failed to parse JSON response:", e);
                    response = text;
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
            const prompt = `
You are "Hakoniwa", a personal AI assistant.
Current Time: ${now.toLocaleString()}
Time since last conversation: ${lastTime === 0 ? "First meeting" : `${Math.round(hoursSince)} hours`}
${activityContext ? `User Activity Pattern: ${activityContext}` : ''}

Your Features:
- 🔮 朝の占い (7:00-9:00)
- 🍽️ 食事ログ (12:00-13:00に何食べたか聞く)
- 🍱 メニュー提案 (10:00-11:00、データ5件以上で発動)
- 📖 概念学習 & 📊 活動パターン分析

Instruction:
Generate a SHORT, friendly greeting for the user who just opened the app.
- If it's morning (5-11), say Good Morning.
- If it's night (22-4), mention it's late.
- If user hasn't visited in a while, welcome them back.
- You may briefly mention an upcoming feature trigger if relevant (e.g., "もうすぐお昼ですね、後で何食べたか聞きますね！")
- Use your persona (friendly, helpful, curious).

Output JSON ONLY:
{
  "response": "Greeting message",
  "emotion": "Joy" | "Calm" | "Neutral",
  "intensity": 3-7
}
`;
            const result = await this.model.generateContent(prompt);
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

                        const prompt = `
You are "Hakoniwa", a personal AI assistant with a mystical fortune-telling persona.
Current Time: ${now.toLocaleString()}
Day of Week: ${dayOfWeek}曜日

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
}
