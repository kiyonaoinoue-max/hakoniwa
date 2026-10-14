// Weather module using Open-Meteo API (free, no API key required)

export interface WeatherData {
    temperature: number;
    weatherCode: number;
    weatherLabel: string;
    weatherEmoji: string;
    precipitationProbability: number;
    windSpeed: number;
    isDay: boolean;
    fetchedAt: number;
    locationName?: string;
}

export interface PrefectureCoord {
    name: string;
    shortName: string;
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

export const DEFAULT_PREFECTURE: PrefectureCoord = PREFECTURES.find(p => p.shortName === '熊本')!;

export function findPrefecture(text: string): PrefectureCoord | null {
    if (!text) return null;
    for (const [alias, prefName] of Object.entries(CITY_ALIASES)) {
        if (text.includes(alias)) {
            const found = PREFECTURES.find(p => p.name === prefName);
            if (found) return found;
        }
    }
    for (const pref of PREFECTURES) {
        if (text.includes(pref.name)) return pref;
    }
    for (const pref of PREFECTURES) {
        if (text.includes(pref.shortName)) return pref;
    }
    return null;
}

// WMO Weather Code mapping
const WEATHER_MAP: Record<number, { label: string; emoji?: string; dayEmoji?: string; nightEmoji?: string }> = {
    0: { label: '快晴', dayEmoji: '☀️', nightEmoji: '🌙' },
    1: { label: 'ほぼ晴れ', dayEmoji: '🌤️', nightEmoji: '🌙' },
    2: { label: '一部曇り', emoji: '⛅' },
    3: { label: '曇り', emoji: '☁️' },
    45: { label: '霧', emoji: '🌫️' },
    48: { label: '着氷性の霧', emoji: '🌫️' },
    51: { label: '弱い霧雨', emoji: '🌦️' },
    53: { label: '霧雨', emoji: '🌦️' },
    55: { label: '強い霧雨', emoji: '🌧️' },
    56: { label: '着氷性の弱い霧雨', emoji: '🌧️' },
    57: { label: '着氷性の霧雨', emoji: '🌧️' },
    61: { label: '小雨', emoji: '🌦️' },
    63: { label: '雨', emoji: '🌧️' },
    65: { label: '大雨', emoji: '🌧️' },
    66: { label: '着氷性の小雨', emoji: '🌧️' },
    67: { label: '着氷性の雨', emoji: '🌧️' },
    71: { label: '小雪', emoji: '🌨️' },
    73: { label: '雪', emoji: '❄️' },
    75: { label: '大雪', emoji: '❄️' },
    77: { label: '霧雪', emoji: '🌨️' },
    80: { label: 'にわか雨', emoji: '🌦️' },
    81: { label: '強いにわか雨', emoji: '🌧️' },
    82: { label: '激しいにわか雨', emoji: '⛈️' },
    85: { label: 'にわか雪', emoji: '🌨️' },
    86: { label: '強いにわか雪', emoji: '❄️' },
    95: { label: '雷雨', emoji: '⛈️' },
    96: { label: '雹を伴う雷雨', emoji: '⛈️' },
    99: { label: '強い雹を伴う雷雨', emoji: '⛈️' },
};

function getWeatherInfo(code: number, isDay: boolean): { label: string; emoji: string } {
    const info = WEATHER_MAP[code] || { label: '不明', emoji: '❓' };
    const emoji = isDay
        ? (info.dayEmoji || info.emoji || '❓')
        : (info.nightEmoji || info.emoji || '❓');
    return { label: info.label, emoji };
}

const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

export class WeatherManager {
    private cache: WeatherData | null = null;
    private userLat: number = DEFAULT_PREFECTURE.lat;
    private userLon: number = DEFAULT_PREFECTURE.lon;
    private locationName: string = DEFAULT_PREFECTURE.name;
    private locationResolved = false;

    /** 手動で場所（都道府県）を設定する */
    public setLocation(prefName: string): boolean {
        const p = findPrefecture(prefName);
        if (p) {
            this.userLat = p.lat;
            this.userLon = p.lon;
            this.locationName = p.name;
            this.locationResolved = true;
            this.cache = null;
            return true;
        }
        return false;
    }

    /** Try to get user's location via browser geolocation */
    public async resolveLocation(): Promise<void> {
        if (this.locationResolved) return;

        try {
            const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(resolve, reject, {
                    timeout: 5000,
                    maximumAge: 60 * 60 * 1000, // 1 hour cache
                });
            });
            this.userLat = pos.coords.latitude;
            this.userLon = pos.coords.longitude;
            this.locationName = '現在地';
            console.log(`Location resolved: ${this.userLat}, ${this.userLon}`);
        } catch {
            console.log(`Geolocation not available, using ${this.locationName} as default.`);
        }
        this.locationResolved = true;
    }

    /** Fetch weather from Open-Meteo API */
    public async fetchWeather(targetPrefName?: string): Promise<WeatherData | null> {
        if (targetPrefName) {
            this.setLocation(targetPrefName);
        }

        // Return cache if still valid
        if (this.cache && (Date.now() - this.cache.fetchedAt) < CACHE_DURATION) {
            return this.cache;
        }

        try {
            await this.resolveLocation();

            const url = `https://api.open-meteo.com/v1/forecast?latitude=${this.userLat}&longitude=${this.userLon}&current_weather=true&hourly=precipitation_probability&timezone=Asia/Tokyo&forecast_days=1`;
            const response = await fetch(url);

            if (!response.ok) {
                console.error('Weather API error:', response.status);
                return this.cache; // Return stale cache if available
            }

            const data = await response.json();
            const current = data.current_weather;

            // Get current hour's precipitation probability
            const now = new Date();
            const currentHourIndex = now.getHours();
            const precipProb = data.hourly?.precipitation_probability?.[currentHourIndex] ?? 0;

            const { label, emoji } = getWeatherInfo(current.weathercode, current.is_day === 1);

            this.cache = {
                temperature: Math.round(current.temperature),
                weatherCode: current.weathercode,
                weatherLabel: label,
                weatherEmoji: emoji,
                precipitationProbability: precipProb,
                windSpeed: Math.round(current.windspeed),
                isDay: current.is_day === 1,
                fetchedAt: Date.now(),
                locationName: this.locationName,
            };

            console.log(`Weather fetched (${this.locationName}): ${emoji} ${label} ${this.cache.temperature}°C`);
            return this.cache;

        } catch (e) {
            console.error('Failed to fetch weather:', e);
            return this.cache; // Return stale cache if available
        }
    }

    /** Get cached weather (non-async) */
    public getCurrentWeather(): WeatherData | null {
        return this.cache;
    }

    /** Set weather from saved state (e.g. from memory) */
    public restoreCache(data: WeatherData | undefined | null): void {
        if (data && (Date.now() - data.fetchedAt) < CACHE_DURATION) {
            this.cache = data;
        }
    }

    /** Generate weather text for AI prompts */
    public getWeatherForPrompt(): string {
        if (!this.cache) return '';

        const parts: string[] = [];
        const loc = this.cache.locationName ? ` (${this.cache.locationName})` : '';
        parts.push(`現在の天気${loc}: ${this.cache.weatherEmoji} ${this.cache.weatherLabel}`);
        parts.push(`気温: ${this.cache.temperature}°C`);

        if (this.cache.precipitationProbability > 0) {
            parts.push(`降水確率: ${this.cache.precipitationProbability}%`);
        }

        if (this.cache.windSpeed > 20) {
            parts.push(`風速: ${this.cache.windSpeed}km/h（強風）`);
        }

        return parts.join(', ');
    }

    /** Generate recommendation context based on weather */
    public getRecommendationContext(): string {
        if (!this.cache) return '';

        const parts: string[] = [];
        const w = this.cache;

        // Temperature-based
        if (w.temperature <= 5) parts.push('寒い日（防寒が必要）');
        else if (w.temperature <= 15) parts.push('やや肌寒い');
        else if (w.temperature >= 30) parts.push('猛暑日（熱中症に注意）');
        else if (w.temperature >= 25) parts.push('暖かい日');

        // Weather-based
        if (w.weatherCode >= 61 && w.weatherCode <= 67) parts.push('雨が降っている（室内向きの活動がおすすめ）');
        else if (w.weatherCode >= 71 && w.weatherCode <= 77) parts.push('雪が降っている');
        else if (w.weatherCode >= 95) parts.push('雷雨（外出は控えめに）');
        else if (w.weatherCode <= 1) parts.push('天気が良い（外出にぴったり）');

        // Precipitation forecast
        if (w.precipitationProbability >= 70) parts.push('これから雨が降りそう（傘が必要）');
        else if (w.precipitationProbability >= 40) parts.push('雨の可能性あり');

        return parts.length > 0 ? `天気状況: ${parts.join('、')}` : '';
    }

    /** Check if umbrella is needed */
    public isUmbrellaNeeded(): boolean {
        if (!this.cache) return false;
        return this.cache.precipitationProbability >= 40 ||
            (this.cache.weatherCode >= 51 && this.cache.weatherCode <= 67) ||
            (this.cache.weatherCode >= 80 && this.cache.weatherCode <= 82);
    }
}

export const weatherManager = new WeatherManager();
