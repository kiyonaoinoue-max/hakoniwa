// サーバーサイド用 型定義
// src/ai/types.ts からコピー

export type Timestamp = number; // Unix timestamp

export interface EpisodicMemory {
    id: string;
    timestamp: Timestamp;
    speaker: 'user' | 'ai';
    content: string;
    emotion?: string;
}

export interface Semantics {
    term: string;
    definition: string;
    relatedTerms: string[];
    lastUpdated: Timestamp;
    confidence: number;
}

export interface UserPattern {
    name: string;
    dataPoints: Timestamp[];
    inferredRanges: string[];
}

export interface ActivityLogEntry {
    date: string;
    hour: number;
    dayOfWeek: number;
}

export interface ActivityStats {
    totalSessions: number;
    peakHour: number;
    isNightOwl: boolean;
    weekendRatio: number;
    recentTrend: 'morning' | 'afternoon' | 'evening' | 'night' | 'varied';
}

export interface MealLogEntry {
    id: string;
    date: string;
    mealType: 'lunch';
    menu: string;
    timestamp: Timestamp;
}

export interface MealTriggerState {
    lastAskedDate: string;
    lastSuggestedDate: string;
    awaitingMealResponse: boolean;
}

export interface FortuneTriggerState {
    lastFortuneDate: string;
}

export interface Recommendation {
    id: string;
    date: string;
    type: 'activity' | 'food' | 'music' | 'general';
    content: string;
    reason: string;
    basedOn: string[];
    timestamp: Timestamp;
}

export interface RecommendationTriggerState {
    lastRecommendationDate: string;
}

export interface PersonalityVector {
    humor: number;
    detail: number;
    empathy: number;
    curiosity: number;
    proactivity: number;
    formality: number;
    lastUpdated: Timestamp;
    updateCount: number;
}

export type InteractionMode = 'seed' | 'harvest';

export interface ModeState {
    currentMode: InteractionMode;
    trustScore: number;
    totalSeedCount: number;
    totalHarvestCount: number;
}

export interface ReminderEntry {
    id: string;
    content: string;
    remindAt: Timestamp;
    repeat: 'daily' | 'weekly' | 'none';
    done: boolean;
    notified: boolean;
    createdAt: Timestamp;
}

export interface BrainState {
    episodes: EpisodicMemory[];
    semantics: Record<string, Semantics>;
    currentEmotion?: string;
    currentIntensity?: number;
    userModel: {
        patterns: Record<string, UserPattern>;
    };
    activityLog: ActivityLogEntry[];
    mealLog: MealLogEntry[];
    mealTrigger: MealTriggerState;
    fortuneTrigger: FortuneTriggerState;
    recommendations: Recommendation[];
    recommendationTrigger: RecommendationTriggerState;
    personality: PersonalityVector;
    modeState: ModeState;
    reminders: ReminderEntry[];
}
