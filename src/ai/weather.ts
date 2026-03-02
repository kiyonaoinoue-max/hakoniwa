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

// Default: Tokyo
const DEFAULT_LAT = 35.6895;
const DEFAULT_LON = 139.6917;

const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

export class WeatherManager {
    private cache: WeatherData | null = null;
    private userLat: number = DEFAULT_LAT;
    private userLon: number = DEFAULT_LON;
    private locationResolved = false;

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
            console.log(`Location resolved: ${this.userLat}, ${this.userLon}`);
        } catch {
            console.log('Geolocation not available, using Tokyo as default.');
        }
        this.locationResolved = true;
    }

    /** Fetch weather from Open-Meteo API */
    public async fetchWeather(): Promise<WeatherData | null> {
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
            };

            console.log(`Weather fetched: ${emoji} ${label} ${this.cache.temperature}°C`);
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
        parts.push(`現在の天気: ${this.cache.weatherEmoji} ${this.cache.weatherLabel}`);
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
