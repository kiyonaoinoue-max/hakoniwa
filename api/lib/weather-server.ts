// 天気情報取得モジュール（サーバーサイド版）
// Open-Meteo API を使用（無料、APIキー不要）
// ブラウザの Geolocation API は使えないため、固定座標（東京）を使用

// 東京の座標
const TOKYO_LAT = 35.6895;
const TOKYO_LON = 139.6917;

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

// モジュールレベルの天気キャッシュ（引数なしアクセス用）
let cachedWeather: WeatherData | null = null;

/**
 * Open-Meteo API から現在の天気データを取得してキャッシュする
 */
export async function fetchWeather(): Promise<WeatherData | null> {
    try {
        const url = `https://api.open-meteo.com/v1/forecast`
            + `?latitude=${TOKYO_LAT}`
            + `&longitude=${TOKYO_LON}`
            + `&current_weather=true`
            + `&hourly=precipitation_probability`
            + `&timezone=Asia/Tokyo`
            + `&forecast_days=1`;

        const response = await fetch(url);
        if (!response.ok) {
            console.error(`[Weather] API エラー: ${response.status}`);
            return null;
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
        const now = new Date();
        const precipProb = data.hourly?.precipitation_probability?.[now.getHours()] ?? 0;
        const { label, emoji } = getWeatherInfo(current.weathercode);

        cachedWeather = {
            temperature: Math.round(current.temperature),
            weatherCode: current.weathercode,
            weatherLabel: label,
            weatherEmoji: emoji,
            precipitationProbability: precipProb,
            windSpeed: Math.round(current.windspeed),
        };

        console.log(`[Weather] 取得完了: ${emoji} ${label} ${cachedWeather.temperature}°C`);
        return cachedWeather;
    } catch (e) {
        console.error('[Weather] 取得失敗:', e);
        return null;
    }
}

/** AI プロンプトに含める天気テキストを生成する（引数省略時はキャッシュ使用） */
export function getWeatherForPrompt(weather?: WeatherData | null): string {
    const w = weather ?? cachedWeather;
    if (!w) return '';
    const parts = [
        `現在の天気: ${w.weatherEmoji} ${w.weatherLabel}`,
        `気温: ${w.temperature}°C`,
    ];
    if (w.precipitationProbability > 0) parts.push(`降水確率: ${w.precipitationProbability}%`);
    if (w.windSpeed > 20) parts.push(`風速: ${w.windSpeed}km/h（強風）`);
    return parts.join(', ');
}

/** おすすめ機能用の天気コンテキスト（引数省略時はキャッシュ使用） */
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

/** 傘が必要かどうかを判定する（引数省略時はキャッシュ使用） */
export function isUmbrellaNeeded(weather?: WeatherData | null): boolean {
    const w = weather ?? cachedWeather;
    if (!w) return false;
    return w.precipitationProbability >= 40 ||
        (w.weatherCode >= 51 && w.weatherCode <= 67) ||
        (w.weatherCode >= 80 && w.weatherCode <= 82);
}
