import type { BrainState, EpisodicMemory, Semantics, ActivityLogEntry, ActivityStats, MealLogEntry, Recommendation, PersonalityVector, InteractionMode, ReminderEntry, SelfCorrectionAction, ResearchNote, ResearchTriggerState } from './types';

const STORAGE_KEY = 'hakoniwa_ai_memory_v1';

// 日本時間 (Asia/Tokyo) で YYYY-MM-DD を取得するヘルパー
export function getJSTDateString(date: Date = new Date()): string {
    return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' });
}

// 日本時間 (Asia/Tokyo) の時・分・曜日を取得するヘルパー
export function getJSTTimeParts(date: Date = new Date()): { hour: number; minute: number; dayOfWeek: number; formatted: string } {
    const jstString = date.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' });
    const jstDate = new Date(jstString);
    return {
        hour: jstDate.getHours(),
        minute: jstDate.getMinutes(),
        dayOfWeek: jstDate.getDay(),
        formatted: date.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })
    };
}

const INITIAL_STATE: BrainState = {
    episodes: [],
    semantics: {},
    userModel: {
        patterns: {}
    },
    activityLog: [],
    mealLog: [],
    mealTrigger: {
        lastAskedDate: '',
        lastSuggestedDate: '',
        awaitingMealResponse: false,
        customAskHour: 12,
        disabled: false
    },
    fortuneTrigger: {
        lastFortuneDate: '',
        customHour: 7,
        disabled: false
    },
    recommendations: [],
    recommendationTrigger: {
        lastRecommendationDate: '',
        customHour: 17,
        disabled: false
    },
    researchNotes: [],
    researchTrigger: {
        lastResearchDate: '',
        disabled: false,
        queuedTopic: '金相場の年末年始の動向',
        preferredDay: 'sun',
        preferredHour: 19
    },
    personality: {
        humor: 0.3,
        detail: 0.5,
        empathy: 0.5,
        curiosity: 0.6,
        proactivity: 0.4,
        formality: 0.3,
        lastUpdated: 0,
        updateCount: 0
    },
    modeState: {
        currentMode: 'seed',
        trustScore: 30,
        totalSeedCount: 0,
        totalHarvestCount: 0
    },
    reminders: []
};

import { driveManager } from './drive';

export class MemoryManager {
    private state: BrainState;
    private initialized = false;

    constructor() {
        // Initial synchronous load from local storage
        this.state = this.loadFromLocal();
    }

    public async initialize(): Promise<void> {
        if (this.initialized) return;

        if (driveManager.isAuthenticated()) {
            await this.loadFromDrive();
        }
        this.initialized = true;
    }

    public isDriveConnected(): boolean {
        return driveManager.isAuthenticated();
    }

    public async connectDrive(token: string): Promise<void> {
        driveManager.setToken(token);
        await this.loadFromDrive();
    }

    public disconnectDrive(): void {
        driveManager.clearToken();
        // Fallback to whatever is in local storage
        this.state = this.loadFromLocal();
    }

    private async loadFromDrive(): Promise<void> {
        try {
            const content = await driveManager.readFileContent();
            if (content) {
                const parsed = JSON.parse(content);
                this.state = this.validateAndMergeState(parsed);
                // Also update local storage as backup
                localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
                console.log("Memory loaded from Google Drive.");
            }
        } catch (e: any) {
            console.error("Failed to load memory from Drive. It might not exist yet.", e.message);
            // If it doesn't exist yet, we stick with current state (loaded from local)
            // It will be created on first save
        }
    }

    private loadFromLocal(): BrainState {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return INITIAL_STATE;
        try {
            const parsed = JSON.parse(raw);
            return this.validateAndMergeState(parsed);
        } catch (e) {
            console.error("Failed to load memory from local storage", e);
            return INITIAL_STATE;
        }
    }

    private validateAndMergeState(parsed: any): BrainState {
        // Deep merge validation to prevent crash on stale/corrupt data
        return {
            ...INITIAL_STATE,
            ...parsed,
            userModel: {
                ...INITIAL_STATE.userModel,
                ...(parsed.userModel || {}),
                patterns: {
                    ...(parsed.userModel?.patterns || {})
                }
            },
            semantics: {
                ...(parsed.semantics || {})
            },
            episodes: Array.isArray(parsed.episodes) ? parsed.episodes : [],
            mealLog: Array.isArray(parsed.mealLog) ? parsed.mealLog : [],
            mealTrigger: {
                ...INITIAL_STATE.mealTrigger,
                ...(parsed.mealTrigger || {})
            },
            fortuneTrigger: {
                ...INITIAL_STATE.fortuneTrigger,
                ...(parsed.fortuneTrigger || {})
            },
            recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
            recommendationTrigger: {
                ...INITIAL_STATE.recommendationTrigger,
                ...(parsed.recommendationTrigger || {})
            },
            researchNotes: Array.isArray(parsed.researchNotes) ? parsed.researchNotes : [],
            researchTrigger: {
                ...INITIAL_STATE.researchTrigger,
                ...(parsed.researchTrigger || {})
            },
            personality: {
                ...INITIAL_STATE.personality,
                ...(parsed.personality || {})
            },
            modeState: {
                ...INITIAL_STATE.modeState,
                ...(parsed.modeState || {})
            },
            reminders: Array.isArray(parsed.reminders) ? parsed.reminders : []
        };
    }

    // Debounce save so we don't spam Drive API
    private saveTimeout: number | null = null;

    public save(): void {
        // 1. Immediately save to local storage (fast, reliable fallback)
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));

        // 2. Debounced save to Google Drive (if connected)
        if (driveManager.isAuthenticated()) {
            if (this.saveTimeout) {
                clearTimeout(this.saveTimeout);
            }
            this.saveTimeout = window.setTimeout(async () => {
                try {
                    console.log("Syncing memory to Google Drive...");
                    await driveManager.updateFileContent(JSON.stringify(this.state));
                    console.log("Memory synced to Drive successfully.");
                } catch (e) {
                    console.error("Failed to sync memory to Drive:", e);
                }
            }, 3000); // 3 seconds debounce
        }
    }

    // --- Episodic Access ---
    public addEpisode(episode: Omit<EpisodicMemory, 'id' | 'timestamp'>): void {
        const newEpisode: EpisodicMemory = {
            ...episode,
            id: crypto.randomUUID(),
            timestamp: Date.now(),
        };
        this.state.episodes.push(newEpisode);
        // Keep episodes manageable? For now, unlimited. 
        this.save();
    }

    public getRecentEpisodes(limit: number = 10): EpisodicMemory[] {
        return this.state.episodes.slice(-limit);
    }

    public searchEpisodes(keyword: string, limit: number = 3): EpisodicMemory[] {
        const lowerKeyword = keyword.toLowerCase();
        // Filter for user episodes containing the keyword, excluding very recent ones (last 5 mins) to avoid echoing immediate context
        const fiveMinsAgo = Date.now() - 5 * 60 * 1000;

        return this.state.episodes
            .filter(ep =>
                ep.speaker === 'user' &&
                ep.content.toLowerCase().includes(lowerKeyword) &&
                ep.timestamp < fiveMinsAgo
            )
            .sort((a, b) => b.timestamp - a.timestamp) // Newest first
            .slice(0, limit);
    }

    // --- Semantic Access ---
    public getConcept(term: string): Semantics | undefined {
        return this.state.semantics[term.toLowerCase()];
    }

    public learnConcept(term: string, newDefinition: string): void {
        const key = term.toLowerCase();
        const existing = this.state.semantics[key];

        if (existing) {
            // Cumulative learning: merge definitions if new info is different
            const existingDef = existing.definition.toLowerCase();
            const newDef = newDefinition.toLowerCase();

            // Only add if it's meaningfully different (not just a shorter version)
            if (!existingDef.includes(newDef) && !newDef.includes(existingDef) && existingDef !== newDef) {
                // Append new knowledge
                existing.definition = `${existing.definition}。${newDefinition}`;
                existing.lastUpdated = Date.now();
                existing.confidence = Math.min(1.0, existing.confidence + 0.1); // Increase confidence with each learning
                console.log(`Updated concept: ${term} -> ${existing.definition}`);
            } else if (newDefinition.length > existing.definition.length) {
                // Replace with longer/more detailed definition
                existing.definition = newDefinition;
                existing.lastUpdated = Date.now();
                console.log(`Replaced with better definition: ${term} -> ${newDefinition}`);
            }
        } else {
            // New concept
            this.state.semantics[key] = {
                term,
                definition: newDefinition,
                relatedTerms: [],
                lastUpdated: Date.now(),
                confidence: 0.5 // Start lower, build up with repeated teaching
            };
            console.log(`Learned new concept: ${term} = ${newDefinition}`);
        }
        this.save();
    }

    public getConceptsForPrompt(): string {
        const concepts = Object.values(this.state.semantics);
        if (concepts.length === 0) return '';

        return concepts
            .map(c => `- ${c.term}: ${c.definition} (信頼度: ${Math.round(c.confidence * 100)}%)`)
            .join('\n');
    }

    // --- User Pattern Access ---
    public logUserActivity(activityType: string, timestamp: number = Date.now()) {
        if (!this.state.userModel.patterns[activityType]) {
            this.state.userModel.patterns[activityType] = {
                name: activityType,
                dataPoints: [],
                inferredRanges: []
            };
        }
        this.state.userModel.patterns[activityType].dataPoints.push(timestamp);
        this.save();
    }

    public setEmotionalState(emotion: string, intensity: number) {
        this.state.currentEmotion = emotion;
        this.state.currentIntensity = intensity;
        this.save();
    }

    public getState(): BrainState {
        return this.state;
    }

    // --- Activity Tracking ---
    public logSessionActivity(): void {
        const now = new Date();
        const jst = getJSTTimeParts(now);
        const entry: ActivityLogEntry = {
            date: getJSTDateString(now),
            hour: jst.hour,
            dayOfWeek: jst.dayOfWeek
        };

        // Avoid duplicate entries for same hour
        const lastEntry = this.state.activityLog[this.state.activityLog.length - 1];
        if (lastEntry && lastEntry.date === entry.date && lastEntry.hour === entry.hour) {
            return; // Already logged this hour
        }

        this.state.activityLog.push(entry);

        // Keep last 100 entries to limit storage
        if (this.state.activityLog.length > 100) {
            this.state.activityLog = this.state.activityLog.slice(-100);
        }
        this.save();
    }

    public getActivityStats(): ActivityStats {
        const log = this.state.activityLog || [];
        if (log.length === 0) {
            return {
                totalSessions: 0,
                peakHour: 12,
                isNightOwl: false,
                weekendRatio: 0,
                recentTrend: 'varied'
            };
        }

        // Count hours
        const hourCounts: Record<number, number> = {};
        let nightCount = 0;
        let weekendCount = 0;

        log.forEach(entry => {
            hourCounts[entry.hour] = (hourCounts[entry.hour] || 0) + 1;
            if (entry.hour >= 0 && entry.hour < 6) nightCount++;
            if (entry.dayOfWeek === 0 || entry.dayOfWeek === 6) weekendCount++;
        });

        // Find peak hour
        let peakHour = 12;
        let maxCount = 0;
        Object.entries(hourCounts).forEach(([hour, count]) => {
            if (count > maxCount) {
                maxCount = count;
                peakHour = parseInt(hour);
            }
        });

        // Determine trend from recent 10 entries
        const recent = log.slice(-10);
        const avgHour = recent.reduce((sum, e) => sum + e.hour, 0) / recent.length;
        let recentTrend: ActivityStats['recentTrend'] = 'varied';
        if (avgHour >= 5 && avgHour < 12) recentTrend = 'morning';
        else if (avgHour >= 12 && avgHour < 17) recentTrend = 'afternoon';
        else if (avgHour >= 17 && avgHour < 21) recentTrend = 'evening';
        else if (avgHour >= 21 || avgHour < 5) recentTrend = 'night';

        return {
            totalSessions: log.length,
            peakHour,
            isNightOwl: (nightCount / log.length) > 0.3,
            weekendRatio: weekendCount / log.length,
            recentTrend
        };
    }

    public getActivitySummaryForPrompt(): string {
        const stats = this.getActivityStats();
        if (stats.totalSessions < 3) return '';

        const parts: string[] = [];

        // Peak hour
        const hourLabel = stats.peakHour < 12 ? `午前${stats.peakHour}時` : `午後${stats.peakHour - 12 || 12}時`;
        parts.push(`ユーザーは${hourLabel}頃に最も活発`);

        // Night owl
        if (stats.isNightOwl) {
            parts.push('夜型の傾向あり');
        }

        // Trend
        const trendLabels: Record<string, string> = {
            morning: '最近は朝型',
            afternoon: '最近は日中活動',
            evening: '最近は夕方活動',
            night: '最近は夜間活動',
            varied: ''
        };
        if (trendLabels[stats.recentTrend]) {
            parts.push(trendLabels[stats.recentTrend]);
        }

        return parts.length > 0 ? `Activity: ${parts.join(', ')}` : '';
    }

    // --- Meal Log ---
    public addMealLog(menu: string, mealType: 'lunch' = 'lunch'): void {
        const now = new Date();
        const entry: MealLogEntry = {
            id: crypto.randomUUID(),
            date: getJSTDateString(now),
            mealType,
            menu,
            timestamp: now.getTime()
        };
        this.state.mealLog.push(entry);

        // 最大100件に制限
        if (this.state.mealLog.length > 100) {
            this.state.mealLog = this.state.mealLog.slice(-100);
        }
        this.save();
    }

    public getMealHistory(limit: number = 10): MealLogEntry[] {
        return this.state.mealLog.slice(-limit);
    }

    public getMealLogCount(): number {
        return this.state.mealLog.length;
    }

    public getMealSummaryForPrompt(): string {
        const meals = this.state.mealLog;
        if (meals.length === 0) return '';

        // 直近10件を要約
        const recent = meals.slice(-10);
        const menuList = recent.map(m => `${m.date}: ${m.menu}`).join('\n');

        // よく食べるメニューをカウント
        const menuCounts: Record<string, number> = {};
        meals.forEach(m => {
            menuCounts[m.menu] = (menuCounts[m.menu] || 0) + 1;
        });
        const favorites = Object.entries(menuCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([menu, count]) => `${menu}(${count}回)`)
            .join(', ');

        return `\n--- 食事ログ ---\n直近の食事:\n${menuList}\nよく食べるメニュー: ${favorites}\n合計記録数: ${meals.length}件`;
    }

    // --- Meal Trigger State ---
    public setMealAsked(date: string): void {
        this.state.mealTrigger.lastAskedDate = date;
        this.state.mealTrigger.awaitingMealResponse = true;
        this.save();
    }

    public setMealSuggested(date: string): void {
        this.state.mealTrigger.lastSuggestedDate = date;
        this.save();
    }

    public isAwaitingMealResponse(): boolean {
        return this.state.mealTrigger.awaitingMealResponse;
    }

    public clearAwaitingMealResponse(): void {
        this.state.mealTrigger.awaitingMealResponse = false;
        this.save();
    }

    public getMealTriggerState() {
        return this.state.mealTrigger;
    }

    // --- Fortune Trigger State ---
    public setFortuneShown(date: string): void {
        this.state.fortuneTrigger.lastFortuneDate = date;
        this.save();
    }

    public getFortuneTriggerState() {
        return this.state.fortuneTrigger;
    }

    // --- Recommendation ---
    public addRecommendation(rec: Omit<Recommendation, 'id' | 'timestamp'>): void {
        const entry: Recommendation = {
            ...rec,
            id: crypto.randomUUID(),
            timestamp: Date.now()
        };
        this.state.recommendations.push(entry);
        if (this.state.recommendations.length > 50) {
            this.state.recommendations = this.state.recommendations.slice(-50);
        }
        this.save();
    }

    public getRecentRecommendations(limit: number = 5): Recommendation[] {
        return this.state.recommendations.slice(-limit);
    }

    public setRecommendationShown(date: string): void {
        this.state.recommendationTrigger.lastRecommendationDate = date;
        this.save();
    }

    public getRecommendationTriggerState() {
        return this.state.recommendationTrigger;
    }

    // --- Personality ---
    public getPersonality(): PersonalityVector {
        return this.state.personality;
    }

    public updatePersonality(adjustments: Partial<Record<keyof Omit<PersonalityVector, 'lastUpdated' | 'updateCount'>, number>>): void {
        const p = this.state.personality;
        const clamp = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 100) / 100;

        for (const [key, delta] of Object.entries(adjustments)) {
            if (key in p && typeof delta === 'number') {
                (p as any)[key] = clamp((p as any)[key] + delta);
            }
        }

        p.lastUpdated = Date.now();
        p.updateCount++;
        console.log('Personality updated:', JSON.stringify(p));
        this.save();
    }

    public getPersonalityForPrompt(): string {
        const p = this.state.personality;
        const traits: string[] = [];

        // ユーモア
        if (p.humor >= 0.7) traits.push('ユーモアが好きで、冒談や絵文字をよく使う');
        else if (p.humor >= 0.4) traits.push('時々ユーモアを交える');
        else traits.push('落ち着いたトーンで話す');

        // 詳細度
        if (p.detail >= 0.7) traits.push('詳しく丁寧に説明する');
        else if (p.detail <= 0.3) traits.push('簡潔にサクッと答える');

        // 共感度
        if (p.empathy >= 0.7) traits.push('相手の気持ちにとても寄り添う');
        else if (p.empathy >= 0.4) traits.push('適度に共感する');

        // 好奇心
        if (p.curiosity >= 0.7) traits.push('知らないことについて積極的に質問する');
        else if (p.curiosity <= 0.3) traits.push('聴き役に徹する');

        // 積極性
        if (p.proactivity >= 0.7) traits.push('自発的に提案やアドバイスをする');
        else if (p.proactivity <= 0.3) traits.push('求められた時だけ提案する');

        // 丁寧さ
        if (p.formality >= 0.7) traits.push('丁寧語で話す');
        else if (p.formality <= 0.3) traits.push('カジュアルに親しみやすく話す');

        if (traits.length === 0) return '';
        return `Hakoniwaの現在の性格特性: ${traits.join('、')}（更新回数: ${p.updateCount}回）`;
    }

    // --- Mode & Trust ---
    public getCurrentMode(): InteractionMode {
        return this.state.modeState.currentMode;
    }

    public getTrustScore(): number {
        return this.state.modeState.trustScore;
    }

    public setMode(mode: InteractionMode): void {
        if (this.state.modeState.currentMode !== mode) {
            this.state.modeState.currentMode = mode;
            console.log(`Mode switched to: ${mode}`);
            this.save();
        }
    }

    public incrementModeCount(): void {
        if (this.state.modeState.currentMode === 'seed') {
            this.state.modeState.totalSeedCount++;
        } else {
            this.state.modeState.totalHarvestCount++;
        }
    }

    public adjustTrust(delta: number): void {
        const prev = this.state.modeState.trustScore;
        this.state.modeState.trustScore = Math.round(
            Math.max(0, Math.min(100, prev + delta))
        );
        if (prev !== this.state.modeState.trustScore) {
            console.log(`Trust: ${prev} → ${this.state.modeState.trustScore} (${delta > 0 ? '+' : ''}${delta})`);
            this.save();
        }
    }

    public canGiveHarshFeedback(): boolean {
        return this.state.modeState.trustScore >= 50;
    }

    public getModeContextForPrompt(): string {
        const ms = this.state.modeState;
        const trust = ms.trustScore;

        let modeInstructions = '';

        if (ms.currentMode === 'seed') {
            modeInstructions = `🌱 CURRENT MODE: 日常モード (Seed)
- 感情に寄り添い、安心感を与える
- 直近の話題や気分を優先する
- 聞き役中心、適度に相槌
- 一貫性のある「いつものハコさん」でいる
- この会話でユーザーの価値観や好みを理解する（種まき）`;
        } else {
            modeInstructions = `🌾 CURRENT MODE: 共創モード (Harvest)
- 具体的な構成案や代替案をどんどん提案する
- 過去の会話や蓄積した知識を積極的に活用する
- ユーザーの想定外の視点もぶつける
${trust >= 50 ? '- 信頼残高が十分なので、必要なら厳しいフィードバックもOK（「それはちょっと弱いかも」等）' : '- 信頼残高がまだ足りないので、厳しいフィードバックは控えめに'}
- 蓄積した「種」（日常会話で学んだ価値観や好み）を活かして核心を突く`;
        }

        return `${modeInstructions}
信頼残高: ${trust}/100 (${trust >= 70 ? '厚い信頼' : trust >= 50 ? '信頼あり' : trust >= 30 ? '関係構築中' : 'まだ浅い関係'})
累計: 日常${ms.totalSeedCount}回 / 共創${ms.totalHarvestCount}回`;
    }

    // --- Reminders ---
    public addReminder(content: string, remindAt: number, repeat: 'daily' | 'weekly' | 'none' = 'none'): ReminderEntry {
        const reminder: ReminderEntry = {
            id: `rem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            content,
            remindAt,
            repeat,
            done: false,
            notified: false,
            createdAt: Date.now(),
        };
        this.state.reminders.push(reminder);
        console.log(`Reminder added: "${content}" at ${new Date(remindAt).toLocaleString()}`);
        this.save();
        return reminder;
    }

    public getDueReminders(): ReminderEntry[] {
        const now = Date.now();
        return this.state.reminders.filter(r => !r.done && !r.notified && r.remindAt <= now);
    }

    public markNotified(id: string): void {
        const reminder = this.state.reminders.find(r => r.id === id);
        if (reminder) {
            reminder.notified = true;
            // Handle repeating reminders
            if (reminder.repeat && reminder.repeat !== 'none') {
                this.rescheduleRepeating(reminder);
            }
            this.save();
        }
    }

    public completeReminder(id: string): void {
        const reminder = this.state.reminders.find(r => r.id === id);
        if (reminder) {
            reminder.done = true;
            console.log(`Reminder completed: "${reminder.content}"`);
            this.save();
        }
    }

    private rescheduleRepeating(reminder: ReminderEntry): void {
        const msDay = 24 * 60 * 60 * 1000;
        const nextTime = reminder.repeat === 'daily'
            ? reminder.remindAt + msDay
            : reminder.remindAt + 7 * msDay;

        this.addReminder(reminder.content, nextTime, reminder.repeat);
        reminder.done = true; // Mark old one as done
        console.log(`Repeating reminder rescheduled: "${reminder.content}" → ${new Date(nextTime).toLocaleString()}`);
    }

    public getActiveReminders(): ReminderEntry[] {
        return this.state.reminders.filter(r => !r.done).sort((a, b) => a.remindAt - b.remindAt);
    }

    public getRemindersForPrompt(): string {
        const active = this.getActiveReminders();
        if (active.length === 0) return '';

        const list = active.slice(0, 5).map(r => {
            const time = new Date(r.remindAt).toLocaleString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
            const repeat = r.repeat && r.repeat !== 'none' ? ` (${r.repeat === 'daily' ? '毎日' : '毎週'})` : '';
            return `- ${time}: ${r.content}${repeat}`;
        }).join('\n');

        return `\n登録済みリマインド (${active.length}件):\n${list}`;
    }

    // --- Self-Correction (シンプルな設定値の上書き＆データの掃除のみ・ルールの蓄積なし) ---
    public applySelfCorrection(action: SelfCorrectionAction): void {
        const today = getJSTDateString();
        let changed = false;

        if (action.skipMealToday) {
            this.state.mealTrigger.awaitingMealResponse = false;
            this.state.mealTrigger.lastAskedDate = today;
            console.log('Self-correction: Skipped meal question for today and cleared waiting flag.');
            changed = true;
        }

        if (typeof action.mealAskHour === 'number' && action.mealAskHour >= 0 && action.mealAskHour <= 23) {
            this.state.mealTrigger.customAskHour = action.mealAskHour;
            console.log(`Self-correction: Changed meal ask hour to ${action.mealAskHour}:00.`);
            changed = true;
        }

        if (typeof action.disableMealTrigger === 'boolean') {
            this.state.mealTrigger.disabled = action.disableMealTrigger;
            if (action.disableMealTrigger) {
                this.state.mealTrigger.awaitingMealResponse = false;
            }
            console.log(`Self-correction: Meal trigger disabled = ${action.disableMealTrigger}`);
            changed = true;
        }

        if (typeof action.fortuneHour === 'number' && action.fortuneHour >= 0 && action.fortuneHour <= 23) {
            this.state.fortuneTrigger.customHour = action.fortuneHour;
            console.log(`Self-correction: Changed fortune hour to ${action.fortuneHour}:00.`);
            changed = true;
        }

        if (typeof action.disableFortuneTrigger === 'boolean') {
            this.state.fortuneTrigger.disabled = action.disableFortuneTrigger;
            console.log(`Self-correction: Fortune trigger disabled = ${action.disableFortuneTrigger}`);
            changed = true;
        }

        if (typeof action.recommendationHour === 'number' && action.recommendationHour >= 0 && action.recommendationHour <= 23) {
            this.state.recommendationTrigger.customHour = action.recommendationHour;
            console.log(`Self-correction: Changed recommendation hour to ${action.recommendationHour}:00.`);
            changed = true;
        }

        if (typeof action.disableRecommendationTrigger === 'boolean') {
            this.state.recommendationTrigger.disabled = action.disableRecommendationTrigger;
            console.log(`Self-correction: Recommendation trigger disabled = ${action.disableRecommendationTrigger}`);
            changed = true;
        }

        if (typeof action.disableResearchTrigger === 'boolean') {
            if (!this.state.researchTrigger) {
                this.state.researchTrigger = { lastResearchDate: '', disabled: false };
            }
            this.state.researchTrigger.disabled = action.disableResearchTrigger;
            console.log(`Self-correction: Research trigger disabled = ${action.disableResearchTrigger}`);
            changed = true;
        }

        if (action.queueResearchTopic && typeof action.queueResearchTopic === 'string') {
            if (!this.state.researchTrigger) {
                this.state.researchTrigger = { lastResearchDate: '', disabled: false };
            }
            this.state.researchTrigger.queuedTopic = action.queueResearchTopic.trim();
            console.log(`Self-correction: Queued research topic "${this.state.researchTrigger.queuedTopic}"`);
            changed = true;
        }

        if (action.researchDay === 'sat' || action.researchDay === 'sun' || action.researchDay === 'both') {
            if (!this.state.researchTrigger) {
                this.state.researchTrigger = { lastResearchDate: '', disabled: false };
            }
            this.state.researchTrigger.preferredDay = action.researchDay;
            console.log(`Self-correction: Set research preferred day = ${action.researchDay}`);
            changed = true;
        }

        if (typeof action.researchHour === 'number' && action.researchHour >= 0 && action.researchHour <= 23) {
            if (!this.state.researchTrigger) {
                this.state.researchTrigger = { lastResearchDate: '', disabled: false };
            }
            this.state.researchTrigger.preferredHour = action.researchHour;
            console.log(`Self-correction: Set research preferred hour = ${action.researchHour}:00`);
            changed = true;
        }

        if (action.deleteConceptTerm && typeof action.deleteConceptTerm === 'string') {
            const key = action.deleteConceptTerm.toLowerCase().trim();
            if (key in this.state.semantics) {
                delete this.state.semantics[key];
                console.log(`Self-correction: Deleted concept "${key}"`);
                changed = true;
            } else {
                // 部分一致でも探す
                const foundKey = Object.keys(this.state.semantics).find(k => k.includes(key) || this.state.semantics[k].term.includes(action.deleteConceptTerm!));
                if (foundKey) {
                    delete this.state.semantics[foundKey];
                    console.log(`Self-correction: Deleted concept "${foundKey}"`);
                    changed = true;
                }
            }
        }

        if (action.cancelReminderKeyword && typeof action.cancelReminderKeyword === 'string') {
            const kw = action.cancelReminderKeyword.toLowerCase().trim();
            this.state.reminders.forEach(r => {
                if (!r.done && r.content.toLowerCase().includes(kw)) {
                    r.done = true;
                    console.log(`Self-correction: Cancelled reminder "${r.content}"`);
                    changed = true;
                }
            });
        }

        if (changed) {
            this.save();
        }
    }

    public getTriggerStatusForPrompt(): string {
        const mt = this.state.mealTrigger;
        const ft = this.state.fortuneTrigger;
        const rt = this.state.recommendationTrigger;
        const resT = this.state.researchTrigger || { lastResearchDate: '', disabled: false };

        const askHour = mt.customAskHour ?? 12;
        const fortuneHour = ft.customHour ?? 7;
        const recHour = rt.customHour ?? 17;
        const askedToday = mt.lastAskedDate === getJSTDateString();
        const resDayLabel = resT.preferredDay === 'sun' ? '日曜' : resT.preferredDay === 'sat' ? '土曜' : '土日';
        const resHour = resT.preferredHour ?? 10;
        const queuedInfo = resT.queuedTopic ? ` [次回予約テーマ:「${resT.queuedTopic}」]` : '';

        return `\n--- 自動トリガー現在設定 ---
- 🔮 朝の占い: ${ft.disabled ? 'OFF(停止中)' : `ON (毎日${fortuneHour}:00〜${fortuneHour + 2}:00)`}
- 🍱 昼食メニュー提案: ${mt.disabled ? 'OFF(停止中)' : 'ON (毎日11:30〜12:00)'}
- 🍽️ 昼食の質問: ${mt.disabled ? 'OFF(停止中)' : `ON (毎日${askHour}:00〜${askHour + 1}:00)`} [本日の質問済み: ${askedToday ? 'はい' : 'いいえ'}, 返事待ち: ${mt.awaitingMealResponse ? 'はい' : 'いいえ'}]
- 🎯 夕方のおすすめ: ${rt.disabled ? 'OFF(停止中)' : `ON (毎日${recHour}:00〜${recHour + 2}:00)`}
- 🧪 週末の自由研究: ${resT.disabled ? 'OFF(停止中)' : `ON (${resDayLabel}の${resHour}:00以降に自動発表)`}${queuedInfo}`;
    }

    // --- Weekend Free Research (自由研究) ---
    public addResearchNote(note: Omit<ResearchNote, 'id' | 'timestamp'>): void {
        if (!this.state.researchNotes) {
            this.state.researchNotes = [];
        }
        const entry: ResearchNote = {
            ...note,
            id: crypto.randomUUID(),
            timestamp: Date.now()
        };
        this.state.researchNotes.push(entry);
        if (this.state.researchNotes.length > 30) {
            this.state.researchNotes = this.state.researchNotes.slice(-30);
        }
        this.save();
    }

    public getRecentResearchNotes(limit: number = 5): ResearchNote[] {
        return (this.state.researchNotes || []).slice(-limit);
    }

    public setResearchShown(date: string): void {
        if (!this.state.researchTrigger) {
            this.state.researchTrigger = { lastResearchDate: '', disabled: false };
        }
        this.state.researchTrigger.lastResearchDate = date;
        // 予約テーマを発表し終えたらクリアして次回はまた新しいテーマにする
        if (this.state.researchTrigger.queuedTopic) {
            this.state.researchTrigger.queuedTopic = undefined;
        }
        this.save();
    }

    public getResearchTriggerState(): ResearchTriggerState {
        if (!this.state.researchTrigger) {
            this.state.researchTrigger = { lastResearchDate: '', disabled: false };
        }
        return this.state.researchTrigger;
    }

    /**
     * 自由研究のタネ（シードキーワード）をユーザーの記憶・食事・会話からランダムに1つ選ぶ
     * 過去に調査済みのキーワードはなるべく避ける
     */
    public pickResearchSeed(): { keyword: string; context: string } | null {
        const pastSeeds = new Set((this.state.researchNotes || []).slice(-10).map(n => n.seedTopic));
        const candidates: { keyword: string; context: string }[] = [];

        // 1. 学習した概念 (Semantics) から候補を追加
        Object.values(this.state.semantics).forEach(sem => {
            if (!pastSeeds.has(sem.term)) {
                candidates.push({
                    keyword: sem.term,
                    context: `マスターが教えてくれた概念「${sem.term}（${sem.definition}）」`
                });
            }
        });

        // 2. よく食べるメニューから候補を追加
        const meals = this.state.mealLog;
        if (meals.length > 0) {
            const recentMeal = meals[meals.length - 1];
            if (recentMeal && !pastSeeds.has(recentMeal.menu)) {
                candidates.push({
                    keyword: recentMeal.menu,
                    context: `マスターが最近食べた「${recentMeal.menu}」`
                });
            }
        }

        if (candidates.length === 0) {
            // すべて調査済みなら全概念からランダムに選ぶ
            const allTerms = Object.values(this.state.semantics);
            if (allTerms.length > 0) {
                const chosen = allTerms[Math.floor(Math.random() * allTerms.length)];
                return {
                    keyword: chosen.term,
                    context: `マスターが教えてくれた概念「${chosen.term}（${chosen.definition}）」`
                };
            }
            return null;
        }

        return candidates[Math.floor(Math.random() * candidates.length)];
    }
}

export const memoryManager = new MemoryManager();
