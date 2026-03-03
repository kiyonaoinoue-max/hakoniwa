export type Timestamp = number; // Unix timestamp

export interface EpisodicMemory {
  id: string;
  timestamp: Timestamp;
  speaker: 'user' | 'ai';
  content: string;
  emotion?: string; // Simple emotion tag
}

export interface Semantics {
  term: string;
  definition: string;
  relatedTerms: string[];
  lastUpdated: Timestamp;
  confidence: number; // 0-1, how sure the AI is about this meaning
}

export interface UserPattern {
  name: string;
  dataPoints: number[]; // Array of timestamps for specific activity (e.g. "morning_greet")
  inferredRanges: { start: number; end: number }[]; // Inferred time ranges (0-24 hour format)
}

export interface ActivityLogEntry {
  date: string; // YYYY-MM-DD
  hour: number; // 0-23
  dayOfWeek: number; // 0=Sunday, 6=Saturday
}

export interface ActivityStats {
  totalSessions: number;
  peakHour: number;
  isNightOwl: boolean; // Active between 0-5 AM frequently
  weekendRatio: number; // 0-1, how often active on weekends
  recentTrend: 'morning' | 'afternoon' | 'evening' | 'night' | 'varied';
}

export interface MealLogEntry {
  id: string;
  date: string;       // YYYY-MM-DD
  mealType: 'lunch';  // 将来的に 'breakfast' | 'dinner' も追加可能
  menu: string;       // ユーザーが回答したメニュー
  timestamp: number;   // Unix timestamp
}

export interface MealTriggerState {
  lastAskedDate: string;    // 最後に食事を聞いた日付 (YYYY-MM-DD)
  lastSuggestedDate: string; // 最後に提案をした日付 (YYYY-MM-DD)
  awaitingMealResponse: boolean; // 食事の質問への回答を待っている状態
}

export interface FortuneTriggerState {
  lastFortuneDate: string;  // 最後に占いを出した日付 (YYYY-MM-DD)
}

export interface Recommendation {
  id: string;
  date: string;               // YYYY-MM-DD
  type: 'activity' | 'food' | 'music' | 'general';
  content: string;            // おすすめ内容
  reason: string;             // なぜこれをおすすめしたか
  basedOn: string[];          // ["weather", "mood", "pattern"]
  timestamp: number;
}

export interface RecommendationTriggerState {
  lastRecommendationDate: string; // 最後におすすめを出した日付 (YYYY-MM-DD)
}

export interface PersonalityVector {
  humor: number;        // 0.0-1.0 ユーモア度
  detail: number;       // 0.0-1.0 詳細度
  empathy: number;      // 0.0-1.0 共感度
  curiosity: number;    // 0.0-1.0 好奇心
  proactivity: number;  // 0.0-1.0 積極性
  formality: number;    // 0.0-1.0 丁寧さ
  lastUpdated: number;  // timestamp
  updateCount: number;  // 総更新回数
}

export type InteractionMode = 'seed' | 'harvest'; // 日常 | 共創

export interface ModeState {
  currentMode: InteractionMode;
  trustScore: number;        // 0-100
  totalSeedCount: number;    // 日常モードの累計会話数
  totalHarvestCount: number; // 共創モードの累計会話数
}

export interface ReminderEntry {
  id: string;
  content: string;           // リマインド内容
  remindAt: number;          // リマインド時刻 (Unix timestamp)
  repeat?: 'daily' | 'weekly' | 'none'; // 繰り返し
  done: boolean;             // 完了フラグ
  notified: boolean;         // 通知済みフラグ
  createdAt: number;         // 作成時刻
}

export interface BrainState {
  episodes: EpisodicMemory[];
  semantics: Record<string, Semantics>;
  userModel: {
    patterns: Record<string, UserPattern>; // e.g., 'wake_up_time', 'work_time'
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
  currentEmotion?: string;
  currentIntensity?: number;
}
