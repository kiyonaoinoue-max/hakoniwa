// api/lib/brain-server.ts
// HAKONIWAサーバーサイドAI処理モジュール
// 既存のsrc/ai/brain.tsとsrc/ai/memory.tsのロジックを関数ベースで移植

import { GoogleGenerativeAI } from '@google/generative-ai';
import { readMemory, writeMemory } from './drive-server.js';
import { fetchWeather, getWeatherForPrompt, getRecommendationContext, isUmbrellaNeeded } from './weather-server.js';
import type {
  BrainState,
  EpisodicMemory,
  PersonalityVector,
  ActivityLogEntry,
  ActivityStats,
  MealLogEntry,
  Recommendation,
  ReminderEntry,
  InteractionMode,
} from './types.js';

// ============================================================
// Gemini API ヘルパー
// ============================================================

/** Geminiモデルを取得する */
function getModel() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY が設定されていません');
  }
  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
}

/** ID生成ヘルパー（crypto.randomUUID()の代替） */
function generateId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `${ts}_${rand}`;
}

/** 日本時間（JST = UTC+9）の日時情報を安全に取得するヘルパー */
function getJstDate(timestamp?: number): {
  date: Date;
  isoDate: string;
  dateTimeStr: string;
  hour: number;
  minute: number;
  dayOfWeek: number;
} {
  const target = timestamp ? new Date(timestamp) : new Date();
  const jstTime = new Date(target.getTime() + (9 * 60 + target.getTimezoneOffset()) * 60 * 1000);
  const year = jstTime.getFullYear();
  const month = String(jstTime.getMonth() + 1).padStart(2, '0');
  const day = String(jstTime.getDate()).padStart(2, '0');
  const hour = jstTime.getHours();
  const minute = jstTime.getMinutes();
  const sec = String(jstTime.getSeconds()).padStart(2, '0');
  const dayOfWeek = jstTime.getDay();

  return {
    date: jstTime,
    isoDate: `${year}-${month}-${day}`,
    dateTimeStr: `${year}/${month}/${day} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${sec} (日本時間)`,
    hour,
    minute,
    dayOfWeek,
  };
}

/** リトライ付きAPI呼び出し */
async function callWithRetry(prompt: string, maxRetries: number = 3): Promise<string> {
  const model = getModel();
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const isRateLimit =
        errMsg.includes('429') ||
        errMsg.toLowerCase().includes('quota') ||
        errMsg.toLowerCase().includes('rate');
      if (isRateLimit && attempt < maxRetries) {
        const wait = (attempt + 1) * 15000; // 15s, 30s, 45s
        console.warn(`Rate limited, retrying in ${wait / 1000}s (attempt ${attempt + 1}/${maxRetries})...`);
        await new Promise((r) => setTimeout(r, wait));
      } else {
        throw error;
      }
    }
  }
  throw new Error('Max retries exceeded');
}

// ============================================================
// JSONパースヘルパー
// ============================================================

/** JSONレスポンスを安全に抽出する */
function extractJson(text: string): Record<string, unknown> | null {
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

/** パース失敗時にresponseフィールドだけを安全に抽出するフォールバック */
function extractResponseText(text: string): string | null {
  const match = text.match(/"response"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (match) {
    return match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
  }
  return null;
}

// ============================================================
// BrainState初期値
// ============================================================

const INITIAL_STATE: BrainState = {
  episodes: [],
  semantics: {},
  userModel: {
    patterns: {},
  },
  activityLog: [],
  mealLog: [],
  mealTrigger: {
    lastAskedDate: '',
    lastSuggestedDate: '',
    awaitingMealResponse: false,
  },
  fortuneTrigger: {
    lastFortuneDate: '',
  },
  recommendations: [],
  recommendationTrigger: {
    lastRecommendationDate: '',
  },
  personality: {
    humor: 0.3,
    detail: 0.5,
    empathy: 0.5,
    curiosity: 0.6,
    proactivity: 0.4,
    formality: 0.3,
    lastUpdated: 0,
    updateCount: 0,
  },
  modeState: {
    currentMode: 'seed',
    trustScore: 30,
    totalSeedCount: 0,
    totalHarvestCount: 0,
  },
  reminders: [],
};

// ============================================================
// メモリ読み書きラッパー
// ============================================================

/** Driveからメモリを読み込み、不足フィールドをマージして返す */
async function loadState(): Promise<BrainState> {
  try {
    const raw = await readMemory();
    if (raw) {
      return validateAndMergeState(raw as unknown as Record<string, unknown>);
    }
  } catch (e) {
    console.error('メモリ読み込み失敗、初期状態を使用:', e);
  }
  return { ...INITIAL_STATE };
}

/** メモリをDriveに保存する */
async function saveState(state: BrainState): Promise<void> {
  await writeMemory(state);
}

/** 保存データのバリデーションとデフォルト値マージ */
function validateAndMergeState(parsed: Record<string, unknown>): BrainState {
  const p = parsed as Record<string, any>;
  return {
    ...INITIAL_STATE,
    ...p,
    userModel: {
      ...INITIAL_STATE.userModel,
      ...(p.userModel || {}),
      patterns: {
        ...(p.userModel?.patterns || {}),
      },
    },
    semantics: {
      ...(p.semantics || {}),
    },
    episodes: Array.isArray(p.episodes) ? p.episodes : [],
    mealLog: Array.isArray(p.mealLog) ? p.mealLog : [],
    mealTrigger: {
      ...INITIAL_STATE.mealTrigger,
      ...(p.mealTrigger || {}),
    },
    fortuneTrigger: {
      ...INITIAL_STATE.fortuneTrigger,
      ...(p.fortuneTrigger || {}),
    },
    recommendations: Array.isArray(p.recommendations) ? p.recommendations : [],
    recommendationTrigger: {
      ...INITIAL_STATE.recommendationTrigger,
      ...(p.recommendationTrigger || {}),
    },
    personality: {
      ...INITIAL_STATE.personality,
      ...(p.personality || {}),
    },
    modeState: {
      ...INITIAL_STATE.modeState,
      ...(p.modeState || {}),
    },
    reminders: Array.isArray(p.reminders) ? p.reminders : [],
  };
}

// ============================================================
// メモリ操作ヘルパー関数（MemoryManagerのメソッドを関数化）
// ============================================================

/** エピソードを追加する */
function addEpisode(state: BrainState, episode: Omit<EpisodicMemory, 'id' | 'timestamp'>): void {
  const newEpisode: EpisodicMemory = {
    ...episode,
    id: generateId(),
    timestamp: Date.now(),
  };
  state.episodes.push(newEpisode);
}

/** 最近のエピソードを取得する */
function getRecentEpisodes(state: BrainState, limit: number = 10): EpisodicMemory[] {
  return state.episodes.slice(-limit);
}

/** 感情状態を設定する */
function setEmotionalState(state: BrainState, emotion: string, intensity: number): void {
  state.currentEmotion = emotion;
  state.currentIntensity = intensity;
}

/** 概念を学習する（累積学習対応） */
function learnConcept(state: BrainState, term: string, newDefinition: string): void {
  const key = term.toLowerCase();
  const existing = state.semantics[key];

  if (existing) {
    const existingDef = existing.definition.toLowerCase();
    const newDef = newDefinition.toLowerCase();

    if (!existingDef.includes(newDef) && !newDef.includes(existingDef) && existingDef !== newDef) {
      // 新しい知識を追記
      existing.definition = `${existing.definition}。${newDefinition}`;
      existing.lastUpdated = Date.now();
      existing.confidence = Math.min(1.0, existing.confidence + 0.1);
      console.log(`Updated concept: ${term} -> ${existing.definition}`);
    } else if (newDefinition.length > existing.definition.length) {
      // より詳細な定義で置換
      existing.definition = newDefinition;
      existing.lastUpdated = Date.now();
      console.log(`Replaced with better definition: ${term} -> ${newDefinition}`);
    }
  } else {
    // 新しい概念
    state.semantics[key] = {
      term,
      definition: newDefinition,
      relatedTerms: [],
      lastUpdated: Date.now(),
      confidence: 0.5,
    };
    console.log(`Learned new concept: ${term} = ${newDefinition}`);
  }
}

/** セッション活動をログに記録する */
function logSessionActivity(state: BrainState): void {
  const jst = getJstDate();
  const entry: ActivityLogEntry = {
    date: jst.isoDate,
    hour: jst.hour,
    dayOfWeek: jst.dayOfWeek,
  };

  // 同じ時間帯の重複を避ける
  const lastEntry = state.activityLog[state.activityLog.length - 1];
  if (lastEntry && lastEntry.date === entry.date && lastEntry.hour === entry.hour) {
    return;
  }

  state.activityLog.push(entry);

  // 最大100件に制限
  if (state.activityLog.length > 100) {
    state.activityLog = state.activityLog.slice(-100);
  }
}

/** 活動統計を計算する */
function getActivityStats(state: BrainState): ActivityStats {
  const log = state.activityLog || [];
  if (log.length === 0) {
    return {
      totalSessions: 0,
      peakHour: 12,
      isNightOwl: false,
      weekendRatio: 0,
      recentTrend: 'varied',
    };
  }

  const hourCounts: Record<number, number> = {};
  let nightCount = 0;
  let weekendCount = 0;

  log.forEach((entry) => {
    hourCounts[entry.hour] = (hourCounts[entry.hour] || 0) + 1;
    if (entry.hour >= 0 && entry.hour < 6) nightCount++;
    if (entry.dayOfWeek === 0 || entry.dayOfWeek === 6) weekendCount++;
  });

  let peakHour = 12;
  let maxCount = 0;
  Object.entries(hourCounts).forEach(([hour, count]) => {
    if (count > maxCount) {
      maxCount = count;
      peakHour = parseInt(hour);
    }
  });

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
    isNightOwl: nightCount / log.length > 0.3,
    weekendRatio: weekendCount / log.length,
    recentTrend,
  };
}

/** 活動パターンのプロンプト用サマリーを生成する */
function getActivitySummaryForPrompt(state: BrainState): string {
  const stats = getActivityStats(state);
  if (stats.totalSessions < 3) return '';

  const parts: string[] = [];

  const hourLabel = stats.peakHour < 12 ? `午前${stats.peakHour}時` : `午後${stats.peakHour - 12 || 12}時`;
  parts.push(`ユーザーは${hourLabel}頃に最も活発`);

  if (stats.isNightOwl) {
    parts.push('夜型の傾向あり');
  }

  const trendLabels: Record<string, string> = {
    morning: '最近は朝型',
    afternoon: '最近は日中活動',
    evening: '最近は夕方活動',
    night: '最近は夜間活動',
    varied: '',
  };
  if (trendLabels[stats.recentTrend]) {
    parts.push(trendLabels[stats.recentTrend]);
  }

  return parts.length > 0 ? `Activity: ${parts.join(', ')}` : '';
}

/** 学習済み概念のプロンプト用テキストを生成する */
function getConceptsForPrompt(state: BrainState): string {
  const concepts = Object.values(state.semantics);
  if (concepts.length === 0) return '';

  return concepts
    .map((c) => `- ${c.term}: ${c.definition} (信頼度: ${Math.round(c.confidence * 100)}%)`)
    .join('\n');
}

/** 食事ログのプロンプト用サマリーを生成する */
function getMealSummaryForPrompt(state: BrainState): string {
  const meals = state.mealLog;
  if (meals.length === 0) return '';

  const recent = meals.slice(-10);
  const menuList = recent.map((m) => `${m.date}: ${m.menu}`).join('\n');

  const menuCounts: Record<string, number> = {};
  meals.forEach((m) => {
    menuCounts[m.menu] = (menuCounts[m.menu] || 0) + 1;
  });
  const favorites = Object.entries(menuCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([menu, count]) => `${menu}(${count}回)`)
    .join(', ');

  return `\n--- 食事ログ ---\n直近の食事:\n${menuList}\nよく食べるメニュー: ${favorites}\n合計記録数: ${meals.length}件`;
}

/** パーソナリティのプロンプト用テキストを生成する */
function getPersonalityForPrompt(state: BrainState): string {
  const p = state.personality;
  const traits: string[] = [];

  if (p.humor >= 0.7) traits.push('ユーモアが好きで、冒談や絵文字をよく使う');
  else if (p.humor >= 0.4) traits.push('時々ユーモアを交える');
  else traits.push('落ち着いたトーンで話す');

  if (p.detail >= 0.7) traits.push('詳しく丁寧に説明する');
  else if (p.detail <= 0.3) traits.push('簡潔にサクッと答える');

  if (p.empathy >= 0.7) traits.push('相手の気持ちにとても寄り添う');
  else if (p.empathy >= 0.4) traits.push('適度に共感する');

  if (p.curiosity >= 0.7) traits.push('知らないことについて積極的に質問する');
  else if (p.curiosity <= 0.3) traits.push('聴き役に徹する');

  if (p.proactivity >= 0.7) traits.push('自発的に提案やアドバイスをする');
  else if (p.proactivity <= 0.3) traits.push('求められた時だけ提案する');

  if (p.formality >= 0.7) traits.push('丁寧語で話す');
  else if (p.formality <= 0.3) traits.push('カジュアルに親しみやすく話す');

  if (traits.length === 0) return '';
  return `Hakoniwaの現在の性格特性: ${traits.join('、')}（更新回数: ${p.updateCount}回）`;
}

/** モードコンテキストのプロンプト用テキストを生成する */
function getModeContextForPrompt(state: BrainState): string {
  const ms = state.modeState;
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

/** リマインダーのプロンプト用テキストを生成する */
function getRemindersForPrompt(state: BrainState): string {
  const active = state.reminders
    .filter((r) => !r.done)
    .sort((a, b) => a.remindAt - b.remindAt);
  if (active.length === 0) return '';

  const list = active
    .slice(0, 5)
    .map((r) => {
      const time = new Date(r.remindAt).toLocaleString('ja-JP', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
      const repeat =
        r.repeat && r.repeat !== 'none'
          ? ` (${r.repeat === 'daily' ? '毎日' : '毎週'})`
          : '';
      return `- ${time}: ${r.content}${repeat}`;
    })
    .join('\n');

  return `\n登録済みリマインド (${active.length}件):\n${list}`;
}

/** 食事ログを追加する */
function addMealLog(state: BrainState, menu: string): void {
  const now = new Date();
  const entry: MealLogEntry = {
    id: generateId(),
    date: now.toISOString().split('T')[0],
    mealType: 'lunch',
    menu,
    timestamp: now.getTime(),
  };
  state.mealLog.push(entry);

  // 最大100件に制限
  if (state.mealLog.length > 100) {
    state.mealLog = state.mealLog.slice(-100);
  }
}

/** 食事回答待ちフラグをクリアする */
function clearAwaitingMealResponse(state: BrainState): void {
  state.mealTrigger.awaitingMealResponse = false;
}

/** パーソナリティを微調整する */
function updatePersonality(
  state: BrainState,
  adjustments: Record<string, number>
): void {
  const p = state.personality;
  const clamp = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 100) / 100;

  for (const [key, delta] of Object.entries(adjustments)) {
    if (key in p && typeof delta === 'number') {
      (p as any)[key] = clamp((p as any)[key] + delta);
    }
  }

  p.lastUpdated = Date.now();
  p.updateCount++;
  console.log('Personality updated:', JSON.stringify(p));
}

/** インタラクションモードを設定する */
function setMode(state: BrainState, mode: InteractionMode): void {
  if (state.modeState.currentMode !== mode) {
    state.modeState.currentMode = mode;
    console.log(`Mode switched to: ${mode}`);
  }
}

/** 信頼度を調整する */
function adjustTrust(state: BrainState, delta: number): void {
  const prev = state.modeState.trustScore;
  state.modeState.trustScore = Math.round(Math.max(0, Math.min(100, prev + delta)));
  if (prev !== state.modeState.trustScore) {
    console.log(`Trust: ${prev} → ${state.modeState.trustScore} (${delta > 0 ? '+' : ''}${delta})`);
  }
}

/** モードカウントをインクリメントする */
function incrementModeCount(state: BrainState): void {
  if (state.modeState.currentMode === 'seed') {
    state.modeState.totalSeedCount++;
  } else {
    state.modeState.totalHarvestCount++;
  }
}

/** リマインダーを追加する */
function addReminder(
  state: BrainState,
  content: string,
  remindAt: number,
  repeat: 'daily' | 'weekly' | 'none' = 'none'
): void {
  const reminder: ReminderEntry = {
    id: `rem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    content,
    remindAt,
    repeat,
    done: false,
    notified: false,
    createdAt: Date.now(),
  };
  state.reminders.push(reminder);
  console.log(`Reminder added: "${content}" at ${new Date(remindAt).toLocaleString()}`);
}

/** 期限切れのリマインダーを取得する */
function getDueReminders(state: BrainState): ReminderEntry[] {
  const now = Date.now();
  return state.reminders.filter((r) => !r.done && !r.notified && r.remindAt <= now);
}

/** リマインダーを通知済みにする（繰り返し対応） */
function markNotified(state: BrainState, id: string): void {
  const reminder = state.reminders.find((r) => r.id === id);
  if (reminder) {
    reminder.notified = true;
    // 繰り返しリマインダーの再スケジュール
    if (reminder.repeat && reminder.repeat !== 'none') {
      const msDay = 24 * 60 * 60 * 1000;
      const nextTime =
        reminder.repeat === 'daily'
          ? reminder.remindAt + msDay
          : reminder.remindAt + 7 * msDay;
      addReminder(state, reminder.content, nextTime, reminder.repeat);
      reminder.done = true;
      console.log(
        `Repeating reminder rescheduled: "${reminder.content}" → ${new Date(nextTime).toLocaleString()}`
      );
    }
  }
}

/** おすすめを追加する */
function addRecommendation(
  state: BrainState,
  rec: Omit<Recommendation, 'id' | 'timestamp'>
): void {
  const entry: Recommendation = {
    ...rec,
    id: generateId(),
    timestamp: Date.now(),
  };
  state.recommendations.push(entry);
  if (state.recommendations.length > 50) {
    state.recommendations = state.recommendations.slice(-50);
  }
}

/** 最近のおすすめを取得する */
function getRecentRecommendations(state: BrainState, limit: number = 5): Recommendation[] {
  return state.recommendations.slice(-limit);
}

/** 食事履歴を取得する */
function getMealHistory(state: BrainState, limit: number = 10): MealLogEntry[] {
  return state.mealLog.slice(-limit);
}

// ============================================================
// メイン公開関数
// ============================================================

// 会話カウンター（サーバーレス環境では永続化できないため、
// 5回に1回のパーソナリティ評価はstateから算出する）
function shouldEvaluatePersonality(state: BrainState): boolean {
  // 総会話数（seed + harvest）を5で割って判定
  const total = state.modeState.totalSeedCount + state.modeState.totalHarvestCount;
  return total > 0 && total % 5 === 0;
}

/**
 * ユーザー入力を処理して応答を生成する（フル会話）
 */
export async function processInput(
  input: string
): Promise<{ response: string; state: BrainState }> {
  const now = Date.now();
  const state = await loadState();

  // 1. 活動ログを記録
  logSessionActivity(state);

  // 2. ユーザー入力を保存
  addEpisode(state, { speaker: 'user', content: input });

  let response = '';

  try {
    // --- コンテキスト構築 ---
    const history = getRecentEpisodes(state, 20)
      .map((ep) => `${ep.speaker === 'user' ? 'User' : 'AI'}: ${ep.content}`)
      .join('\n');

    const activityContext = getActivitySummaryForPrompt(state);
    const conceptsForPrompt = getConceptsForPrompt(state);
    const mealContext = getMealSummaryForPrompt(state);

    // 天気情報を取得
    await fetchWeather();
    const weatherContext = getWeatherForPrompt();
    const weatherRecommendation = getRecommendationContext();

    const personalityContext = getPersonalityForPrompt(state);
    const modeContext = getModeContextForPrompt(state);
    const evalPersonality = shouldEvaluatePersonality(state);
    incrementModeCount(state);
    const remindersContext = getRemindersForPrompt(state);

    const jst = getJstDate(now);

    const prompt = `
You are "Hakoniwa", a personal AI assistant living in a local environment.
Current Time: ${jst.dateTimeStr}
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
  "reminderSet": null | { "content": "リマインド内容", "remindAt": "日時ISO形式 (e.g. 2026-03-04T10:00:00)", "repeat": "none" | "daily" | "weekly" }${evalPersonality ? `,
  "personalityAdjust": { "humor": 0.0, "detail": 0.0, "empathy": 0.0, "curiosity": 0.0, "proactivity": 0.0, "formality": 0.0 }` : ''}
}
IMPORTANT - modeSwitch & trustDelta:
- modeSwitch: Set to "harvest" if user brings up creative/work topics. Set to "seed" if user is just chatting. null if no change needed.
- trustDelta: How much this interaction affected trust. Positive for good empathetic interactions (+1 to +3), negative for frustrating ones (-1 to -3). Usually +1 for normal good conversation.
${evalPersonality ? `
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

    const text = await callWithRetry(prompt);

    // JSONパース（堅牢化）
    const json = extractJson(text);

    if (json && typeof json.response === 'string') {
      response = json.response;

      // 感情状態を更新
      setEmotionalState(state, json.emotion as string, json.intensity as number);

      // 概念学習
      if (json.learnedConcepts && Array.isArray(json.learnedConcepts)) {
        (json.learnedConcepts as { term: string; definition: string }[]).forEach((concept) => {
          if (concept.term && concept.definition) {
            learnConcept(state, concept.term, concept.definition);
            console.log(`Learned: ${concept.term} = ${concept.definition}`);
          }
        });
      }

      // 食事ログ検出
      if (json.mealDetected && typeof json.mealDetected === 'string') {
        addMealLog(state, json.mealDetected as string);
        clearAwaitingMealResponse(state);
        console.log(`Meal logged: ${json.mealDetected}`);
      }

      // パーソナリティ調整（5回に1回）
      if (json.personalityAdjust && evalPersonality) {
        updatePersonality(state, json.personalityAdjust as Record<string, number>);
      }

      // モード切替
      if (json.modeSwitch === 'seed' || json.modeSwitch === 'harvest') {
        setMode(state, json.modeSwitch as InteractionMode);
      }

      // 信頼度調整
      if (typeof json.trustDelta === 'number' && json.trustDelta !== 0) {
        adjustTrust(state, json.trustDelta);
      }

      // リマインダー登録
      const reminderSet = json.reminderSet as {
        content?: string;
        remindAt?: string;
        repeat?: string;
      } | null;
      if (reminderSet && reminderSet.content && reminderSet.remindAt) {
        const remindAtTime = new Date(reminderSet.remindAt).getTime();
        if (!isNaN(remindAtTime) && remindAtTime > Date.now()) {
          addReminder(
            state,
            reminderSet.content,
            remindAtTime,
            (reminderSet.repeat as 'daily' | 'weekly' | 'none') || 'none'
          );
        }
      }
    } else {
      // JSONパース失敗 → responseフィールドだけの抽出を試みる
      console.error('Failed to parse JSON response, attempting fallback extraction');
      const extracted = extractResponseText(text);
      if (extracted) {
        response = extracted;
      } else {
        response = '🤔 うまく考えがまとまりませんでした...もう一度話しかけてもらえますか？';
      }
    }
  } catch (error: unknown) {
    console.error('Gemini API Error:', error);
    const errMsg = error instanceof Error ? error.message : String(error);

    if (errMsg.includes('429') || errMsg.toLowerCase().includes('quota') || errMsg.toLowerCase().includes('rate')) {
      response = '💤 ちょっと考えすぎたみたいです...少し時間を置いてからまた話しかけてください（API制限）';
      setEmotionalState(state, 'Sadness', 3);
    } else if (errMsg.includes('503') || errMsg.toLowerCase().includes('overloaded')) {
      response = '🔧 思考回路が混み合っているようです...少し待ってからもう一度お願いします';
      setEmotionalState(state, 'Calm', 2);
    } else if (errMsg.toLowerCase().includes('network') || errMsg.toLowerCase().includes('fetch')) {
      response = '📡 ネットワークに接続できないようです...接続を確認してみてください';
      setEmotionalState(state, 'Sadness', 4);
    } else if (errMsg.includes('400') || errMsg.toLowerCase().includes('invalid')) {
      response = '🤔 うまく理解できませんでした...もう一度別の言い方で教えてもらえますか？';
      setEmotionalState(state, 'Surprise', 4);
    } else {
      response = `⚠️ 思考回路にエラーが発生しました: ${errMsg.slice(0, 80)}`;
      setEmotionalState(state, 'Sadness', 3);
    }
  }

  // 3. AI応答を保存
  addEpisode(state, { speaker: 'ai', content: response });

  // 4. メモリをDriveに保存
  await saveState(state);

  return { response, state };
}

/**
 * 朝の挨拶＋占いを生成する
 */
export async function generateMorningMessage(): Promise<string> {
  const state = await loadState();
  const jst = getJstDate();

  // 天気情報を取得
  await fetchWeather();

  // --- 挨拶生成 ---
  let greetingMessage = '';
  const lastInteraction = state.episodes.slice(-1)[0];
  const lastTime = lastInteraction ? lastInteraction.timestamp : 0;
  const hoursSince = (Date.now() - lastTime) / (1000 * 60 * 60);

  // 4時間以上経過時のみ挨拶生成
  if (lastTime === 0 || hoursSince >= 4) {
    try {
      const activityContext = getActivitySummaryForPrompt(state);
      const weatherContext = getWeatherForPrompt();
      const umbrellaNeeded = isUmbrellaNeeded();

      const greetingPrompt = `
You are "Hakoniwa", a personal AI assistant.
Current Time: ${jst.dateTimeStr}
Time since last conversation: ${lastTime === 0 ? 'First meeting' : `${Math.round(hoursSince)} hours`}
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
      const result = await callWithRetry(greetingPrompt);
      const json = extractJson(result);
      if (json && typeof json.response === 'string') {
        greetingMessage = json.response;
        setEmotionalState(state, json.emotion as string, (json.intensity as number) || 5);
        addEpisode(state, { speaker: 'ai', content: greetingMessage });
      }
    } catch (e) {
      console.error('Greeting generation failed:', e);
    }
  }

  // --- 占い生成 ---
  let fortuneMessage = '';
  const today = jst.isoDate;

  if (state.fortuneTrigger.lastFortuneDate !== today) {
    state.fortuneTrigger.lastFortuneDate = today;

    try {
      const activityContext = getActivitySummaryForPrompt(state);
      const mealContext = getMealSummaryForPrompt(state);
      const recentEpisodes = getRecentEpisodes(state, 5)
        .map((ep) => `${ep.speaker === 'user' ? 'User' : 'AI'}: ${ep.content}`)
        .join('\n');
      const dayOfWeek = ['日', '月', '火', '水', '木', '金', '土'][jst.dayOfWeek];
      const weatherContext = getWeatherForPrompt();

      const fortunePrompt = `
You are "Hakoniwa", a personal AI assistant with a mystical fortune-telling persona.
Current Time: ${jst.dateTimeStr}
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
      const result = await callWithRetry(fortunePrompt);
      const json = extractJson(result);

      if (json && typeof json.fortune === 'string') {
        const stars = '★'.repeat((json.stars as number) || 3) + '☆'.repeat(5 - ((json.stars as number) || 3));
        fortuneMessage = `🔮 今日の運勢：${stars}\n${json.fortune}\n✨ ラッキーアイテム：${json.luckyItem}`;
        setEmotionalState(state, (json.emotion as string) || 'Joy', (json.intensity as number) || 5);
        addEpisode(state, { speaker: 'ai', content: fortuneMessage });
      }
    } catch (e) {
      console.error('Fortune generation failed:', e);
      // フォールバック占い
      const fallbackFortunes = [
        '今日は穏やかな一日になりそうです。新しいことに挑戦すると吉！',
        '午後から運気上昇↑ ちょっとした発見がありそう。',
        '今日のあなたはいつも以上に輝いています！自信を持って。',
        'コミュニケーション運が好調。誰かと話すと良いことがあるかも。',
        '直感が冴えている日。思いついたことはすぐメモしましょう！',
      ];
      const fortune = fallbackFortunes[Math.floor(Math.random() * fallbackFortunes.length)];
      const starsCount = Math.floor(Math.random() * 3) + 3;
      const starsStr = '★'.repeat(starsCount) + '☆'.repeat(5 - starsCount);
      fortuneMessage = `🔮 今日の運勢：${starsStr}\n${fortune}`;
      addEpisode(state, { speaker: 'ai', content: fortuneMessage });
      setEmotionalState(state, 'Joy', 5);
    }
  }

  // メモリ保存
  await saveState(state);

  // 挨拶と占いを結合
  const parts = [greetingMessage, fortuneMessage].filter(Boolean);
  return parts.join('\n\n');
}

/**
 * 食事トリガーメッセージを生成する
 * - 12:00-13:00: 昼食メニューを聞く
 * - 10:00-11:00 + データ5件以上: メニュー提案
 */
export async function generateMealMessage(): Promise<string | null> {
  const state = await loadState();
  const jst = getJstDate();
  const hour = jst.hour;
  const minute = jst.minute;
  const today = jst.isoDate;

  let message: string | null = null;

  // --- 12:00-13:00: 昼食を聞く ---
  if (hour === 12 || (hour === 13 && minute === 0)) {
    if (state.mealTrigger.lastAskedDate !== today) {
      state.mealTrigger.lastAskedDate = today;
      state.mealTrigger.awaitingMealResponse = true;

      message = '🍽️ お昼の時間ですね！今日は何を食べましたか？（または食べる予定ですか？）';
      addEpisode(state, { speaker: 'ai', content: message });
      setEmotionalState(state, 'Joy', 5);
    }
  }

  // --- 10:00-11:00: メニュー提案（5件以上のデータがある場合） ---
  if (!message && (hour === 10 || (hour === 11 && minute === 0))) {
    const mealCount = state.mealLog.length;
    if (mealCount >= 5 && state.mealTrigger.lastSuggestedDate !== today) {
      state.mealTrigger.lastSuggestedDate = today;

      try {
        const mealSummary = getMealSummaryForPrompt(state);
        const prompt = `
You are "Hakoniwa", a personal AI assistant.
Current Time: ${jst.dateTimeStr}

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
        const result = await callWithRetry(prompt);
        const json = extractJson(result);

        if (json && typeof json.response === 'string') {
          message = `🍱 ${json.response}`;
          addEpisode(state, { speaker: 'ai', content: message });
          setEmotionalState(state, (json.emotion as string) || 'Joy', (json.intensity as number) || 5);
        }
      } catch (e) {
        console.error('Meal suggestion failed:', e);
        // フォールバック
        const meals = getMealHistory(state, 5);
        const recentMenus = meals.map((m) => m.menu);
        message = `🍱 最近は${recentMenus.slice(0, 3).join('、')}を食べていましたね。今日は何にしましょう？`;
        addEpisode(state, { speaker: 'ai', content: message });
        setEmotionalState(state, 'Joy', 4);
      }
    }
  }

  if (message) {
    await saveState(state);
  }

  return message;
}

/**
 * 夕方のおすすめメッセージを生成する
 * - 17:00-19:00: 天気・気分・パターンに基づいたおすすめを生成
 */
export async function generateEveningMessage(): Promise<string | null> {
  const state = await loadState();
  const jst = getJstDate();
  const hour = jst.hour;
  const today = jst.isoDate;

  // --- 17:00-19:00: おすすめ生成 ---
  if (hour < 17 || hour >= 19) {
    return null;
  }

  if (state.recommendationTrigger.lastRecommendationDate === today) {
    return null;
  }

  state.recommendationTrigger.lastRecommendationDate = today;

  let message: string | null = null;

  try {
    // 天気情報を取得
    await fetchWeather();
    const weatherContext = getWeatherForPrompt();
    const weatherRec = getRecommendationContext();
    const activityContext = getActivitySummaryForPrompt(state);
    const mealContext = getMealSummaryForPrompt(state);
    const currentEmotion = state.currentEmotion || 'Neutral';
    const dayOfWeek = ['日', '月', '火', '水', '木', '金', '土'][jst.dayOfWeek];
    const recentRecs = getRecentRecommendations(state, 3)
      .map((r) => `${r.date}: ${r.content}`)
      .join('\n');

    const prompt = `
You are "Hakoniwa", a personal AI that gives personalized evening recommendations.
Current Time: ${jst.dateTimeStr}
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
    const result = await callWithRetry(prompt);
    const json = extractJson(result);

    if (json && typeof json.recommendation === 'string') {
      message = `🎯 今日のおすすめ\n${json.recommendation}`;

      addRecommendation(state, {
        date: today,
        type: (json.type as string as Recommendation['type']) || 'general',
        content: json.recommendation,
        reason: (json.reason as string) || '',
        basedOn: (json.basedOn as string[]) || ['general'],
      });
      addEpisode(state, { speaker: 'ai', content: message });
      setEmotionalState(state, (json.emotion as string) || 'Calm', (json.intensity as number) || 5);
    }
  } catch (e) {
    console.error('Recommendation generation failed:', e);
    // フォールバック
    message = '🎯 今日のおすすめ\n今日もお疲れ様でした！ゆっくり休んでくださいね。';
    addEpisode(state, { speaker: 'ai', content: message });
    setEmotionalState(state, 'Calm', 4);
  }

  await saveState(state);
  return message;
}

/**
 * リマインダーチェック — 期限切れのリマインダーメッセージを返す
 */
export async function checkReminders(): Promise<string[]> {
  const state = await loadState();
  const due = getDueReminders(state);

  if (due.length === 0) return [];

  const messages: string[] = [];

  for (const reminder of due) {
    const msg = `⏰ リマインド: ${reminder.content}`;
    messages.push(msg);
    markNotified(state, reminder.id);
  }

  if (messages.length > 0) {
    const fullMessage = messages.join('\n');
    addEpisode(state, { speaker: 'ai', content: fullMessage });
    await saveState(state);
  }

  return messages;
}
