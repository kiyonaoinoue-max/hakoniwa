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
  customAskHour?: number;    // ユーザー指定の昼食質問時間 (デフォルト12)
  disabled?: boolean;        // 食事トリガーの一時停止フラグ
}

export interface FortuneTriggerState {
  lastFortuneDate: string;  // 最後に占いを出した日付 (YYYY-MM-DD)
  customHour?: number;      // ユーザー指定の占い開始時間 (デフォルト7)
  disabled?: boolean;       // 占いトリガーの一時停止フラグ
}

export interface SelfCorrectionAction {
  skipMealToday?: boolean;                   // 「今日はもう昼ご飯聞かないで」→ 本日の昼食質問を済みにして返事待ちも解除
  mealAskHour?: number | null;               // 「昼ご飯は○時に聞いて」→ 聞く時間の変更 (0-23、上書きのみ)
  disableMealTrigger?: boolean | null;       // 「昼ご飯の質問を止めて/再開して」→ ON/OFF切り替え
  fortuneHour?: number | null;               // 「占いは○時にして」→ 占い時間の変更 (0-23)
  disableFortuneTrigger?: boolean | null;    // 「朝の占いを止めて/再開して」→ ON/OFF切り替え
  recommendationHour?: number | null;        // 「おすすめは○時にして」→ 夕方おすすめ時間の変更 (0-23)
  disableRecommendationTrigger?: boolean | null; // 「夕方のおすすめを止めて/再開して」→ ON/OFF切り替え
  disableResearchTrigger?: boolean | null;   // 「週末の自由研究を止めて/再開して」→ ON/OFF切り替え
  queueResearchTopic?: string | null;        // 「週末に〇〇について調べて」→ 週末自由研究の宿題テーマを予約
  researchDay?: 'sat' | 'sun' | 'both' | null; // 「日曜に発表して」→ 自由研究の発表曜日指定 ('sat'=土曜, 'sun'=日曜, 'both'=土日)
  researchHour?: number | null;              // 「日曜の夜(19時)に発表して」→ 自由研究の発表開始時間 (0-23)
  deleteConceptTerm?: string | null;         // 「〇〇の記憶は消して/間違ってる」→ 誤学習した概念(Memory)の削除
  cancelReminderKeyword?: string | null;     // 「〇〇のリマインドは消して/キャンセルして」→ リマインド削除
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
  customHour?: number;            // ユーザー指定のおすすめ開始時間 (デフォルト17)
  disabled?: boolean;             // おすすめトリガーの一時停止フラグ
}

export interface ResearchNote {
  id: string;
  date: string;               // YYYY-MM-DD
  seedTopic: string;          // きっかけになったユーザーの記憶・言葉（またはランダム）
  wikiTitle: string;          // 調査したWikipedia記事タイトル / Webトピック
  wikiUrl?: string;           // 参照URL
  summary: string;            // ハコさんの自由研究レポート本文
  timestamp: number;
}

export interface ResearchTriggerState {
  lastResearchDate: string;   // 最後に週末自由研究を発表した日付 (YYYY-MM-DD)
  disabled?: boolean;         // 自由研究トリガーの一時停止フラグ
  queuedTopic?: string;       // ユーザーから予約された宿題テーマ（例：「金相場の年末年始の動向」）
  preferredDay?: 'sat' | 'sun' | 'both'; // 発表する曜日 ('sat'=土曜, 'sun'=日曜, 'both'=土日どちらでも)
  preferredHour?: number;     // 発表する開始時刻 (デフォルト10、夜指定なら19など)
}

export interface CuriosityTriggerState {
  lastCuriosityDate: string; // 最後に質問・学びメッセージを出した日付 (YYYY-MM-DD)
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
  researchNotes?: ResearchNote[];
  researchTrigger?: ResearchTriggerState;
  curiosityTrigger?: CuriosityTriggerState;
  personality: PersonalityVector;
  modeState: ModeState;
  reminders: ReminderEntry[];
  currentEmotion?: string;
  currentIntensity?: number;
  currentLocation?: string;
}
