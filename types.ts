
export interface GroundingSource {
  title?: string;
  uri?: string;
}

export interface Message {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: number;
  audioUrl?: string;
  imageUrl?: string;
  psychAnalysis?: string;
  language?: string;
  groundingSources?: GroundingSource[];
}

export interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
}

export interface UserSettings {
  theme: 'light' | 'dark';
  volume: number;
  playbackSpeed: number;
}

export interface GreetingData {
  timeStr: string;
  dateStr: string;
  quote: string;
  emoji: string;
}
