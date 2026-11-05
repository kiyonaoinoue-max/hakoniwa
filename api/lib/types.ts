// サーバーサイド用 型定義
// src/ai/types.ts と完全同期

export type Timestamp = number; // Unix timestamp

export interface EpisodicMemory {
    id: string;
    timestamp: Timestamp;
    speaker: 'user' | 'ai';
    content: string;
    emotion?: string;
    imageUrl?: string;
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
    inferredRanges: { start: number; end: number }[] | string[];
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
    customAskHour?: number;
    disabled?: boolean;
}

export interface FortuneTriggerState {
    lastFortuneDate: string;
    customHour?: number;
    disabled?: boolean;
}

export interface SelfCorrectionAction {
    skipMealToday?: boolean;
    mealAskHour?: number | null;
    disableMealTrigger?: boolean | null;
    fortuneHour?: number | null;
    disableFortuneTrigger?: boolean | null;
    recommendationHour?: number | null;
    disableRecommendationTrigger?: boolean | null;
    disableResearchTrigger?: boolean | null;
    queueResearchTopic?: string | null;
    researchDay?: 'sat' | 'sun' | 'both' | null;
    researchHour?: number | null;
    deleteConceptTerm?: string | null;
    cancelReminderKeyword?: string | null;
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
    customHour?: number;
    disabled?: boolean;
}

export interface ResearchNote {
    id: string;
    date: string;
    seedTopic: string;
    wikiTitle: string;
    wikiUrl?: string;
    summary: string;
    timestamp: number;
}

export interface ResearchTriggerState {
    lastResearchDate: string;
    disabled?: boolean;
    queuedTopic?: string;
    preferredDay?: 'sat' | 'sun' | 'both';
    preferredHour?: number;
}

export interface CuriosityTriggerState {
    lastCuriosityDate: string;
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
    repeat?: 'daily' | 'weekly' | 'none';
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
    researchNotes?: ResearchNote[];
    researchTrigger?: ResearchTriggerState;
    curiosityTrigger?: CuriosityTriggerState;
    personality: PersonalityVector;
    modeState: ModeState;
    reminders: ReminderEntry[];
    currentLocation?: string;
}
