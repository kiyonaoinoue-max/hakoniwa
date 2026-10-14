// 天気情報取得モジュール（サーバーサイド版）
// Open-Meteo API を使用（無料、APIキー不要）
// 都道府県単位での天気取得・拠点切り替えに対応

/**
 * 都道府県の定義と県庁所在地座標
 */
export interface PrefectureCoord {
    name: string;      // 正式名称（例: '熊本県', '東京都', '京都府', '北海道'）
    shortName: string; // 略称（例: '熊本', '東京', '京都', '北海道'）
    lat: number;
    lon: number;
}

export const PREFECTURES: PrefectureCoord[] = [
    { name: '北海道', shortName: '北海道', lat: 43.0642, lon: 141.3469 },
    { name: '青森県', shortName: '青森', lat: 40.8244, lon: 140.7400 },
    { name: '岩手県', shortName: '岩手', lat: 39.7036, lon: 141.1527 },
    { name: '宮城県', shortName: '宮城', lat: 38.2682, lon: 140.8694 },
    { name: '秋田県', shortName: '秋田', lat: 39.7186, lon: 140.1024 },
    { name: '山形県', shortName: '山形', lat: 38.2404, lon: 140.3636 },
    { name: '福島県', shortName: '福島', lat: 37.7503, lon: 140.4678 },
    { name: '茨城県', shortName: '茨城', lat: 36.3418, lon: 140.4468 },
    { name: '栃木県', shortName: '栃木', lat: 36.5657, lon: 139.8836 },
    { name: '群馬県', shortName: '群馬', lat: 36.3911, lon: 139.0608 },
    { name: '埼玉県', shortName: '埼玉', lat: 35.8569, lon: 139.6489 },
    { name: '千葉県', shortName: '千葉', lat: 35.6051, lon: 140.1233 },
    { name: '東京都', shortName: '東京', lat: 35.6895, lon: 139.6917 },
    { name: '神奈川県', shortName: '神奈川', lat: 35.4478, lon: 139.6425 },
    { name: '新潟県', shortName: '新潟', lat: 37.9022, lon: 139.0236 },
    { name: '富山県', shortName: '富山', lat: 36.6953, lon: 137.2113 },
    { name: '石川県', shortName: '石川', lat: 36.5947, lon: 136.6256 },
    { name: '福井県', shortName: '福井', lat: 36.0652, lon: 136.2216 },
    { name: '山梨県', shortName: '山梨', lat: 35.6639, lon: 138.5684 },
    { name: '長野県', shortName: '長野', lat: 36.6513, lon: 138.1810 },
    { name: '岐阜県', shortName: '岐阜', lat: 35.3912, lon: 136.7223 },
    { name: '静岡県', shortName: '静岡', lat: 34.9770, lon: 138.3831 },
    { name: '愛知県', shortName: '愛知', lat: 35.1802, lon: 136.9066 },
    { name: '三重県', shortName: '三重', lat: 34.7303, lon: 136.5086 },
    { name: '滋賀県', shortName: '滋賀', lat: 35.0045, lon: 135.8686 },
    { name: '京都府', shortName: '京都', lat: 35.0210, lon: 135.7556 },
    { name: '大阪府', shortName: '大阪', lat: 34.6863, lon: 135.5200 },
    { name: '兵庫県', shortName: '兵庫', lat: 34.6913, lon: 135.1830 },
    { name: '奈良県', shortName: '奈良', lat: 34.6853, lon: 135.8327 },
    { name: '和歌山県', shortName: '和歌山', lat: 34.2260, lon: 135.1675 },
    { name: '鳥取県', shortName: '鳥取', lat: 35.5036, lon: 134.2383 },
    { name: '島根県', shortName: '島根', lat: 35.4723, lon: 133.0505 },
    { name: '岡山県', shortName: '岡山', lat: 34.6618, lon: 133.9344 },
    { name: '広島県', shortName: '広島', lat: 34.3963, lon: 132.4594 },
    { name: '山口県', shortName: '山口', lat: 34.1859, lon: 131.4705 },
    { name: '徳島県', shortName: '徳島', lat: 34.0658, lon: 134.5594 },
    { name: '香川県', shortName: '香川', lat: 34.3402, lon: 134.0433 },
    { name: '愛媛県', shortName: '愛媛', lat: 33.8416, lon: 132.7657 },
    { name: '高知県', shortName: '高知', lat: 33.5597, lon: 133.5311 },
    { name: '福岡県', shortName: '福岡', lat: 33.6064, lon: 130.4183 },
    { name: '佐賀県', shortName: '佐賀', lat: 33.2494, lon: 130.2988 },
    { name: '長崎県', shortName: '長崎', lat: 32.7448, lon: 129.8737 },
    { name: '熊本県', shortName: '熊本', lat: 32.8032, lon: 130.7079 },
    { name: '大分県', shortName: '大分', lat: 33.2382, lon: 131.6126 },
    { name: '宮崎県', shortName: '宮崎', lat: 31.9111, lon: 131.4239 },
    { name: '鹿児島県', shortName: '鹿児島', lat: 31.5602, lon: 130.5581 },
    { name: '沖縄県', shortName: '沖縄', lat: 26.2124, lon: 127.6809 },
];

/** 代表的な都市・地域名のエイリアス */
const CITY_ALIASES: Record<string, string> = {
    '博多': '福岡県',
    '天神': '福岡県',
    '小倉': '福岡県',
    '北九州': '福岡県',
    '札幌': '北海道',
    '函館': '北海道',
    '仙台': '宮城県',
    '横浜': '神奈川県',
    '川崎': '神奈川県',
    '名古屋': '愛知県',
    '神戸': '兵庫県',
    '那覇': '沖縄県',
    '阿蘇': '熊本県',
    '天草': '熊本県',
    '八代': '熊本県',
    '玉名': '熊本県',
    '菊池': '熊本県',
};

/** デフォルト拠点（熊本県） */
export const DEFAULT_PREFECTURE: PrefectureCoord = PREFECTURES.find(p => p.shortName === '熊本')!;

/**
 * テキストから都道府県を検出する
 * 例: "福岡の天気" → 福岡県, "東京にいる" → 東京都, "博多" → 福岡県
 */
export function findPrefecture(text: string): PrefectureCoord | null {
    if (!text) return null;

    // 1. エイリアスチェック
    for (const [alias, prefName] of Object.entries(CITY_ALIASES)) {
        if (text.includes(alias)) {
            const found = PREFECTURES.find(p => p.name === prefName);
            if (found) return found;
        }
    }

    // 2. 正式名称（東京都、大阪府、京都府、xx県）をチェック
    for (const pref of PREFECTURES) {
        if (text.includes(pref.name)) {
            return pref;
        }
    }

    // 3. 略称（東京、大阪、京都、北海道、福岡など）をチェック
    for (const pref of PREFECTURES) {
        if (text.includes(pref.shortName)) {
            return pref;
        }
    }

    return null;
}

/**
 * 天気データの型定義
 */
export interface WeatherData {
    temperature: number;
    weatherCode: number;
    weatherLabel: string;
    weatherEmoji: string;
    precipitationProbability: number;
    windSpeed: number;
    locationName?: string; // 例: '熊本県', '福岡県'
}

/**
 * WMO Weather Code → 日本語ラベル・絵文字マッピング
 */
const WEATHER_MAP: Record<number, { label: string; emoji: string }> = {
    0:  { label: '快晴',             emoji: '☀️' },
    1:  { label: 'ほぼ晴れ',         emoji: '🌤️' },
    2:  { label: '一部曇り',         emoji: '⛅' },
    3:  { label: '曇り',             emoji: '☁️' },
    45: { label: '霧',               emoji: '🌫️' },
    48: { label: '着氷性の霧',       emoji: '🌫️' },
    51: { label: '弱い霧雨',         emoji: '🌦️' },
    53: { label: '霧雨',             emoji: '🌦️' },
    55: { label: '強い霧雨',         emoji: '🌧️' },
    56: { label: '着氷性の弱い霧雨', emoji: '🌧️' },
    57: { label: '着氷性の霧雨',     emoji: '🌧️' },
    61: { label: '小雨',             emoji: '🌦️' },
    63: { label: '雨',               emoji: '🌧️' },
    65: { label: '大雨',             emoji: '🌧️' },
    66: { label: '着氷性の小雨',     emoji: '🌧️' },
    67: { label: '着氷性の雨',       emoji: '🌧️' },
    71: { label: '小雪',             emoji: '🌨️' },
    73: { label: '雪',               emoji: '❄️' },
    75: { label: '大雪',             emoji: '❄️' },
    77: { label: '霧雪',             emoji: '🌨️' },
    80: { label: 'にわか雨',         emoji: '🌦️' },
    81: { label: '強いにわか雨',     emoji: '🌧️' },
    82: { label: '激しいにわか雨',   emoji: '⛈️' },
    85: { label: 'にわか雪',         emoji: '🌨️' },
    86: { label: '強いにわか雪',     emoji: '❄️' },
    95: { label: '雷雨',             emoji: '⛈️' },
    96: { label: '雹を伴う雷雨',     emoji: '⛈️' },
    99: { label: '強い雹を伴う雷雨', emoji: '⛈️' },
};

function getWeatherInfo(code: number): { label: string; emoji: string } {
    return WEATHER_MAP[code] || { label: '不明', emoji: '❓' };
}

// 都道府県別の天気キャッシュ（30分有効）
const weatherCache = new Map<string, { data: WeatherData; fetchedAt: number }>();
const CACHE_TTL = 30 * 60 * 1000;

// 直近取得のキャッシュ（引数なしアクセス用の互換性保持）
let cachedWeather: WeatherData | null = null;

/**
 * 指定した場所（都道府県名・オブジェクト・またはデフォルト熊本）の天気を取得する
 */
export async function fetchWeather(targetLocation?: string | PrefectureCoord): Promise<WeatherData | null> {
    const pref = typeof targetLocation === 'string'
        ? (findPrefecture(targetLocation) || DEFAULT_PREFECTURE)
        : (targetLocation || DEFAULT_PREFECTURE);

    const now = Date.now();
    const cached = weatherCache.get(pref.name);
    if (cached && (now - cached.fetchedAt) < CACHE_TTL) {
        cachedWeather = cached.data;
        return cached.data;
    }

    try {
        const url = `https://api.open-meteo.com/v1/forecast`
            + `?latitude=${pref.lat}`
            + `&longitude=${pref.lon}`
            + `&current_weather=true`
            + `&hourly=precipitation_probability`
            + `&timezone=Asia/Tokyo`
            + `&forecast_days=1`;

        const response = await fetch(url);
        if (!response.ok) {
            console.error(`[Weather] API エラー: ${response.status}`);
            return cached?.data || null;
        }

        const data = await response.json() as {
            current_weather: {
                temperature: number;
                weathercode: number;
                windspeed: number;
            };
            hourly?: {
                precipitation_probability?: number[];
            };
        };

        const current = data.current_weather;
        const nowDate = new Date();
        const precipProb = data.hourly?.precipitation_probability?.[nowDate.getHours()] ?? 0;
        const { label, emoji } = getWeatherInfo(current.weathercode);

        const weatherData: WeatherData = {
            temperature: Math.round(current.temperature),
            weatherCode: current.weathercode,
            weatherLabel: label,
            weatherEmoji: emoji,
            precipitationProbability: precipProb,
            windSpeed: Math.round(current.windspeed),
            locationName: pref.name,
        };

        weatherCache.set(pref.name, { data: weatherData, fetchedAt: now });
        cachedWeather = weatherData;

        console.log(`[Weather] 取得完了 (${pref.name}): ${emoji} ${label} ${weatherData.temperature}°C`);
        return weatherData;
    } catch (e) {
        console.error('[Weather] 取得失敗:', e);
        return cached?.data || null;
    }
}

/** AI プロンプトに含める天気テキストを生成する（引数省略時は直近キャッシュ使用） */
export function getWeatherForPrompt(weather?: WeatherData | null): string {
    const w = weather ?? cachedWeather;
    if (!w) return '';
    const loc = w.locationName ? ` (${w.locationName})` : '';
    const parts = [
        `現在の天気${loc}: ${w.weatherEmoji} ${w.weatherLabel}`,
        `気温: ${w.temperature}°C`,
    ];
    if (w.precipitationProbability > 0) parts.push(`降水確率: ${w.precipitationProbability}%`);
    if (w.windSpeed > 20) parts.push(`風速: ${w.windSpeed}km/h（強風）`);
    return parts.join(', ');
}

/** おすすめ機能用の天気コンテキスト（引数省略時は直近キャッシュ使用） */
export function getRecommendationContext(weather?: WeatherData | null): string {
    const w = weather ?? cachedWeather;
    if (!w) return '';
    const parts: string[] = [];
    if (w.temperature <= 5) parts.push('寒い日（防寒が必要）');
    else if (w.temperature <= 15) parts.push('やや肌寒い');
    else if (w.temperature >= 30) parts.push('猛暑日（熱中症に注意）');
    else if (w.temperature >= 25) parts.push('暖かい日');
    if (w.weatherCode >= 61 && w.weatherCode <= 67) parts.push('雨が降っている（室内向きの活動がおすすめ）');
    else if (w.weatherCode >= 71 && w.weatherCode <= 77) parts.push('雪が降っている');
    else if (w.weatherCode >= 95) parts.push('雷雨（外出は控えめに）');
    else if (w.weatherCode <= 1) parts.push('天気が良い（外出にぴったり）');
    if (w.precipitationProbability >= 70) parts.push('これから雨が降りそう（傘が必要）');
    else if (w.precipitationProbability >= 40) parts.push('雨の可能性あり');
    return parts.length > 0 ? `天気状況: ${parts.join('、')}` : '';
}

/** 傘が必要かどうかを判定する（引数省略時は直近キャッシュ使用） */
export function isUmbrellaNeeded(weather?: WeatherData | null): boolean {
    const w = weather ?? cachedWeather;
    if (!w) return false;
    return w.precipitationProbability >= 40 ||
        (w.weatherCode >= 51 && w.weatherCode <= 67) ||
        (w.weatherCode >= 80 && w.weatherCode <= 82);
}
